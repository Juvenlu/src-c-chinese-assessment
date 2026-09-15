import { NextRequest, NextResponse } from 'next/server';

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * POST /api/auth/login
 * 家长邮箱 + 密码登录
 * body: { email, password }
 *
 * Production: Vercel → Worker → D1（fail-fast，绝不 fallback 到 Supabase）
 * Development: 优先 Worker，未配置时 fallback Supabase（仅限本地开发）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    // Production：必须走 Worker，配置缺失直接 fail-fast
    if (IS_PRODUCTION && !workerConfigured) {
      console.error(
        '[auth/login POST] PRODUCTION ERROR: Worker is not configured. ' +
          'Required: WORKER_GUEST_API_ENABLED=true, WORKER_BASE_URL, SRC_WORKER_SERVICE_KEY.',
      );
      return NextResponse.json(
        { error: '服务配置错误' },
        { status: 500 },
      );
    }

    // Worker 已配置：走 Vercel → Worker → D1
    if (workerConfigured) {
      const res = await fetch(`${WORKER_BASE_URL}/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY as string,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      // 透传 Set-Cookie（HMAC Session）
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

    // Development fallback：Supabase（仅开发环境，Production 不会到达此处）
    const { getSupabaseClient, isValidEmail, generateSessionToken } = await import(
      '@/lib/auth-utils'
    );
    const bcrypt = (await import('bcryptjs')).default;

    const email = (body.email || '').toString().trim().toLowerCase();
    const password = (body.password || '').toString();

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: 'Email或密码不正确' },
        { status: 401 }
      );
    }

    if (!password) {
      return NextResponse.json(
        { error: 'Email或密码不正确' },
        { status: 401 }
      );
    }

    const supabase = getSupabaseClient();

    const { data: profile, error: profileError } = await supabase
      .from('parents_profiles')
      .select('id, email, password_hash, email_verified, created_at, status')
      .eq('email', email)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Email或密码不正确' },
        { status: 401 }
      );
    }

    if (profile.status !== 'active') {
      return NextResponse.json(
        { error: '账户已被禁用，请联系管理员' },
        { status: 403 }
      );
    }

    if (!profile.password_hash) {
      return NextResponse.json(
        { error: '账户需要设置密码，请使用忘记密码功能' },
        { status: 401 }
      );
    }

    const passwordValid = await bcrypt.compare(password, profile.password_hash);
    if (!passwordValid) {
      return NextResponse.json(
        { error: 'Email或密码不正确' },
        { status: 401 }
      );
    }

    await supabase
      .from('parents_profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', profile.id);

    const { data: children } = await supabase
      .from('children')
      .select('id, nickname, age, grade, country, home_language, home_language_other, created_at, updated_at, status')
      .eq('parent_id', profile.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    const sessionToken = generateSessionToken(profile.id, email);

    console.log(`[Login] ${email}, children=${children?.length || 0}`);

    return NextResponse.json({
      success: true,
      session: sessionToken,
      user: {
        id: profile.id,
        email: profile.email,
        email_verified: profile.email_verified,
        created_at: profile.created_at,
      },
      children: children || [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[Login] unexpected error:', message);
    return NextResponse.json(
      { error: '登录失败，请稍后重试' },
      { status: 500 }
    );
  }
}
