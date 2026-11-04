import { NextRequest } from 'next/server';
import { proxySessionToWorker } from '../../lib/session-proxy';

/**
 * POST /api/classes/join — 家长授权自己孩子入班
 * body: { invite_code, child_id }
 *
 * 孩子归属校验、邀请码频控、幂等加入均由 Worker 端强制；
 * 本代理仅透传 Cookie 与 body，Service Key 服务端注入。
 *
 * 注意：/api/classes/join 为静态段，优先于 /api/classes/[id] 匹配。
 */
export async function POST(req: NextRequest) {
  return proxySessionToWorker(req, '/v1/classes/join', 'classes/join POST');
}
