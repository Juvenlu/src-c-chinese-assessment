import { NextRequest } from 'next/server';
import { proxySessionToWorker } from '../../../lib/session-proxy';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/classes/[id]/invite-code — 教师重新生成邀请码（旧码立即失效）
 * 无 body。本班归属校验由 Worker 端强制（他班 404）。
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) {
    return proxySessionToWorker(req, '/v1/classes/__invalid__/invite-code', 'invite-code POST');
  }
  return proxySessionToWorker(
    req,
    `/v1/classes/${encodeURIComponent(id)}/invite-code`,
    'invite-code POST',
  );
}
