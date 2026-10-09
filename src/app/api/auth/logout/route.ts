import { NextRequest, NextResponse } from 'next/server';

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * POST /api/auth/logout
 * 退出登录 — 代理到 Worker /v1/auth/logout
 *
 * 语义（fail-closed）：
 * - 仅在明确收到 Worker 的 2xx 成功响应后才返回 success:true。
 * - Worker 非 2xx、网络异常、响应非法（无 success 标识）、或 Worker 未配置，
 *   一律不返回 success:true（不把失败伪装成成功），由前端提示并允许重试。
 * - 清除 Cookie 的 Set-Cookie 始终按 Worker 原始值透传。
 */
export async function POST(req: NextRequest) {
  try {
    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    // 必须在配置齐全时才能确认退出成功；否则 fail closed（不发 success）
    if (!workerConfigured) {
      console.error('[auth/logout POST] Worker is not configured; logout refused (fail closed).');
      return NextResponse.json(
        { success: false, error: '认证服务不可用，无法确认退出' },
        { status: 502 },
      );
    }

    const cookieHeader = req.headers.get('cookie') || '';

    let res: Response;
    try {
      res = await fetch(`${WORKER_BASE_URL}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY as string,
          Cookie: cookieHeader,
        },
      });
    } catch (err) {
      console.error('[auth/logout POST] Worker network error:', err);
      // 无法与 Worker 通信 → 无法确认退出成功 → fail closed
      return NextResponse.json(
        { success: false, error: '认证服务不可用，无法确认退出' },
        { status: 502 },
      );
    }

    // 透传 Set-Cookie（清除 src_auth_session），无论成败都保留原始值
    const setCookie = res.headers.get('set-cookie');
    const responseHeaders: Record<string, string> = {};
    if (setCookie) {
      responseHeaders['Set-Cookie'] = setCookie;
    }

    // Worker 非 2xx：不返回 success，透传其错误状态
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: '退出登录失败' },
        { status: res.status, headers: responseHeaders },
      );
    }

    // Worker 2xx：解析 body 确认 success 标识，杜绝仅凭状态码判定成功
    const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
    if (!data || data.success !== true) {
      return NextResponse.json(
        { success: false, error: '退出登录失败' },
        { status: 502, headers: responseHeaders },
      );
    }

    return NextResponse.json(data, { status: 200, headers: responseHeaders });
  } catch (err) {
    console.error('[auth/logout POST] error:', err);
    // 兜底：任何未预期异常都不伪装成功
    return NextResponse.json(
      { success: false, error: '退出登录失败' },
      { status: 500 },
    );
  }
}
