'use client';

import { useCallback, useEffect, useState } from 'react';

// ==================== 类型（与 Worker /v1/admin/push-requests 响应对齐，P4-T9-1C-S5） ====================

export interface PushQueueItem {
  id: string;
  class_id: string;
  status: 'pending' | 'processing';
  story_series_id: number | null;
  created_at: number;
  updated_at: number | null;
  class_name: string;
  series_name: string | null;
  member_count: number;
  ok_count: number;
  failed_count: number;
  skipped_count: number;
  processing_count: number;
}

export interface PushStudent {
  child_id: string;
  nickname: string;
  grade: string;
  authorized_at: number;
  confirmed_level: string | null;
  class_unfinished_count: number;
  result: {
    status: 'processing' | 'ok' | 'failed' | 'skipped';
    rewrite_id: number | null;
    custom_book_id: number | null;
    failure_reason: string | null;
    updated_at: number | null;
  } | null;
}

export interface MasterOption {
  id: number;
  series_id: number;
  series_name: string;
  episode_number: number;
  episode_title: string;
  page_count: number;
  level_tier: string | null;
  cover_image_url: string | null;
}

export interface PushDetail {
  request: {
    id: string;
    class_id: string;
    status: string;
    story_series_id: number | null;
    failure_reason: string | null;
    created_at: number;
    updated_at: number | null;
  };
  class: { id: string; name: string; status: string; story_series_id: number | null };
  students: PushStudent[];
  available_masters: MasterOption[];
  series_block_reason: string | null;
}

interface RewriteItem {
  id: number;
  episode_id: number;
  child_id: string | null;
  status: string;
  target_level: string;
  version: number;
  created_at: string;
}

export interface CustomizeContext {
  episodeId: number;
  childId: string;
  childName: string;
}

// ==================== 纯逻辑（导出供本地测试） ====================

/** 逐状态人数统计（processing 含 result=null 的未领取场景，防御性归并为 processing） */
export function summarizeCounts(students: PushStudent[]): {
  ok: number;
  failed: number;
  skipped: number;
  processing: number;
} {
  const c = { ok: 0, failed: 0, skipped: 0, processing: 0 };
  for (const s of students) {
    const st = s.result?.status ?? 'processing';
    if (st === 'ok') c.ok++;
    else if (st === 'failed') c.failed++;
    else if (st === 'skipped') c.skipped++;
    else c.processing++;
  }
  return c;
}

/** complete 前校验：所有 processing 成员必须显式 skip 且原因非空（与 Worker 强制规则一致的前端预检） */
export function validateSkips(
  processingChildIds: string[],
  reasonByChild: Record<string, string>,
): { ok: boolean; missing: string[]; noReason: string[] } {
  const missing = processingChildIds.filter((id) => !(id in reasonByChild));
  const noReason = processingChildIds.filter(
    (id) => id in reasonByChild && reasonByChild[id].trim().length === 0,
  );
  return { ok: missing.length === 0 && noReason.length === 0, missing, noReason };
}

/** 组装 complete body（仅 processing 成员；trim 原因） */
export function buildCompleteBody(
  processingChildIds: string[],
  reasonByChild: Record<string, string>,
): { skips: { child_id: string; reason: string }[] } {
  return {
    skips: processingChildIds.map((id) => ({ child_id: id, reason: (reasonByChild[id] ?? '').trim() })),
  };
}

/** 孩子可选 rewrite：属于该孩子且 final（候选上架版本），按 id 倒序（最新优先） */
export function finalRewritesForChild(rewrites: RewriteItem[], childId: string): RewriteItem[] {
  return rewrites
    .filter((r) => r.child_id === childId && r.status === 'final')
    .sort((a, b) => b.id - a.id);
}

/** 学生结果状态展示（skipped/failed 必须显示原因，不得显示为成功） */
export function studentStatusLabel(s: PushStudent): { text: string; tone: 'ok' | 'failed' | 'skipped' | 'processing' } {
  const st = s.result?.status ?? 'processing';
  if (st === 'ok') return { text: '已推送到书架', tone: 'ok' };
  if (st === 'failed') return { text: `失败：${s.result?.failure_reason ?? '未知原因'}`, tone: 'failed' };
  if (st === 'skipped') return { text: `已跳过：${s.result?.failure_reason ?? '未填原因'}`, tone: 'skipped' };
  return { text: '待处理', tone: 'processing' };
}

const TONE_CLASS: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-amber-100 text-amber-700',
  processing: 'bg-gray-100 text-gray-500',
};

// ==================== 组件 ====================

interface Props {
  adminFetch: (url: string, options?: RequestInit) => Promise<Response>;
  /** 「开始定制」：跳转绘本写手（episode + child 预选），由父级编排 tab 切换 */
  onStartCustomize: (ctx: CustomizeContext) => void;
  /** 受控选中的申请 id（跨 tab 保持现场，支持中断恢复） */
  selectedRequestId: string | null;
  onSelectRequest: (id: string | null) => void;
}

export function ClassPushWorkbench({ adminFetch, onStartCustomize, selectedRequestId, onSelectRequest }: Props) {
  const [queue, setQueue] = useState<PushQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');

  const [detail, setDetail] = useState<PushDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [selectedMasterId, setSelectedMasterId] = useState<number | null>(null);
  const [rewrites, setRewrites] = useState<RewriteItem[]>([]);
  const [rewritePick, setRewritePick] = useState<Record<string, string>>({}); // childId -> rewriteId
  const [activating, setActivating] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowNotice, setRowNotice] = useState<Record<string, string>>({});

  const [skipReasons, setSkipReasons] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState('');
  const [completeSummary, setCompleteSummary] = useState<string>('');

  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');

  // ---------- 队列 ----------
  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError('');
    try {
      const res = await adminFetch('/api/admin/push-requests');
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setQueueError((data && data.error) || `队列加载失败（HTTP ${res.status}）`);
        return;
      }
      setQueue(Array.isArray(data?.requests) ? data.requests : []);
    } catch {
      setQueueError('网络异常，队列加载失败');
    } finally {
      setQueueLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // ---------- 详情 ----------
  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setDetailError('');
      try {
        const res = await adminFetch(`/api/admin/push-requests/${encodeURIComponent(id)}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setDetailError((data && data.error) || `详情加载失败（HTTP ${res.status}）`);
          setDetail(null);
          return;
        }
        setDetail(data as PushDetail);
        // 默认选中第一本可选 Master（仅当尚未选择或已选不在候选中）
        setSelectedMasterId((prev) => {
          const list = (data?.available_masters ?? []) as MasterOption[];
          return prev && list.some((m) => m.id === prev) ? prev : (list[0]?.id ?? null);
        });
      } catch {
        setDetailError('网络异常，详情加载失败');
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [adminFetch],
  );

  // 选中申请变化：加载详情并重置逐行状态
  useEffect(() => {
    if (!selectedRequestId) {
      setDetail(null);
      return;
    }
    setRewritePick({});
    setRowError({});
    setRowNotice({});
    setSkipReasons({});
    setCompleteSummary('');
    setCompleteError('');
    setClaimError('');
    loadDetail(selectedRequestId);
  }, [selectedRequestId, loadDetail]);

  // ---------- 选定 Master 后加载该集全部 rewrite（按孩子过滤 final 候选） ----------
  useEffect(() => {
    if (!selectedMasterId) {
      setRewrites([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/books/writer/episodes/${selectedMasterId}/rewrites`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!cancelled) setRewrites(Array.isArray(data) ? data : []);
      } catch {
        /* 候选加载失败不阻断：选择器为空即可 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminFetch, selectedMasterId]);

  // ---------- 领取（幂等重入） ----------
  const handleClaim = async (id: string) => {
    setClaiming(true);
    setClaimError('');
    try {
      const res = await adminFetch(`/api/admin/push-requests/${encodeURIComponent(id)}/claim`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setClaimError((data && data.error) || `领取失败（HTTP ${res.status}）`);
        return;
      }
      await loadDetail(id);
      loadQueue();
    } catch {
      setClaimError('网络异常，领取失败');
    } finally {
      setClaiming(false);
    }
  };

  // ---------- 孩子级上架推送 ----------
  const handleActivate = async (childId: string) => {
    if (!selectedRequestId) return;
    const rewriteId = Number(rewritePick[childId]);
    setRowError((p) => ({ ...p, [childId]: '' }));
    setRowNotice((p) => ({ ...p, [childId]: '' }));
    if (!Number.isInteger(rewriteId) || rewriteId <= 0) {
      setRowError((p) => ({ ...p, [childId]: '请先选择该孩子的已定稿（final）改写版本' }));
      return;
    }
    setActivating((p) => ({ ...p, [childId]: true }));
    try {
      const res = await adminFetch(
        `/api/admin/push-requests/${encodeURIComponent(selectedRequestId)}/children/${encodeURIComponent(childId)}/activate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rewrite_id: rewriteId }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError((p) => ({ ...p, [childId]: (data && data.error) || `上架失败（HTTP ${res.status}）` }));
        return;
      }
      if (data?.data?.already_done) {
        setRowNotice((p) => ({ ...p, [childId]: '此前已成功推送，本次未重复发布' }));
      } else {
        setRowNotice((p) => ({ ...p, [childId]: '已上架并推送到孩子书架' }));
      }
      await loadDetail(selectedRequestId);
    } catch {
      setRowError((p) => ({ ...p, [childId]: '网络异常，请重试' }));
    } finally {
      setActivating((p) => ({ ...p, [childId]: false }));
    }
  };

  // ---------- 完成任务 ----------
  const handleComplete = async () => {
    if (!detail || completing) return;
    const processingIds = detail.students
      .filter((s) => (s.result?.status ?? 'processing') === 'processing')
      .map((s) => s.child_id);
    const v = validateSkips(processingIds, skipReasons);
    if (!v.ok) {
      setCompleteError(
        v.missing.length > 0
          ? '仍有学生处于「待处理」，请为每人填写跳过原因后再完成任务'
          : '跳过原因不能为空',
      );
      return;
    }
    setCompleting(true);
    setCompleteError('');
    try {
      const res = await adminFetch(
        `/api/admin/push-requests/${encodeURIComponent(detail.request.id)}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildCompleteBody(processingIds, skipReasons)),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCompleteError((data && data.error) || `完成失败（HTTP ${res.status}）`);
        return;
      }
      setCompleteSummary(
        `任务已关闭（${data?.data?.status ?? 'done'}）：成功 ${data?.data?.ok_count ?? 0} 人 · 失败 ${data?.data?.failed_count ?? 0} 人 · 跳过 ${data?.data?.skipped_count ?? 0} 人`,
      );
      onSelectRequest(null);
      loadQueue();
    } catch {
      setCompleteError('网络异常，完成失败');
    } finally {
      setCompleting(false);
    }
  };

  // ==================== 渲染：队列 ====================
  if (!selectedRequestId) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-gray-800">课堂推送队列</h2>
          <button
            onClick={loadQueue}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            刷新
          </button>
        </div>
        {completeSummary && (
          <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{completeSummary}</p>
        )}
        {queueError && <p className="text-sm text-red-600">{queueError}</p>}
        {queueLoading ? (
          <p className="text-sm text-gray-400 py-8 text-center">加载中...</p>
        ) : queue.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">暂无待处理的课堂推送申请</p>
        ) : (
          <div className="space-y-3">
            {queue.map((r) => (
              <div key={r.id} className="border rounded-lg p-4 flex flex-wrap items-center gap-3 hover:bg-gray-50">
                <div className="flex-1 min-w-[220px]">
                  <div className="font-bold text-gray-800">
                    {r.class_name}
                    {/* 隐私规则（S5B）：不展示教师/家长邮箱，队列以班级名+任务ID+时间识别 */}
                    <span className="ml-2 text-xs font-normal text-gray-400">任务 #{r.id.slice(0, 8)}</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    系列：{r.series_name ?? (r.story_series_id === null ? '（无系列快照）' : `#${r.story_series_id}`)}
                    {' · '}学生 {r.member_count} 人 · 申请于 {new Date(r.created_at * 1000).toLocaleString('zh-CN')}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    进度：✅{r.ok_count} ❌{r.failed_count} ⏭️{r.skipped_count} ⏳{r.processing_count}
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    r.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {r.status === 'pending' ? '待领取' : '处理中'}
                </span>
                <button
                  onClick={() => onSelectRequest(r.id)}
                  className="px-4 py-2 rounded-lg bg-[var(--color-src-primary)] text-white text-sm font-medium hover:opacity-90"
                >
                  {r.status === 'pending' ? '领取并处理' : '继续处理'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ==================== 渲染：详情 ====================
  const counts = detail ? summarizeCounts(detail.students) : { ok: 0, failed: 0, skipped: 0, processing: 0 };
  const processingIds = detail
    ? detail.students.filter((s) => (s.result?.status ?? 'processing') === 'processing').map((s) => s.child_id)
    : [];
  const blocked = !!detail?.series_block_reason;

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              onSelectRequest(null);
              loadQueue();
            }}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            ← 返回队列
          </button>
          <h2 className="font-display text-xl text-gray-800 flex-1">
            {detail?.class?.name ?? '加载中...'}
            <span className="ml-2 text-sm font-normal text-gray-400">
              申请 {selectedRequestId.slice(0, 8)}…
            </span>
          </h2>
          {detail && detail.request.status === 'pending' && (
            <button
              onClick={() => handleClaim(detail.request.id)}
              disabled={claiming}
              className="px-4 py-2 rounded-lg bg-[var(--color-src-primary)] text-white text-sm font-bold hover:opacity-90 disabled:opacity-50"
            >
              {claiming ? '领取中...' : '领取申请（开始处理）'}
            </button>
          )}
          {detail && detail.request.status === 'processing' && (
            <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
              已领取，处理中（重复进入安全）
            </span>
          )}
          <button
            onClick={() => loadDetail(selectedRequestId)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            刷新
          </button>
        </div>
        {claimError && <p className="mt-3 text-sm text-red-600">{claimError}</p>}
        {detailError && <p className="mt-3 text-sm text-red-600">{detailError}</p>}
        {detailLoading && <p className="mt-3 text-sm text-gray-400">详情加载中...</p>}
        {detail && (
          <p className="mt-3 text-sm text-gray-500">
            快照系列：
            {detail.request.story_series_id === null
              ? '（无系列快照）'
              : (detail.available_masters[0]?.series_name ?? `#${detail.request.story_series_id}`)}
            {' · '}进度：✅{counts.ok} ❌{counts.failed} ⏭️{counts.skipped} ⏳{counts.processing}
          </p>
        )}
      </div>

      {/* 历史 NULL 快照阻断（S4 BLOCKED 语义：禁止直接发布，界面明确禁用） */}
      {detail && blocked && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-800 leading-relaxed">
          <strong className="block mb-1">该申请无法直接发布</strong>
          {detail.series_block_reason}
        </div>
      )}

      {/* Master 选择（仅 published 且系列匹配快照；NULL 快照时列表为空） */}
      {detail && !blocked && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-3">
          <h3 className="font-display text-lg text-gray-800">选择 Master 绘本（published · 系列匹配快照）</h3>
          {detail.available_masters.length === 0 ? (
            <p className="text-sm text-gray-400">该系列暂无已发布的 Master 绘本</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {detail.available_masters.map((m) => (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                    selectedMasterId === m.id ? 'border-[var(--color-src-primary)] bg-orange-50/50' : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="master"
                    checked={selectedMasterId === m.id}
                    onChange={() => setSelectedMasterId(m.id)}
                    className="shrink-0"
                  />
                  {m.cover_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.cover_image_url} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-bold text-gray-800 truncate">
                      {m.series_name} 第{m.episode_number}集
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {m.episode_title} · {m.page_count}页{m.level_tier ? ` · ${m.level_tier}` : ''}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400">
            流程：为每个孩子点击「开始定制」→ 在绘本写手中生成并 Final 改写版本 → 回到本页选择该版本 → 「上架推送」。逐个审核，不批量发布。
          </p>
        </div>
      )}

      {/* 学生处理表 */}
      {detail && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-3">
          <h3 className="font-display text-lg text-gray-800">学生逐人处理（{detail.students.length}）</h3>
          <div className="space-y-3">
            {detail.students.map((s) => {
              const label = studentStatusLabel(s);
              const candidates = finalRewritesForChild(rewrites, s.child_id);
              const st = s.result?.status ?? 'processing';
              const quotaFull = s.class_unfinished_count >= 2;
              return (
                <div key={s.child_id} className="border rounded-lg p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[180px]">
                      <span className="font-bold text-gray-800">{s.nickname}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {s.grade || '未填年级'} · {s.confirmed_level ?? '未测评'}
                      </span>
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        quotaFull ? 'text-red-600' : 'text-gray-400'
                      }`}
                      title="课堂渠道未完成绘本（独立额度，最多 2 本）"
                    >
                      课堂额度 {s.class_unfinished_count}/2
                      {quotaFull && '（已满，上架将被拒绝）'}
                    </span>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${TONE_CLASS[label.tone]}`}>
                      {label.text}
                    </span>
                  </div>

                  {st === 'processing' && !blocked && detail.request.status === 'processing' && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        onClick={() =>
                          selectedMasterId &&
                          onStartCustomize({
                            episodeId: selectedMasterId,
                            childId: s.child_id,
                            childName: s.nickname,
                          })
                        }
                        disabled={!selectedMasterId}
                        className="px-3 py-2 rounded-lg border-2 border-[var(--color-src-primary)] text-[var(--color-src-primary)] text-sm font-bold hover:bg-orange-50 disabled:opacity-40"
                      >
                        ✏️ 开始定制
                      </button>
                      <select
                        value={rewritePick[s.child_id] ?? ''}
                        onChange={(e) =>
                          setRewritePick((p) => ({ ...p, [s.child_id]: e.target.value }))
                        }
                        className="px-3 py-2 border rounded-lg text-sm min-w-[220px]"
                        aria-label={`选择 ${s.nickname} 的定稿版本`}
                      >
                        <option value="">
                          {candidates.length === 0 ? '（该孩子暂无可定稿版本）' : '选择已定稿版本...'}
                        </option>
                        {candidates.map((r) => (
                          <option key={r.id} value={String(r.id)}>
                            #{r.id} · {r.target_level} · v{r.version}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleActivate(s.child_id)}
                        disabled={!!activating[s.child_id] || !rewritePick[s.child_id]}
                        className="px-4 py-2 rounded-lg bg-[var(--color-src-secondary)] text-white text-sm font-bold hover:opacity-90 disabled:opacity-40"
                      >
                        {activating[s.child_id] ? '上架中...' : '上架推送'}
                      </button>
                    </div>
                  )}
                  {st === 'failed' && !blocked && detail.request.status === 'processing' && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <select
                        value={rewritePick[s.child_id] ?? ''}
                        onChange={(e) =>
                          setRewritePick((p) => ({ ...p, [s.child_id]: e.target.value }))
                        }
                        className="px-3 py-2 border rounded-lg text-sm min-w-[220px]"
                        aria-label={`选择 ${s.nickname} 的定稿版本（重试）`}
                      >
                        <option value="">
                          {candidates.length === 0 ? '（该孩子暂无可定稿版本）' : '选择版本后重试...'}
                        </option>
                        {candidates.map((r) => (
                          <option key={r.id} value={String(r.id)}>
                            #{r.id} · {r.target_level} · v{r.version}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleActivate(s.child_id)}
                        disabled={!!activating[s.child_id] || !rewritePick[s.child_id]}
                        className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-bold hover:opacity-90 disabled:opacity-40"
                      >
                        {activating[s.child_id] ? '重试中...' : '重试上架'}
                      </button>
                    </div>
                  )}

                  {rowError[s.child_id] && <p className="text-xs text-red-600">{rowError[s.child_id]}</p>}
                  {rowNotice[s.child_id] && <p className="text-xs text-green-700">{rowNotice[s.child_id]}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 完成任务 */}
      {detail && detail.request.status === 'processing' && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-3">
          <h3 className="font-display text-lg text-gray-800">完成任务</h3>
          {processingIds.length > 0 ? (
            <>
              <p className="text-sm text-gray-500">
                以下 {processingIds.length} 名学生仍为「待处理」。任务关闭前必须为每人填写跳过原因（跳过不计为成功）：
              </p>
              <div className="space-y-2">
                {detail.students
                  .filter((s) => (s.result?.status ?? 'processing') === 'processing')
                  .map((s) => (
                    <div key={s.child_id} className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-700 w-28 truncate">{s.nickname}</span>
                      <input
                        value={skipReasons[s.child_id] ?? ''}
                        onChange={(e) =>
                          setSkipReasons((p) => ({ ...p, [s.child_id]: e.target.value }))
                        }
                        placeholder="跳过原因（必填）"
                        className="flex-1 px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">所有学生均已处理，可关闭任务。</p>
          )}
          {completeError && <p className="text-sm text-red-600">{completeError}</p>}
          <button
            onClick={handleComplete}
            disabled={completing}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-src-primary)] text-white font-bold hover:opacity-90 disabled:opacity-50"
          >
            {completing ? '提交中...' : `完成任务（成功 ${counts.ok} · 失败 ${counts.failed} · 跳过 ${counts.skipped + counts.processing}）`}
          </button>
        </div>
      )}
    </div>
  );
}
