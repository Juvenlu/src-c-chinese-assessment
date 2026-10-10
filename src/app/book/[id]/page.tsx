'use client';

import { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const SAVE_THROTTLE_MS = 5000;
const RESTORE_RETRY_LIMIT = 3;   // 首次 + 最多 2 次重试
const RESTORE_RETRY_BACKOFF_MS = 800; // 退避基数

export default function BookReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const bookId = parseInt(id, 10);

  const router = useRouter();
  const { activeChild, loading: authLoading } = useAuth();

  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [recordReady, setRecordReady] = useState(false);
  // 恢复状态：'restoring'（内容+身份+进度就绪前不渲染正文）| 'done' | 'error'（可重试失败）
  const [restoreState, setRestoreState] = useState<'restoring' | 'done' | 'error'>('restoring');
  const [restoreAttempt, setRestoreAttempt] = useState(0); // 用于强制重试恢复

  // ===== Refs：请求隔离 / 节流 / 乱序保护 =====
  const initializedKeyRef = useRef<string>(''); // `${bookId}:${childId}`，防重复初始化
  // 恢复代际号：每次实际发起恢复递增，用于区分「同一 key 被取消后重跑」的新旧请求，
  // 使旧 POST 即使在 key 被重新占用后仍能被识别为 stale（防旧请求覆盖新状态）。
  const restoreRunSeqRef = useRef(0);
  const navigatedRef = useRef<boolean>(false);  // 用户是否已手动翻页
  const lastFlushTsRef = useRef<number>(0);
  const pendingPageRef = useRef<number>(1);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve()); // 串行化保存，防乱序
  const mountStartRef = useRef<number>(Date.now());

  // beforeunload 读取的最新值
  const bookIdRef = useRef<number>(bookId);
  const childIdRef = useRef<string>('');
  const pageRef = useRef<number>(1);
  const totalRef = useRef<number>(0);
  const recordReadyRef = useRef<boolean>(false);

  // ===== 绘本内容加载（逻辑保持不变）=====
  useEffect(() => {
    async function initBook() {
      try {
        setLoading(true);

        // `/book/:id` 中的 id 是 custom_books.id，必须请求 custom book API，
        // 而不是 Master Episode API（它会因无匹配 id 返回 data=null → "未找到绘本内容"）。
        const res = await fetch(`/api/books/custom/${bookId}`);
        const responseData = await res.json();

        // 逐层解包，兼容 {data:{...}} / {book:{...}} / 直接对象。
        const bookData = responseData?.data ?? responseData?.book ?? responseData;
        if (res.ok && bookData) {
          setBook(bookData);

          let rawPages = bookData.pages_json ?? bookData.pages ?? [];
          if (typeof rawPages === 'string') {
            try {
              rawPages = JSON.parse(rawPages);
            } catch (pErr) {
              rawPages = [];
            }
          }
          setPages(Array.isArray(rawPages) ? rawPages : []);
        }
      } catch (err) {
        console.error('Failed to load custom book:', err);
      } finally {
        setLoading(false);
      }
    }

    if (bookId) {
      // 切换绘本：隔离旧状态，重置阅读位置与记录初始化标记
      setCurrentPage(1);
      setBook(null);
      setPages([]);
      setRecordReady(false);
      recordReadyRef.current = false;
      navigatedRef.current = false;
      initializedKeyRef.current = '';
      setRestoreState('restoring');
      mountStartRef.current = Date.now();
      initBook();
    }
  }, [bookId]);

  // ===== Reading Record 初始化：内容 + 身份就绪后执行（恢复完成前不渲染正文）=====
  useEffect(() => {
    // 身份或内容未就绪：保持恢复中，不渲染正文
    if (authLoading || loading) return;

    const childId = activeChild?.id;
    // 无需恢复：未登录/无孩子，或内容不可用（无书/空页）→ 放行正文，由渲染层呈现对应状态
    if (!childId || !bookId || !book || pages.length === 0) {
      setRestoreState('done');
      return;
    }

    const key = `${bookId}:${childId}`;
    if (initializedKeyRef.current === key) return;
    initializedKeyRef.current = key;
    // 为本代恢复分配唯一 token
    const runToken = ++restoreRunSeqRef.current;

    let cancelled = false;
    // 标记本次恢复是否已到达终态（done/error）。
    // 仅「尚未到达终态就被 cleanup 取消」时释放 key，避免 key 永久锁死导致永久 loading，
    // 同时已成功/已失败的终态不释放，防止重复请求。
    let reachedTerminal = false;
    let attemptNo = 0;

    const doRestore = async (): Promise<'ok' | 'retry' | 'stale'> => {
      if (cancelled || restoreRunSeqRef.current !== runToken) return 'stale';
      try {
        const res = await fetch('/api/reading-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ child_id: childId, custom_book_id: bookId }),
        });
        const result = await res.json();

        if (cancelled || restoreRunSeqRef.current !== runToken) return 'stale';
        if (res.ok && result?.success) {
          recordReadyRef.current = true;
          setRecordReady(true);

          // 恢复上次页码；仅在用户尚未手动翻页时生效，避免覆盖用户操作
          if (!navigatedRef.current) {
            const saved = Number(result.data?.pages_read);
            if (Number.isInteger(saved) && saved >= 1) {
              setCurrentPage(Math.min(saved, pages.length));
            }
          }
          setRestoreState('done');
          reachedTerminal = true;
          return 'ok';
        }
        // 业务失败：可重试
        console.warn('[reading-records] restore non-ok:', result);
        return 'retry';
      } catch (err) {
        // 网络错误：可重试；保留诊断信息
        console.warn('[reading-records] restore error:', key, err);
        return 'retry';
      }
    };

    (async () => {
      setRestoreState('restoring');
      try {
        for (attemptNo = 0; attemptNo <= RESTORE_RETRY_LIMIT; attemptNo++) {
          const outcome = await doRestore();
          if (outcome === 'ok' || outcome === 'stale') return;
          // retry：短暂退避后再试
          await new Promise((r) => setTimeout(r, RESTORE_RETRY_BACKOFF_MS * (attemptNo + 1)));
          if (cancelled || restoreRunSeqRef.current !== runToken) return;
        }
        // 重试耗尽：进入可重试错误态，不得静默显示第 1 页并保存
        if (!cancelled && restoreRunSeqRef.current === runToken) {
          recordReadyRef.current = false;
          setRecordReady(false);
          setRestoreState('error');
          reachedTerminal = true;
        }
      } catch {
        // 退避被中断（如卸载）
      }
    })();

    return () => {
      cancelled = true;
      // 仅在恢复尚未到达终态时释放锁，使随后重跑的 effect 能重新恢复（P3-B key-lock 修复）。
      // 已到达终态（成功/重试耗尽）则保留锁，避免重复请求。
      if (!reachedTerminal && initializedKeyRef.current === key) {
        initializedKeyRef.current = '';
      }
    };
  }, [bookId, pages.length, activeChild, authLoading, loading, restoreAttempt]);

  // 恢复失败后的手动重试：重置初始化标记并重新触发恢复 effect
  const retryRestore = () => {
    initializedKeyRef.current = '';
    // 推进代际，使任何在途旧请求变为 stale
    restoreRunSeqRef.current += 1;
    recordReadyRef.current = false;
    setRecordReady(false);
    setRestoreState('restoring');
    setRestoreAttempt((n) => n + 1);
  };

  // ===== 实际发送一次进度（串行排队，保证旧请求不会后到覆盖新页码）=====
  const flushPage = (page: number) => {
    const childId = activeChild?.id;
    if (!childId || !recordReadyRef.current) return;

    const total = totalRef.current;
    lastFlushTsRef.current = Date.now();

    const payload: Record<string, unknown> = {
      child_id: childId,
      pages_read: page,
      duration_seconds: Math.floor((Date.now() - mountStartRef.current) / 1000),
    };
    // 到达最后一页：提交 completed=true（服务端单向保存，不会被翻回撤销）
    if (total > 0 && page >= total) {
      payload.completed = true;
    }

    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        await fetch(`/api/reading-records/${bookId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // 保存失败不阻断阅读
      }
    });
  };

  // ===== 翻页后调度保存（约 5 秒节流，末页立即保存）=====
  useEffect(() => {
    if (!recordReady) return;
    if (!bookId || pages.length === 0 || !activeChild) return;

    pendingPageRef.current = currentPage;

    const isLast = currentPage >= pages.length;
    const elapsed = Date.now() - lastFlushTsRef.current;

    if (isLast || elapsed >= SAVE_THROTTLE_MS) {
      flushPage(currentPage);
    } else {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = setTimeout(() => {
        flushPage(pendingPageRef.current);
      }, SAVE_THROTTLE_MS - elapsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pages.length, activeChild, recordReady, bookId]);

  // ===== 同步最新值供 beforeunload 使用 =====
  useEffect(() => {
    bookIdRef.current = bookId;
    childIdRef.current = activeChild?.id || '';
    pageRef.current = currentPage;
    totalRef.current = pages.length;
  }, [bookId, activeChild, currentPage, pages.length]);

  // ===== 离开页面前尽力保存（sendBeacon 仅作补充）=====
  useEffect(() => {
    const handler = () => {
      const bId = bookIdRef.current;
      const cId = childIdRef.current;
      const page = pageRef.current;
      const total = totalRef.current;
      if (!bId || !cId || !recordReadyRef.current) return;

      const payload: Record<string, unknown> = {
        child_id: cId,
        pages_read: page,
      };
      if (total > 0 && page >= total) {
        payload.completed = true;
      }

      try {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(`/api/reading-records/${bId}`, blob);
      } catch {
        // 忽略：节流保存已覆盖主要场景
      }
    };

    window.addEventListener('pagehide', handler);
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('pagehide', handler);
      window.removeEventListener('beforeunload', handler);
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, []);

  // 记录用户手动翻页（防止异步初始化覆盖）
  const goToPage = (page: number) => {
    navigatedRef.current = true;
    setCurrentPage(page);
  };

  const restorePending = loading || authLoading || restoreState === 'restoring';

  if (restorePending) {
    return <div className="flex justify-center items-center h-screen text-gray-600">绘本加载中...</div>;
  }

  if (restoreState === 'error') {
    return (
      <div className="flex flex-col justify-center items-center h-screen gap-4 text-center">
        <p className="text-gray-700 font-medium">阅读进度恢复失败，无法安全恢复到上次位置。</p>
        <p className="text-sm text-gray-500">为避免进度错乱，暂未打开正文。</p>
        <button
          onClick={retryRestore}
          className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md font-medium"
        >
          重试恢复
        </button>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex flex-col justify-center items-center h-screen gap-4">
        <p className="text-gray-500 font-medium">未找到绘本内容 (ID: {bookId})</p>
        <button
          onClick={() => router.push('/book-select')}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-md text-sm"
        >
          返回书架
        </button>
      </div>
    );
  }

  const currentPageData = pages[currentPage - 1] || {};
  const imageUrl = currentPageData.image_url || currentPageData.imageUrl || '';
  const textContent = currentPageData.text_content || currentPageData.textContent || currentPageData.text || '';

  return (
    <div className="max-w-4xl mx-auto p-4 flex flex-col items-center min-h-screen">
      <div className="w-full flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">{book.episode_title || book.series_name || 'SRC 趣味中文绘本'}</h1>
        <span className="text-sm text-gray-500 font-medium">
          {pages.length > 0 ? `第 ${currentPage} / ${pages.length} 页` : '暂无页码'}
        </span>
      </div>

      <div className="w-full bg-white rounded-lg shadow-md p-6 flex flex-col items-center border">
        {pages.length === 0 ? (
          <div className="py-12 text-center text-gray-500 font-medium">
            📖 该绘本暂未上传具体页面内容 (ID: {bookId})
          </div>
        ) : (
          <>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={`Page ${currentPage}`}
                className="max-h-[500px] object-contain rounded-md mb-6"
              />
            ) : (
              <div className="w-full h-64 bg-gray-100 rounded-md mb-6 flex items-center justify-center text-gray-400">
                暂无图片
              </div>
            )}
            <p className="text-lg text-gray-800 leading-relaxed text-center font-medium max-w-2xl">
              {textContent || '暂无文字内容'}
            </p>
          </>
        )}
      </div>

      {pages.length > 0 && (
        <div className="flex gap-4 mt-6">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-6 py-2 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 rounded-md font-medium"
          >
            上一页
          </button>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= pages.length}
            className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-md font-medium"
          >
            下一页
          </button>
        </div>
      )}

      <button
        onClick={() => router.push('/book-select')}
        className="mt-6 px-4 py-2 text-sm text-gray-500 hover:text-gray-800"
      >
        ← 返回书架
      </button>
    </div>
  );
}
