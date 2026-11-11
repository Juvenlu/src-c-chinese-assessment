import { proxyToWorker } from '@/app/api/lib/worker-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 防路径注入：request id 为 Worker 生成的 UUID（hex + 连字符） */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * POST /api/admin/push-requests/[id]/claim — 领取申请（P4-T9-1C-S5）
 *
 * 幂等重入：pending → processing（并发仅一个生效），processing 重复领取安全；
 * 领取时 Worker 为班级全部 active 成员预建 class_push_results(processing) 断点行。
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const target = SAFE_ID.test(id)
    ? `/v1/admin/push-requests/${encodeURIComponent(id)}/claim`
    : '/v1/admin/push-requests/__invalid__/claim';
  return proxyToWorker(request, target);
}
