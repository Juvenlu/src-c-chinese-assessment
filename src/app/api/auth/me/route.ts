import { NextRequest, NextResponse } from 'next/server';

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * GET /api/auth/me
 * 获取当前登录用户 + 孩子列表
 *
 * Production: Vercel → Worker → D1（fail-fast，绝不 fallback 到 Supabase）
 * Development: 优先 Worker，未配置时返回 401
 */
export async function GET(req: NextRequest) {
  try {
    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    // Production：必须走 Worker，配置缺失直接 fail-fast
    if (IS_PRODUCTION && !workerConfigured) {
      console.error(
        '[auth/me GET] PRODUCTION ERROR: Worker is not configured. ' +
          'Required: WORKER_GUEST_API_ENABLED=true, WORKER_BASE_URL, SRC_WORKER_SERVICE_KEY.',
      );
      return NextResponse.json(
        { user: null, children: [], error: '服务配置错误' },
        { status: 500 },
      );
    }

    // Worker 已配置：走 Vercel → Worker → D1
    if (workerConfigured) {
      // 透传浏览器的 Cookie（包含 src_auth_session）
      const cookieHeader = req.headers.get('cookie') || '';

      const res = await fetch(`${WORKER_BASE_URL}/v1/auth/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY as string,
          Cookie: cookieHeader,
        },
      });

      const data = await res.json();

      // 透传 Set-Cookie（如有）
      const setCookie = res.headers.get('set-cookie');
      const responseHeaders: Record<string, string> = {};
      if (setCookie) {
        responseHeaders['Set-Cookie'] = setCookie;
      }

      if (!res.ok) {
        // 401 等情况返回对应 status，保持现有前端 AuthProvider 兼容
        const fallback = data && typeof data === 'object'
          ? data
          : { user: null, children: [], error: '未登录' };
        return NextResponse.json(fallback, { status: res.status, headers: responseHeaders });
      }

      return NextResponse.json(data, { status: res.status, headers: responseHeaders });
    }

    // Worker 未配置（仅本地开发场景）：直接返回未登录
    return NextResponse.json(
      { user: null, children: [], error: '未配置 Worker' },
      { status: 401 },
    );
  } catch (err) {
    console.error('[auth/me GET] error:', err);
    return NextResponse.json(
      { user: null, children: [], error: '获取用户信息失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/me
 * 退出登录（POST /api/auth/me 是 Vercel 端 logout 路径）
 *
 * Production: 代理到 Worker /v1/auth/logout
 */
export async function POST(req: NextRequest) {
  try {
    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    // Production：必须走 Worker
    if (IS_PRODUCTION && !workerConfigured) {
      console.error(
        '[auth/me POST] PRODUCTION ERROR: Worker is not configured.',
      );
      return NextResponse.json(
        { error: '服务配置错误' },
        { status: 500 },
      );
    }

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

    // Worker 未配置：返回成功（无操作）
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[auth/me POST] error:', err);
    return NextResponse.json({ success: true });
  }
}
