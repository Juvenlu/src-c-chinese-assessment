import { NextRequest, NextResponse } from "next/server";
import { resolveWorkerUrl, WORKER_FETCH_INIT } from '../../../lib/worker-target';

/**
 * 家长忘记密码 — 提交重置申请（P5-R1B）
 *
 * POST /api/auth/password-reset/request  →  POST /v1/auth/password-reset/request
 *
 * 安全：
 *   - 邮箱存在/不存在/禁用统一返回 {success:true}（防枚举）
 *   - 双维限流（email 60s/1、1h/5；IP 1h/10）由 Worker 执行
 *   - 全程无鉴权（游客可申请）
 */

const WORKER_BASE_URL = resolveWorkerUrl(process.env.WORKER_BASE_URL, process.env);
const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
  console.error('[auth/password-reset/request] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!WORKER_BASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ success: false, error: '服务配置错误' }, { status: 500 });
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const res = await fetch(`${WORKER_BASE_URL}/v1/auth/password-reset/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SRC-Service-Key': SERVICE_KEY,
        'X-Forwarded-For': req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '',
      },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
      ...WORKER_FETCH_INIT,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    console.error('[auth/password-reset/request] proxy error:', e);
    return NextResponse.json({ success: false, error: '网络错误' }, { status: 502 });
  }
}