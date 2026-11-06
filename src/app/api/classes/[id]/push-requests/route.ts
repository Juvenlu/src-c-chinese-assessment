import { NextRequest } from 'next/server';
import { proxySessionToWorker } from '../../../lib/session-proxy';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 防路径注入：id 只允许安全字符（UUID 为 hex + 连字符），与 classes/[id] 既有规范一致 */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

function resolveTarget(id: string): string {
  return SAFE_ID.test(id)
    ? `/v1/classes/${encodeURIComponent(id)}/push-requests`
    : '/v1/classes/__invalid__/push-requests';
}

/**
 * GET /api/classes/[id]/push-requests — 教师查看本班推送请求状态（他班 404）
 *
 * classId 仅作路径参数透传，归属与角色校验由 Worker 端强制。
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return proxySessionToWorker(req, resolveTarget(id), 'push-requests GET');
}

/**
 * POST /api/classes/[id]/push-requests — 教师一键提交绘本推送请求（幂等）
 *
 * 无请求参数；重复提交由 Worker 返回既有未完成请求（200），不创建重复待办。
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return proxySessionToWorker(req, resolveTarget(id), 'push-requests POST');
}
