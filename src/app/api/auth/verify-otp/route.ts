import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getAdminSupabase,
  isValidEmail,
  SESSION_COOKIE_NAME,
  getSessionCookieOptions,
  SESSION_DURATION_DAYS,
} from '@/lib/auth-utils';

/**
 * POST /api/auth/verify-otp
 * 验证 OTP 并创建 session
 * body: { email, token }
 * 
 * 返回：{ session, user, isNewUser }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body.email || '').toString().trim().toLowerCase();
    const token = (body.token || '').toString().trim();

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的Email地址' }, { status: 400 });
    }

    if (!token || token.length < 4) {
      return NextResponse.json({ error: '请输入验证码' }, { status: 400 });
    }

    const supabase = getAdminSupabase();

    // 先看看这个邮箱是否已存在
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const existingUser = users?.find(u => u.email?.toLowerCase() === email);
    const isNewUser = !existingUser;

    // 验证 OTP
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });

    if (error) {
      console.error('[OTP] verify failed:', error.message);
      
      if (error.message.includes('expired') || error.message.includes('invalid') || error.message.includes('not found')) {
        return NextResponse.json(
          { error: '验证码不正确或已过期，请重新获取' },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { error: '验证失败，请稍后重试' },
        { status: 500 }
      );
    }

    const { user, session } = data;
    if (!user || !session) {
      return NextResponse.json(
        { error: '验证失败，请稍后重试' },
        { status: 500 }
      );
    }

    // 更新或创建 parents_profiles
    await upsertParentProfile(supabase, user.id, email);

    // 写入 session cookie
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, session.access_token, getSessionCookieOptions(SESSION_DURATION_DAYS));

    return NextResponse.json({
      success: true,
      isNewUser,
      user: {
        id: user.id,
        email: user.email,
        emailVerified: !!user.email_confirmed_at,
      },
    });
  } catch (err) {
    console.error('[OTP verify] unexpected error:', err);
    return NextResponse.json(
      { error: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}

/**
 * 创建或更新家长资料
 */
async function upsertParentProfile(supabase: ReturnType<typeof getAdminSupabase>, userId: string, email: string) {
  // 检查是否已存在
  const { data: existing } = await supabase
    .from('parents_profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (existing) {
    // 更新最后登录时间
    await supabase
      .from('parents_profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', userId);
  } else {
    // 新建
    await supabase
      .from('parents_profiles')
      .insert({
        id: userId,
        email,
        last_login_at: new Date().toISOString(),
      });
  }
}
