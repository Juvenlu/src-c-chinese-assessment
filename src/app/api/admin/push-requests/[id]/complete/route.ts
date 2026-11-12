import { proxyToWorker } from '@/app/api/lib/worker-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 防路径注入：request id 为 Worker 生成的 UUID（hex + 连字符） */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * POST /api/admin/push-requests/[id]/complete — 汇总关闭申请（P4-T9-1C-S5）
 *
 * Body: { skips?: [{ child_id, reason }] }——仍为 processing 的成员必须全部
 * 显式 skip 且给出非空原因（Worker 端强制，skipped 不计为成功）。
 * 汇总：全 ok/skipped → done；存在 failed → failed 并写摘要。
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const target = SAFE_ID.test(id)
    ? `/v1/admin/push-requests/${encodeURIComponent(id)}/complete`
    : '/v1/admin/push-requests/__invalid__/complete';
  return proxyToWorker(request, target);
}
