import { NextRequest, NextResponse } from "next/server";
import { resolveWorkerUrl, WORKER_FETCH_INIT } from '../../lib/worker-target';

/**
 * Admin Results — Worker Proxy（SRC-ADMIN-BUG-02）
 *
 * GET /api/admin/results  →  GET /v1/admin/results（D1 权威测试结果）
 *
 * 鉴权：
 *   1. x-admin-password（Vercel 层不验证，直接转发给 Worker）
 *   2. X-SRC-Service-Key（Vercel → Worker 服务间鉴权）
 *
 * 背景：原实现直连已弃用的 Supabase 旧库，导致 A02 测试结果停更。
 * 统一走 Worker → D1，绝不 fallback 到 Supabase / Legacy PG。
 */

const WORKER_BASE_URL = resolveWorkerUrl(process.env.WORKER_BASE_URL, process.env);
const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const WORKER_ENABLED =
  process.env.WORKER_GUEST_API_ENABLED === 'true' ||
  process.env.WORKER_CHILDREN_ENABLED === 'true' ||
  IS_PRODUCTION;

if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
  console.error('[admin/results] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

/**
 * GET /api/admin/results
 */
export async function GET(req: NextRequest) {
  if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
    if (IS_PRODUCTION) {
      return NextResponse.json({ data: [], error: '服务配置错误' }, { status: 500 });
    }
    return NextResponse.json({ data: [], error: 'Worker 未启用' }, { status: 503 });
  }

  try {
    const adminPwd = req.headers.get('x-admin-password') || '';

    const res = await fetch(`${WORKER_BASE_URL}/v1/admin/results`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPwd,
        'X-SRC-Service-Key': SERVICE_KEY,
      },
      cache: 'no-store',
      ...WORKER_FETCH_INIT,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    console.error('[admin/results] proxy error:', e);
    return NextResponse.json({ data: [], error: '网络错误' }, { status: 502 });
  }
}