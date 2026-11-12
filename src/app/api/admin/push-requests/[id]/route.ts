import { proxyToWorker } from '@/app/api/lib/worker-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 防路径注入：request id 为 Worker 生成的 UUID（hex + 连字符） */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * GET /api/admin/push-requests/[id] — 申请详情（P4-T9-1C-S5）
 *
 * 代理到 Worker /v1/admin/push-requests/:id：申请 + 班级 + 学生
 * （confirmed_level 权威链路、课堂未完成额度、逐孩子处理结果）
 * + 可选 Master（published 且系列匹配申请快照）+ 历史 NULL 快照阻断原因。
 * id 仅作路径透传；申请与班级/孩子的关联校验全部在 Worker 端完成。
 */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const target = SAFE_ID.test(id)
    ? `/v1/admin/push-requests/${encodeURIComponent(id)}`
    : '/v1/admin/push-requests/__invalid__';
  return proxyToWorker(request, target);
}
