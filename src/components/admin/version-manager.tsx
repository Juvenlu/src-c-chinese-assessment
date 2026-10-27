'use client';

/**
 * P3-H-12C 绘本正式版本管理（Admin 最小面板）
 *
 * 仅在绘本工坊 rewrite 详情中使用，面向单个孩子 + 单集：
 *  - 列出该孩子该集的所有 final rewrite 及其正式版状态（active/archived/deleted）
 *  - 设为正式版（每孩子每集唯一 active）
 *  - 归档 / 恢复
 *  - 推送（置“新”）
 *  - 安全软删除（二次确认，预检查关联阅读记录/反馈，仅状态变更，不删数据）
 *
 * 不修改绘本文字、图片与阅读结果；所有操作经 Worker（x-admin-password + service key）。
 */

import { useCallback, useEffect, useState } from 'react';

// 模块级稳定常量，避免组件每次渲染重建导致 useCallback/effect 依赖抖动
const VERSION_API_BASE = '/api/books/versioning';

interface VersionItem {
  rewrite_id: number;
  version: number;
  target_level: string;
  rewrite_status: string;
  page_count: number;
  total_chars: number;
  custom_book_id: number | null;
  book_status: 'active' | 'archived' | 'deleted' | null;
  pushed_at: number | null;
  first_viewed_at: number | null;
  is_new: boolean;
  record_count: number;
  feedback_count: number;
}

interface Props {
  childId: string;
  episodeId: number;
  /** 当前正在审核的 rewrite id，用于高亮 */
  currentRewriteId?: number | null;
  /** 操作后通知父组件刷新（可选） */
  onChanged?: () => void;
  /** 统一管理员请求方法（口令由父组件内存态注入，经服务端鉴权） */
  adminFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-600',
  deleted: 'bg-red-100 text-red-700',
};
const STATUS_LABEL: Record<string, string> = {
  active: '✅ 正式版',
  archived: '📦 已归档',
  deleted: '🗑️ 已删除',
};

export function VersionManager({ childId, episodeId, currentRewriteId, onChanged, adminFetch }: Props) {
  const adminPost = (url: string, body?: unknown): Promise<Response> =>
    adminFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });

  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState<VersionItem | null>(null);
  const [deleteMeta, setDeleteMeta] = useState<{ record_count: number; feedback_count: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${VERSION_API_BASE}/children/${encodeURIComponent(childId)}/episodes/${episodeId}/versions`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `加载失败 (${res.status})`);
      setVersions(json?.data?.versions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [childId, episodeId]);

  useEffect(() => {
    if (childId && episodeId) void load();
  }, [load, childId, episodeId]);

  const run = async (key: string, fn: () => Promise<Response>, okMsg: string) => {
    setBusyId(key);
    setError('');
    try {
      const res = await fn();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `操作失败 (${res.status})`);
      await load();
      onChanged?.();
      if (okMsg) console.info('[version-manager]', okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId('');
    }
  };

  const askDelete = async (v: VersionItem) => {
    if (v.custom_book_id == null) return;
    setConfirmDelete(v);
    setDeleteMeta(null);
    try {
      const res = await adminFetch(
        `${VERSION_API_BASE}/custom-books/${v.custom_book_id}/delete`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '预检查失败');
      setDeleteMeta({ record_count: json.data.record_count, feedback_count: json.data.feedback_count });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirmDelete(null);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete || confirmDelete.custom_book_id == null) return;
    const id = confirmDelete.custom_book_id;
    setConfirmDelete(null);
    await run(`del-${id}`, () => adminPost(`${VERSION_API_BASE}/custom-books/${id}/delete`, { confirm: true }), '已软删除');
  };

  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-display text-base text-gray-800">🏛️ 正式版本管理</h4>
        <button
          onClick={() => void load()}
          className="text-xs px-2 py-1 bg-gray-100 rounded-lg hover:bg-gray-200"
          type="button"
        >
          刷新
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        每个孩子每集仅一个「正式版」。Finalize 不会自动上架，需在此显式选择；归档/删除不影响历史阅读记录与反馈。
      </p>

      {loading && <div className="text-sm text-gray-400">加载中…</div>}
      {error && <div className="text-sm text-red-600 mb-2">⚠️ {error}</div>}

      {!loading && versions.length === 0 && !error && (
        <div className="text-sm text-gray-400 italic">该孩子此集暂无 final 版本</div>
      )}

      <div className="space-y-2">
        {versions.map((v) => {
          const key = `r${v.rewrite_id}`;
          const isActive = v.book_status === 'active';
          const isArchived = v.book_status === 'archived';
          const isDeleted = v.book_status === 'deleted';
          const isCurrent = currentRewriteId === v.rewrite_id;
          return (
            <div
              key={key}
              className={`border rounded-lg p-3 ${isCurrent ? 'border-[var(--color-src-secondary)] bg-teal-50/40' : ''}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-bold">{v.target_level}</span>
                  <span className="ml-2 text-gray-500">
                    v{v.version} · rewrite #{v.rewrite_id} · {v.page_count}页 · {v.total_chars}字
                  </span>
                  {v.is_new && (
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
                      🆕 新（未读）
                    </span>
                  )}
                  {v.book_status && (
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[v.book_status] ?? ''}`}>
                      {STATUS_LABEL[v.book_status] ?? v.book_status}
                    </span>
                  )}
                  {!v.book_status && (
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">未上架</span>
                  )}
                  {(v.record_count > 0 || v.feedback_count > 0) && (
                    <span className="ml-2 text-xs text-gray-400">
                      阅读 {v.record_count} · 反馈 {v.feedback_count}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {/* 未上架 / 非 active 的 final：可设为正式版 */}
                  {!isActive && !isDeleted && (
                    <button
                      type="button"
                      disabled={busyId === key}
                      onClick={() =>
                        void run(
                          `act-${v.rewrite_id}`,
                          () =>
                            adminPost(`${VERSION_API_BASE}/rewrite/${v.rewrite_id}/activate`, {
                              child_id: childId,
                              episode_id: episodeId,
                            }),
                          '已设为正式版',
                        )
                      }
                      className="text-xs px-2.5 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                    >
                      设为正式版
                    </button>
                  )}

                  {isActive && (
                    <button
                      type="button"
                      disabled={busyId === key}
                      onClick={() =>
                        void run(`push-${v.custom_book_id}`, () => adminPost(`${VERSION_API_BASE}/custom-books/${v.custom_book_id}/push`), '已推送')
                      }
                      className="text-xs px-2.5 py-1 bg-[var(--color-src-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                    >
                      {v.is_new ? '再次推送' : '推送（新）'}
                    </button>
                  )}

                  {isActive && (
                    <button
                      type="button"
                      disabled={busyId === key}
                      onClick={() =>
                        void run(`arch-${v.custom_book_id}`, () => adminPost(`${VERSION_API_BASE}/custom-books/${v.custom_book_id}/archive`), '已归档')
                      }
                      className="text-xs px-2.5 py-1 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                      归档
                    </button>
                  )}

                  {isArchived && (
                    <button
                      type="button"
                      disabled={busyId === key}
                      onClick={() =>
                        void run(`res-${v.custom_book_id}`, () => adminPost(`${VERSION_API_BASE}/custom-books/${v.custom_book_id}/restore`), '已恢复')
                      }
                      className="text-xs px-2.5 py-1 bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200 disabled:opacity-50"
                    >
                      恢复为正式版
                    </button>
                  )}

                  {v.custom_book_id != null && !isDeleted && (
                    <button
                      type="button"
                      disabled={busyId === key}
                      onClick={() => void askDelete(v)}
                      className="text-xs px-2.5 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 disabled:opacity-50"
                    >
                      删除
                    </button>
                  )}

                  {isDeleted && (
                    <button
                      type="button"
                      disabled={busyId === key}
                      onClick={() =>
                        void run(`res-${v.custom_book_id}`, () => adminPost(`${VERSION_API_BASE}/custom-books/${v.custom_book_id}/restore`), '已恢复')
                      }
                      className="text-xs px-2.5 py-1 bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200 disabled:opacity-50"
                    >
                      恢复
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 删除二次确认（页面内联，不使用中断式弹窗） */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h4 className="font-display text-lg text-gray-800 mb-2">确认软删除？</h4>
            <p className="text-sm text-gray-600 mb-3">
              将把 rewrite #{confirmDelete.rewrite_id}（{confirmDelete.target_level}）对应绘本标记为「已删除」，
              <b>不会删除</b>任何阅读记录与反馈，之后可恢复。
            </p>
            <div className="text-sm text-gray-500 mb-4">
              关联阅读记录：<b>{deleteMeta?.record_count ?? '…'}</b> 条 · 反馈：<b>{deleteMeta?.feedback_count ?? '…'}</b> 条
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!deleteMeta}
                onClick={() => void doDelete()}
                className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
