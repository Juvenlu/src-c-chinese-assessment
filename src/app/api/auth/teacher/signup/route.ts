import { NextRequest, NextResponse } from 'next/server';
import { resolveWorkerUrl, WORKER_FETCH_INIT } from '../../../lib/worker-target';

const WORKER_BASE_URL = resolveWorkerUrl(process.env.WORKER_BASE_URL, process.env);
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * POST /api/auth/teacher/signup
 * 教师邮箱 + 密码注册（P4-T1）
 * body: { email, password }
 *
 * 与家长注册共用同一套 parents 账号体系与 Argon2id 密码认证，
 * 服务端赋予 teacher 角色，不创建 children。
 *
 * Production: Vercel → Worker → D1（fail-fast，绝不 fallback 到 Supabase）
 * Development: 优先 Worker，未配置时返回 503（本阶段不提供 Supabase fallback）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    // Production：必须走 Worker，配置缺失直接 fail-fast
    if (IS_PRODUCTION && !workerConfigured) {
      console.error(
        '[auth/teacher/signup POST] PRODUCTION ERROR: Worker is not configured. ' +
          'Required: WORKER_GUEST_API_ENABLED=true, WORKER_BASE_URL, SRC_WORKER_SERVICE_KEY.',
      );
      return NextResponse.json(
        { error: '服务配置错误' },
        { status: 500 },
      );
    }

    if (workerConfigured) {
      const res = await fetch(`${WORKER_BASE_URL}/v1/auth/teacher/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY as string,
        },
        body: JSON.stringify(body),
        ...WORKER_FETCH_INIT,
      });

      const data = await res.json();

      // 透传 Set-Cookie（HMAC Session）
      const setCookie = res.headers.get('set-cookie');
      const responseHeaders: Record<string, string> = {};
      if (setCookie) {
        responseHeaders['Set-Cookie'] = setCookie;
      }

      return NextResponse.json(data, { status: res.status, headers: responseHeaders });
    }

    // Worker 未配置（仅本地开发场景）
    return NextResponse.json(
      { error: '未配置 Worker，教师注册暂不可用' },
      { status: 503 },
    );
  } catch (err) {
    console.error('[auth/teacher/signup POST] error:', err);
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 },
    );
  }
}
