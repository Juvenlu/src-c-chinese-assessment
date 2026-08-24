import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getCurrentUser,
  getSupabaseClient,
  SESSION_COOKIE_NAME,
} from '@/lib/auth-utils';

/**
 * GET /api/auth/me
 * 获取当前登录用户 + 孩子列表
 */
export async function GET(req: NextRequest) {
  try {
    // 优先从 header 取 x-session，其次从 cookie
    const token = req.headers.get('x-session')?.startsWith('Bearer ')
      ? req.headers.get('x-session')!.slice(7)
      : req.headers.get('x-session') || undefined;
    const user = await getCurrentUser(token);
    if (!user) {
      return NextResponse.json({ user: null, children: [] }, { status: 401 });
    }

    const supabase = getSupabaseClient();

    // 家长资料
    const { data: profile } = await supabase
      .from('parents_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // 孩子列表（白名单字段，避免泄露敏感信息）
    const { data: children } = await supabase
      .from('children')
      .select('id, nickname, age, grade, country, home_language, home_language_other, created_at, updated_at, status')
      .eq('parent_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    const userOut = profile
      ? {
          id: profile.id,
          email: profile.email,
          emailVerified: !!profile.email_verified,
          created_at: profile.created_at,
          last_login_at: profile.last_login_at,
          subscription_status: profile.subscription_status,
          plan_type: profile.plan_type,
          status: profile.status,
        }
      : { id: user.id, email: user.email, emailVerified: false };

    const childrenOut = (children || []).map((c: any) => {
      const { parent_id, ...rest } = c;
      return rest;
    });

    return NextResponse.json({
      user: userOut,
      children: childrenOut,
    });
  } catch (err) {
    console.error('[me] error:', err);
    return NextResponse.json(
      { error: '获取用户信息失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/logout
 * 退出登录
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (token) {
      try {
        const supabase = getSupabaseClient();
        await supabase.auth.admin.signOut(token);
      } catch {
        // 忽略登出错误（token 可能已失效）
      }
    }

    // 清除 cookie
    cookieStore.delete(SESSION_COOKIE_NAME);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[logout] error:', err);
    // 就算失败也清除 cookie
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
    return NextResponse.json({ success: true });
  }
}
