import { NextRequest, NextResponse } from "next/server";
import { resolveWorkerUrl, WORKER_FETCH_INIT } from '../../lib/worker-target';

/**
 * 管理员 — 密码重置申请列表（P5-R1B）
 *
 * GET /api/admin/password-resets  →  GET /v1/admin/password-resets
 *
 * 鉴权：x-admin-password（Vercel 层不验证，转发给 Worker）+ X-SRC-Service-Key。
 * 安全：响应仅含 token_hash 摘要，绝不含明文 Token。
 */
const WORKER_BASE_URL = resolveWorkerUrl(process.env.WORKER_BASE_URL, process.env);
const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
  console.error('[admin/password-resets] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!WORKER_BASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ requests: [], error: '服务配置错误' }, { status: 500 });
  }

  try {
    const adminPwd = req.headers.get('x-admin-password') || '';

    const res = await fetch(`${WORKER_BASE_URL}/v1/admin/password-resets`, {
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
  } catch (e: unknown) {
    console.error('[admin/password-resets] proxy error:', e);
    return NextResponse.json({ requests: [], error: '网络错误' }, { status: 502 });
  }
}