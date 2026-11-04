import { NextRequest } from 'next/server';
import { proxySessionToWorker } from '../../lib/session-proxy';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/classes/[id] — 教师查看本班详情与学生名单（他班 404，不泄露存在性）
 *
 * classId 仅作路径参数透传，归属与角色校验由 Worker 端强制。
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  // 防路径注入：id 只允许安全字符（UUID 为 hex + 连字符）
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) {
    return proxySessionToWorker(req, '/v1/classes/__invalid__', 'classes/[id] GET');
  }
  return proxySessionToWorker(req, `/v1/classes/${encodeURIComponent(id)}`, 'classes/[id] GET');
}
