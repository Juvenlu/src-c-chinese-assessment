import { NextRequest } from 'next/server';
import { proxySessionToWorker } from '../../../lib/session-proxy';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 防路径注入：id 只允许安全字符（UUID 为 hex + 连字符），与 classes/[id] 既有规范一致 */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

function resolveTarget(id: string): string {
  return SAFE_ID.test(id)
    ? `/v1/classes/${encodeURIComponent(id)}/series`
    : '/v1/classes/__invalid__/series';
}

/**
 * PATCH /api/classes/[id]/series — 教师设置本班故事系列（P4-T9-1C-S5）
 *
 * Body: { story_series_id: number | null }（正整数或 null 清除）。
 * classId 仅作路径参数透传，归属与角色校验由 Worker 端强制（他班 404）。
 * 系列存在性校验在 Worker 端完成；本代理不缓存、不改写 body。
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return proxySessionToWorker(req, resolveTarget(id), 'class-series PATCH');
}
