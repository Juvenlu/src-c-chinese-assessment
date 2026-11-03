import { NextRequest, NextResponse } from 'next/server';
import { resolveWorkerUrl, WORKER_FETCH_INIT } from '../../lib/worker-target';

const WORKER_BASE_URL = resolveWorkerUrl(process.env.WORKER_BASE_URL, process.env);
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * GET /api/teacher/me
 * 教师中心服务端鉴权（P4-T1）
 *
 * 透传 Cookie 与 x-session 双通道 Session，
 * Worker 端校验 Session 有效且 roles 含 teacher 才返回 200，
 * 非教师账号返回 403，未登录返回 401。
 *
 * Production: Vercel → Worker → D1（fail-fast）
 */
export async function GET(req: NextRequest) {
  try {
    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    if (IS_PRODUCTION && !workerConfigured) {
      console.error(
        '[teacher/me GET] PRODUCTION ERROR: Worker is not configured. ' +
          'Required: WORKER_GUEST_API_ENABLED=true, WORKER_BASE_URL, SRC_WORKER_SERVICE_KEY.',
      );
      return NextResponse.json(
        { user: null, error: '服务配置错误' },
        { status: 500 },
      );
    }

    if (workerConfigured) {
      // 透传浏览器 Cookie（src_auth_session）。
      // 与 /api/auth/me 代理一致：Worker 端当前仅识别 Cookie 通道
      // （getSessionFromRequest 只读 Cookie），前端 authFetch 冗余携带的
      // x-session header 在 Worker 端不生效，故不透传，避免暗示不存在的通道。
      const cookieHeader = req.headers.get('cookie') || '';

      const res = await fetch(`${WORKER_BASE_URL}/v1/teacher/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY as string,
          Cookie: cookieHeader,
        },
        ...WORKER_FETCH_INIT,
      });

      const data = await res.json();
      const fallback = data && typeof data === 'object'
        ? data
        : { user: null, error: '获取教师信息失败' };
      return NextResponse.json(fallback, { status: res.status });
    }

    return NextResponse.json(
      { user: null, error: '未配置 Worker' },
      { status: 503 },
    );
  } catch (err) {
    console.error('[teacher/me GET] error:', err);
    return NextResponse.json(
      { user: null, error: '获取教师信息失败' },
      { status: 500 },
    );
  }
}
