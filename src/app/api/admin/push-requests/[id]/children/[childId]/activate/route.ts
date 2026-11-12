import { proxyToWorker } from '@/app/api/lib/worker-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string; childId: string }>;
}

/** 防路径注入：request id / child id 均为 UUID 形态（hex + 连字符） */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * POST /api/admin/push-requests/[id]/children/[childId]/activate — 孩子级课堂上架+推送（P4-T9-1C-S5）
 *
 * Body: { rewrite_id: number }（final 且属于该孩子的改写版本）。
 * 课堂任务上下文（申请 processing、孩子为本班 active 成员、rewrite 归属、
 * Master published、系列匹配申请快照）全部由 Worker 端强制校验——
 * URL 中的 id/childId 仅作路由透传，不作为任何授权依据。
 * 幂等：result=ok 后重入返回 already_done，不重复发布；失败可安全重试（断点恢复）。
 */
export async function POST(request: Request, context: RouteContext) {
  const { id, childId } = await context.params;
  const ok = SAFE_ID.test(id) && SAFE_ID.test(childId);
  const target = ok
    ? `/v1/admin/push-requests/${encodeURIComponent(id)}/children/${encodeURIComponent(childId)}/activate`
    : '/v1/admin/push-requests/__invalid__/children/__invalid__/activate';
  return proxyToWorker(request, target);
}
