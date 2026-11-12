'use client';

/**
 * S5G-8B 管理员小铃铛 — 课堂推送申请待办通知（方案A：零后端改动）
 *
 * 数据来源：现有只读接口 GET /api/admin/push-requests
 *   （Worker 端仅 x-admin-password 鉴权，与 CLASS_PUSH_ADMIN_ENABLED 开关无关；
 *     本组件不引入任何写能力，开关保持 OFF。）
 *
 * 行为契约（任务书 §三-A）：
 *   1. 管理员登录后（AdminContent 挂载即登录态）加载一次；
 *   2. 徽标只统计 status='pending' 的申请数量；
 *   3. 数量 > 0 时显示红色数字徽标；
 *   4. 点击铃铛展开待处理申请列表；
 *   5. 列表仅显示：班级名称、故事系列、申请时间、状态（不含教师任何个人信息）；
 *   6. 点击条目 → onOpenRequest(id)，由页面跳转「课堂推送」工作区并定位；
 *   7. 首次加载后每 60s 自动刷新（POLL_INTERVAL_MS）；
 *   8. 无已读概念：查看不减少计数（纯状态驱动）；
 *   9. 申请不再 pending 后，下一次刷新自然更新；
 *  10. 失败不伪装成功：保留错误提示（铃铛 "!" 徽标 + 下拉错误条），下周期自动重试；
 *  11. 卸载/退出登录（AdminContent 卸载）时清理定时器、中止在途请求，
 *      并以序号守卫防止过期响应覆盖新状态；adminFetch 经 ref 持有，
 *      定时器仅在挂载时创建一次，不随父组件重渲染重复注册。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

// ==================== 类型（与 Worker /v1/admin/push-requests 响应对齐） ====================

export interface BellQueueItem {
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

// ==================== 纯逻辑（导出供本地测试） ====================

/** 轮询周期：60 秒（任务书 §三-A-7） */
export const POLL_INTERVAL_MS = 60_000;

/** 待处理数量：只统计 pending，不计入 processing（任务书 §三-A-2） */
export function countPending(items: BellQueueItem[]): number {
  return items.reduce((n, it) => (it.status === 'pending' ? n + 1 : n), 0);
}

/** 待处理列表：仅 pending，保持 API 返回顺序（FIFO，与工作台一致） */
export function filterPending(items: BellQueueItem[]): BellQueueItem[] {
  return items.filter((it) => it.status === 'pending');
}

export type BadgeView =
  | { kind: 'none' }
  | { kind: 'count'; count: number }
  | { kind: 'error' };

/**
 * 徽标视图决策：
 * - 有待处理 → 红色数字（即使本轮刷新失败也保留最后一次成功计数，错误另在下拉中明示）；
 * - 无待处理但有错误 → 琥珀 "!"（失败不伪装成"全部清零"）；
 * - 否则不显示。
 */
export function badgeView(pendingCount: number, error: string): BadgeView {
  if (pendingCount > 0) return { kind: 'count', count: pendingCount };
  if (error) return { kind: 'error' };
  return { kind: 'none' };
}

/** 徽标文案：>99 折叠为 99+ */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** 申请时间格式化（created_at 为 unix 秒；非法输入安全兜底） */
export function formatRequestTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return '时间未知';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 状态文案 */
export function statusLabel(status: string): string {
  if (status === 'pending') return '待处理';
  if (status === 'processing') return '处理中';
  return status;
}

// ==================== 组件 ====================

interface PushNotificationBellProps {
  /** 页面注入的带 x-admin-password 的 fetch（口令仅存页面 React 内存） */
  adminFetch: (url: string, options?: RequestInit) => Promise<Response>;
  /** 点击申请条目：页面负责 setTab('classpush') + setSelectedPushRequestId(id) */
  onOpenRequest: (requestId: string) => void;
}

export function PushNotificationBell({ adminFetch, onOpenRequest }: PushNotificationBellProps) {
  const [items, setItems] = useState<BellQueueItem[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  // adminFetch 在页面中每次渲染重建：经 ref 持有（effect 中同步，遵守 react-hooks/refs），
  // 保证 load/定时器仅创建一次（契约 11）
  const adminFetchRef = useRef(adminFetch);
  useEffect(() => {
    adminFetchRef.current = adminFetch;
  }, [adminFetch]);

  // 序号 + AbortController：丢弃过期响应，卸载时中止在途请求（契约 11）
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await adminFetchRef.current('/api/admin/push-requests', { signal: ac.signal });
      const data = (await res.json().catch(() => null)) as { requests?: unknown; error?: unknown } | null;
      if (ac.signal.aborted || seq !== seqRef.current) return;
      if (!res.ok) {
        setError((data && typeof data.error === 'string' && data.error) || `加载失败（HTTP ${res.status}）`);
        return;
      }
      setItems(Array.isArray(data?.requests) ? (data.requests as BellQueueItem[]) : []);
      setError('');
    } catch {
      if (ac.signal.aborted || seq !== seqRef.current) return;
      setError('网络异常，将在下一周期自动重试');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      seqRef.current++;
      abortRef.current?.abort();
    };
  }, [load]);

  const pendingItems = filterPending(items);
  const pendingCount = countPending(items);
  const badge = badgeView(pendingCount, error);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={pendingCount > 0 ? `课堂推送申请通知，${pendingCount} 条待处理` : '课堂推送申请通知'}
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
      >
        <Bell className="w-5 h-5 text-gray-600" />
        {badge.kind === 'count' && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] leading-[18px] text-center font-bold">
            {badgeText(badge.count)}
          </span>
        )}
        {badge.kind === 'error' && (
          <span
            className="absolute -top-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[11px] leading-[18px] text-center font-bold"
            title={error}
          >
            !
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 透明遮罩：点击外部收起 */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-40 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-medium text-gray-800 text-sm">待处理课堂申请</span>
              <button
                type="button"
                onClick={() => void load()}
                className="text-xs text-[var(--color-src-primary)] hover:underline"
              >
                刷新
              </button>
            </div>
            {error && (
              <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
                {error}
              </div>
            )}
            {pendingItems.length === 0 && !error ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">暂无待处理申请</div>
            ) : (
              <ul className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {pendingItems.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpenRequest(it.id);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate">{it.class_name}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">
                          {statusLabel(it.status)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500 flex items-center justify-between gap-2">
                        <span className="truncate">{it.series_name ?? '未设置系列'}</span>
                        <span className="shrink-0">{formatRequestTime(it.created_at)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
