import { NextRequest, NextResponse } from 'next/server';

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * POST /api/auth/logout
 * 退出登录 — 代理到 Worker /v1/auth/logout
 *
 * Production: Vercel → Worker → 清除 src_auth_session Cookie
 * Development: 优先 Worker，未配置时返回 success（client-side 状态清理兜底）
 */
export async function POST(req: NextRequest) {
  try {
    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    // Production：必须走 Worker，配置缺失直接 fail-fast
    if (IS_PRODUCTION && !workerConfigured) {
      console.error(
        '[auth/logout POST] PRODUCTION ERROR: Worker is not configured. ' +
          'Required: WORKER_GUEST_API_ENABLED=true, WORKER_BASE_URL, SRC_WORKER_SERVICE_KEY.',
      );
      return NextResponse.json(
        { error: '服务配置错误' },
        { status: 500 },
      );
    }

    // Worker 已配置：走 Vercel → Worker → 清除 Session Cookie
    if (workerConfigured) {
      const cookieHeader = req.headers.get('cookie') || '';

      const res = await fetch(`${WORKER_BASE_URL}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY as string,
          Cookie: cookieHeader,
        },
      });

      const data = await res.json();

      // 透传 Set-Cookie（清除 src_auth_session）
      const setCookie = res.headers.get('set-cookie');
      const responseHeaders: Record<string, string> = {};
      if (setCookie) {
        responseHeaders['Set-Cookie'] = setCookie;
      }

      if (!res.ok) {
        return NextResponse.json(data, { status: res.status, headers: responseHeaders });
      }

      return NextResponse.json(data, { status: res.status, headers: responseHeaders });
    }

    // Worker 未配置：返回成功（client-side 清理兜底）
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[auth/logout POST] error:', err);
    // 就算失败也返回成功，由 client-side 清理状态
    return NextResponse.json({ success: true });
  }
}
