import { NextRequest, NextResponse } from "next/server";
import { resolveWorkerUrl, WORKER_FETCH_INIT } from '../../../lib/worker-target';

/**
 * 家长忘记密码 — 凭 Token 设置新密码（P5-R1B）
 *
 * POST /api/auth/password-reset/commit  →  POST /v1/auth/password-reset/commit
 *
 * 安全：
 *   - Token 为 32 字节随机明文（仅管理员批准时展示一次），DB 仅存 sha256 摘要
 *   - 30 分钟有效、一次性、并发消费经 D1 batch() 原子拒绝
 *   - 提交后全部旧 Session 失效（session_version+1）
 *   - 不携带 Cookie（申请重置的用户可能已退出登录）
 */

const WORKER_BASE_URL = resolveWorkerUrl(process.env.WORKER_BASE_URL, process.env);
const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
  console.error('[auth/password-reset/commit] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
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

    const res = await fetch(`${WORKER_BASE_URL}/v1/auth/password-reset/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SRC-Service-Key': SERVICE_KEY,
      },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
      ...WORKER_FETCH_INIT,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    console.error('[auth/password-reset/commit] proxy error:', e);
    return NextResponse.json({ success: false, error: '网络错误' }, { status: 502 });
  }
}