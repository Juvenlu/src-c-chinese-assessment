import { NextRequest, NextResponse } from 'next/server';

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * GET /api/growth-map
 * 成长地图数据
 *
 * Production: Vercel → Worker → D1（fail-fast，绝不 fallback 到 Supabase）
 * Development: 优先 Worker，未配置时返回 500
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const childId = searchParams.get('child_id');

    if (!childId) {
      return NextResponse.json(
        { error: '缺少child_id参数' },
        { status: 400 },
      );
    }

    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    // Production：必须走 Worker，配置缺失直接 fail-fast
    if (IS_PRODUCTION && !workerConfigured) {
      console.error(
        '[growth-map GET] PRODUCTION ERROR: Worker is not configured. ' +
          'Required: WORKER_GUEST_API_ENABLED=true, WORKER_BASE_URL, SRC_WORKER_SERVICE_KEY.',
      );
      return NextResponse.json(
        { error: '服务配置错误' },
        { status: 500 },
      );
    }

    // Worker 已配置：走 Vercel → Worker → D1
    if (workerConfigured) {
      // 透传浏览器的 Cookie（包含 src_auth_session）
      const cookieHeader = req.headers.get('cookie') || '';

      const url = new URL(`${WORKER_BASE_URL}/v1/growth-map`);
      url.searchParams.set('child_id', childId);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY as string,
          Cookie: cookieHeader,
        },
        cache: 'no-store',
      });

      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json(data, { status: res.status });
      }

      return NextResponse.json(data, { status: res.status });
    }

    // Development 且未配置 Worker：返回错误
    return NextResponse.json(
      { error: 'Worker 未配置，无法获取成长地图数据' },
      { status: 500 },
    );
  } catch (error) {
    console.error('[growth-map GET] error:', error);
    return NextResponse.json(
      { error: '获取成长地图失败' },
      { status: 500 },
    );
  }
}
