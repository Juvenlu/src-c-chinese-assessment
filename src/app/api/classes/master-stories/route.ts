import { NextRequest } from 'next/server';
import { proxySessionToWorker } from '../../lib/session-proxy';

/**
 * GET /api/classes/master-stories — 已发布 Master 故事列表（教师只读，P4-T9-1C-S5）
 *
 * 可选 query：?series_id=<正整数>（按系列过滤，与 Worker /v1/classes/master-stories 对齐）。
 * series_id 在代理层做格式校验（仅正整数），非法值不落 Worker 直接 400；
 * 列表数据本身不做任何缓存与改写。
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('series_id');
  let target = '/v1/classes/master-stories';
  if (raw !== null) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      return Response.json({ error: 'series_id 必须为正整数' }, { status: 400 });
    }
    target += `?series_id=${n}`;
  }
  return proxySessionToWorker(req, target, 'master-stories GET');
}
