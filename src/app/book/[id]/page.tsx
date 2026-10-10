'use client';

import { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const SAVE_THROTTLE_MS = 5000;
const RESTORE_RETRY_LIMIT = 3;   // 首次 + 最多 2 次重试
const RESTORE_RETRY_BACKOFF_MS = 800; // 退避基数

type InterestChoice = 'like' | 'neutral' | 'dislike';
type DifficultyChoice = 'easy' | 'just_right' | 'hard';

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

  // ===== 阅读完成确认 + 反馈 =====
  // 完成状态：服务端 reading_records.completed（1=已完成，单向不撤销）
  const [serverCompleted, setServerCompleted] = useState(false);
  // 完成流程：idle（未点完成）| submitting（等待 Worker 确认）| completed（已确认）
  const [completionState, setCompletionState] = useState<'idle' | 'submitting' | 'completed'>('idle');
  const [completeError, setCompleteError] = useState('');
  // 反馈选择（本地临时值；null 表示该项未选）
  const [interest, setInterest] = useState<InterestChoice | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyChoice | null>(null);
  // 反馈提交：idle | saving | saved | error
  const [feedbackState, setFeedbackState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [feedbackError, setFeedbackError] = useState('');

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
  // 完成请求防重复点击（串行排他，配合 saveChainRef）
  const completingRef = useRef<boolean>(false);
  // UI 异步代际号：每次 child/book 切换递增。completeBook、反馈 GET/POST 发起时捕获，
  // 返回后若代际已变则丢弃结果，确保旧孩子/旧绘本的异步请求不会覆盖新状态。
  const uiAsyncGenRef = useRef(0);

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
      // 重置完成 / 反馈临时状态（切书隔离）
      uiAsyncGenRef.current += 1;
      completingRef.current = false;
      setServerCompleted(false);
      setCompletionState('idle');
      setCompleteError('');
      setInterest(null);
      setDifficulty(null);
      setFeedbackState('idle');
      setFeedbackError('');
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

          // 读取服务端完成状态（单向，不撤销）；驱动末页完成/反馈 UI
          const doneFlag = Number(result.data?.completed);
          setServerCompleted(doneFlag === 1);
          if (doneFlag === 1) setCompletionState('completed');

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

  // ===== 显式完成：发送 completed:true，等待 Worker 成功确认 =====
  const completeBook = () => {
    const childId = activeChild?.id;
    if (!childId || !bookId) return;
    // 防重复点击 / 异步竞争
    if (completingRef.current) return;
    if (completionState === 'submitting' || completionState === 'completed') return;

    completingRef.current = true;
    setCompletionState('submitting');
    setCompleteError('');

    // 捕获本次异步代际；若返回前 child/book 已切换则整体丢弃
    const gen = uiAsyncGenRef.current;

    // 串行排队，避免与在途页码保存乱序
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        const res = await fetch(`/api/reading-records/${bookId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            child_id: childId,
            pages_read: pages.length,
            duration_seconds: Math.floor((Date.now() - mountStartRef.current) / 1000),
            completed: true,
          }),
        });
        const result = await res.json();

        // 孩子/绘本已切换：丢弃旧结果，不更新任何 UI
        if (uiAsyncGenRef.current !== gen) return;

        // 必须收到 Worker 成功确认才进入反馈；否则停留末页可重试
        if (res.ok && result?.success) {
          setServerCompleted(true);
          setCompletionState('completed');
          // 拉取既有反馈用于回显（无反馈则保持未选）
          try {
            const fbRes = await fetch(
              `/api/reading-feedback?child_id=${encodeURIComponent(childId)}&custom_book_id=${bookId}`,
            );
            const fbJson = await fbRes.json();
            // 二次守卫：回显 GET 返回前也可能已切换孩子
            if (uiAsyncGenRef.current !== gen) return;
            if (fbRes.ok && fbJson?.success && fbJson.data) {
              setInterest(fbJson.data.interest ?? null);
              setDifficulty(fbJson.data.difficulty ?? null);
            }
          } catch {
            // 回显失败不阻断完成：反馈区仍可新填
          }
        } else {
          completingRef.current = false;
          setCompletionState('idle');
          setCompleteError('完成保存失败，请再试一次');
        }
      } catch {
        // 切换后发生的网络错误属于旧请求，不得覆盖新孩子状态
        if (uiAsyncGenRef.current !== gen) return;
        completingRef.current = false;
        setCompletionState('idle');
        setCompleteError('网络出错了，请再试一次');
      }
    });
  };

  // ===== 提交反馈（仅发送已选项；未选项不覆盖原值）=====
  const submitFeedback = () => {
    const childId = activeChild?.id;
    if (!childId || !bookId) return;
    // 两项均未选：等同跳过
    if (!interest && !difficulty) {
      setFeedbackState('saved');
      return;
    }

    setFeedbackState('saving');
    setFeedbackError('');

    const gen = uiAsyncGenRef.current;

    const payload: Record<string, unknown> = {
      child_id: childId,
      custom_book_id: bookId,
    };
    if (interest) payload.interest = interest;
    if (difficulty) payload.difficulty = difficulty;

    fetch('/api/reading-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        // 孩子/绘本已切换：丢弃旧反馈结果
        if (uiAsyncGenRef.current !== gen) return;
        const result = await res.json();
        if (res.ok && result?.success) {
          setFeedbackState('saved');
        } else {
          // 保留当前选择，允许重试
          setFeedbackState('error');
          setFeedbackError('保存失败，请再试一次');
        }
      })
      .catch(() => {
        if (uiAsyncGenRef.current !== gen) return;
        setFeedbackState('error');
        setFeedbackError('网络出错了，请再试一次');
      });
  };

  // ===== 跳过反馈：完成不受影响 =====
  const skipFeedback = () => {
    setFeedbackState('saved');
  };

  // 再读一次：回到第 1 页（服务端 completed 保持 1，不撤销）
  const rereadBook = () => {
    navigatedRef.current = true;
    setCurrentPage(1);
  };

  // ===== Ted/Sean 切换隔离：activeChild 变化时清掉旧孩子的临时反馈/完成状态 =====
  const prevChildIdRef = useRef<string>(activeChild?.id || '');
  useEffect(() => {
    const nextId = activeChild?.id || '';
    if (prevChildIdRef.current === nextId) return;
    prevChildIdRef.current = nextId;

    // 推进代际：使旧孩子在途的 completeBook / 反馈 GET/POST 结果全部失效
    uiAsyncGenRef.current += 1;
    // 完全重置为「新孩子未恢复」基线，绝不继承旧闭包的 serverCompleted。
    // 新孩子的完成态只能由随后 reading-record 恢复 effect 的服务端记录写入。
    completingRef.current = false;
    setServerCompleted(false);
    setCompletionState('idle');
    setCompleteError('');
    setInterest(null);
    setDifficulty(null);
    setFeedbackState('idle');
    setFeedbackError('');
  }, [activeChild?.id]);

  // ===== 实际发送一次进度（串行排队，保证旧请求不会后到覆盖新页码）=====
  const flushPage = (page: number) => {
    const childId = activeChild?.id;
    if (!childId || !recordReadyRef.current) return;

    lastFlushTsRef.current = Date.now();

    const payload: Record<string, unknown> = {
      child_id: childId,
      pages_read: page,
      duration_seconds: Math.floor((Date.now() - mountStartRef.current) / 1000),
    };

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
      // 不在离开时自动完成：completed 只能由「完成阅读」按钮显式触发。

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

      {/* ===== 末页：完成确认 → 反馈（到达末页不自动完成）===== */}
      {pages.length > 0 && currentPage >= pages.length && (
        <div className="w-full mt-8">
          {/* 尚未完成 / 提交中：显示完成按钮 */}
          {completionState !== 'completed' && (
            <div className="flex flex-col items-center gap-3">
              {serverCompleted && completionState !== 'submitting' && (
                <p className="text-sm text-gray-500">这本绘本之前已经读完啦</p>
              )}
              <button
                onClick={completeBook}
                disabled={completionState === 'submitting'}
                className="px-10 py-4 bg-[#FF6B35] hover:bg-[#ff7d4f] disabled:opacity-60 text-white text-xl font-bold rounded-full shadow-md transition-transform hover:scale-105"
              >
                {completionState === 'submitting' ? '保存中…' : '📖 完成阅读'}
              </button>
              {completeError && (
                <p className="text-[#FF6B6B] font-medium text-sm">{completeError}</p>
              )}
            </div>
          )}

          {/* Worker 已确认完成：显示反馈或完成状态 */}
          {completionState === 'completed' && feedbackState !== 'saved' && (
            <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl border shadow-md p-6 flex flex-col items-center gap-5">
              <p className="text-2xl font-bold text-[#2D3436]">读完啦！你的感受是？</p>

              {/* 兴趣 */}
              <div className="w-full">
                <p className="text-center text-[#636E72] font-medium mb-2">你喜欢这个故事吗？</p>
                <div className="flex justify-center gap-3">
                  <FeedbackChoiceButton
                    active={interest === 'like'}
                    emoji="😊"
                    label="喜欢"
                    onClick={() => setInterest('like')}
                  />
                  <FeedbackChoiceButton
                    active={interest === 'neutral'}
                    emoji="😐"
                    label="一般"
                    onClick={() => setInterest('neutral')}
                  />
                  <FeedbackChoiceButton
                    active={interest === 'dislike'}
                    emoji="🙁"
                    label="不喜欢"
                    onClick={() => setInterest('dislike')}
                  />
                </div>
              </div>

              {/* 难度 */}
              <div className="w-full">
                <p className="text-center text-[#636E72] font-medium mb-2">读起来难不难？</p>
                <div className="flex justify-center gap-3">
                  <FeedbackChoiceButton
                    active={difficulty === 'easy'}
                    emoji="🙂"
                    label="有点简单"
                    onClick={() => setDifficulty('easy')}
                  />
                  <FeedbackChoiceButton
                    active={difficulty === 'just_right'}
                    emoji="😊"
                    label="刚刚好"
                    onClick={() => setDifficulty('just_right')}
                  />
                  <FeedbackChoiceButton
                    active={difficulty === 'hard'}
                    emoji="😕"
                    label="有点难"
                    onClick={() => setDifficulty('hard')}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 mt-1">
                <button
                  onClick={submitFeedback}
                  disabled={feedbackState === 'saving'}
                  className="px-8 py-3 bg-[#4ECDC4] hover:bg-[#61d6ce] disabled:opacity-60 text-white text-lg font-bold rounded-full shadow-sm transition-transform hover:scale-105"
                >
                  {feedbackState === 'saving' ? '保存中…' : '保存反馈'}
                </button>
                <button
                  onClick={skipFeedback}
                  className="px-6 py-3 text-[#636E72] hover:text-[#2D3436] font-medium"
                >
                  跳过
                </button>
              </div>

              {feedbackState === 'error' && (
                <p className="text-[#FF6B6B] font-medium text-sm">{feedbackError}</p>
              )}
            </div>
          )}

          {/* 反馈已保存/已跳过：完成状态 + 下一步 */}
          {completionState === 'completed' && feedbackState === 'saved' && (
            <div className="flex flex-col items-center gap-5">
              <div className="flex items-center gap-2 text-[#51CF66] font-bold text-2xl">
                <span>🎉</span>
                <span>完成！</span>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => router.push('/book-select')}
                  className="px-8 py-3 bg-[#FF6B35] hover:bg-[#ff7d4f] text-white text-lg font-bold rounded-full shadow-md transition-transform hover:scale-105"
                >
                  返回书架
                </button>
                <button
                  onClick={rereadBook}
                  className="px-8 py-3 bg-white border hover:bg-gray-50 text-[#2D3436] text-lg font-bold rounded-full shadow-sm transition-transform hover:scale-105"
                >
                  再读一次
                </button>
              </div>
            </div>
          )}
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

// 反馈大按钮：适合儿童点击，选中态高亮
function FeedbackChoiceButton({
  active,
  emoji,
  label,
  onClick,
}: {
  active: boolean;
  emoji: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-5 py-3 rounded-2xl border-2 font-medium transition-all hover:scale-105 ${
        active
          ? 'border-[#FF6B35] bg-[#FFF1EA] text-[#2D3436] shadow-sm'
          : 'border-gray-200 bg-white text-[#636E72] hover:border-[#FFB596]'
      }`}
    >
      <span className="text-3xl leading-none">{emoji}</span>
      <span className="text-sm">{label}</span>
    </button>
  );
}
