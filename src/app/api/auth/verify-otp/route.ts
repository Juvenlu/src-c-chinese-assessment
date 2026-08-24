import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient as createClient } from '@/storage/database/supabase-client';
import {
  getSupabaseClient,
  isValidEmail,
  generateSessionToken,
} from '@/lib/auth-utils';

/**
 * POST /api/auth/verify-otp
 * 验证邮箱验证码并登录/注册 —— 使用 Supabase 原生 verifyOtp
 * body: { email, code }
 *
 * 验证成功后：
 * 1. 确保 parents_profiles 存在（auth.users 1:1 扩展）
 * 2. 更新 last_login_at
 * 3. 生成自定义 session token
 * 4. 返回 session + user + kids
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body.email || '').toString().trim().toLowerCase();
    const code = (body.code || '').toString().trim();

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的Email地址' }, { status: 400 });
    }

    if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
      return NextResponse.json({ error: '请输入6位数字验证码' }, { status: 400 });
    }

    // 用 Supabase 原生 verifyOtp 验证
    const supabaseForAuth = createClient();
    const { data: authData, error: authError } = await supabaseForAuth.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });

    if (authError || !authData.user) {
      console.error('[OTP] verify error:', authError?.message);
      // 区分常见错误
      if (authError?.message?.includes('expired')) {
        return NextResponse.json(
          { error: '验证码已过期，请重新获取' },
          { status: 400 }
        );
      }
      if (authError?.message?.includes('invalid') || authError?.status === 401) {
        return NextResponse.json(
          { error: '验证码不正确，请重新输入' },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: '验证失败，请稍后重试' },
        { status: 500 }
      );
    }

    const authUser = authData.user;
    const userId = authUser.id;
    const isNewUser = !authUser.email_confirmed_at
      || new Date(authUser.created_at).getTime() > Date.now() - 60 * 1000;

    const supabase = getSupabaseClient();

    // 确保 parents_profiles 存在
    const { data: existingProfile } = await supabase
      .from('parents_profiles')
      .select('id, email, created_at, subscription_status, plan_type, status')
      .eq('id', userId)
      .maybeSingle();

    if (!existingProfile) {
      await supabase.from('parents_profiles').insert({
        id: userId,
        email,
        email_verified: true,
        last_login_at: new Date().toISOString(),
        status: 'active',
      });
    } else {
      // 更新登录时间
      await supabase
        .from('parents_profiles')
        .update({
          email_verified: true,
          last_login_at: new Date().toISOString(),
        })
        .eq('id', userId);
    }

    // 获取孩子列表
    const { data: children } = await supabase
      .from('children')
      .select('id, nickname, age, grade, country, home_language, home_language_other, created_at, updated_at, status')
      .eq('parent_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    // 生成自定义 session token（与 getCurrentUser 解析兼容）
    const sessionToken = generateSessionToken(userId, email);

    const user = {
      id: userId,
      email,
      email_verified: true,
      created_at: existingProfile?.created_at || authUser.created_at,
    };

    return NextResponse.json({
      success: true,
      session: sessionToken,
      user,
      isNewUser,
      children: children || [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[OTP verify] unexpected error:', message);
    return NextResponse.json(
      { error: '验证失败，请稍后重试' },
      { status: 500 }
    );
  }
}
