import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import {
  getSupabaseClient,
  isValidEmail,
  generateSessionToken,
} from '@/lib/auth-utils';

/**
 * POST /api/auth/login
 * 家长邮箱 + 密码登录
 * body: { email, password }
 *
 * 安全要求：
 * - 错误密码不泄露 Email 是否存在（统一提示 "Email或密码不正确"）
 * - 登录成功更新 last_login_at
 * - 返回 session token + user + children
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body.email || '').toString().trim().toLowerCase();
    const password = (body.password || '').toString();

    // ===== 基础校验 =====
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

    // ===== 查询家长档案 =====
    const { data: profile, error: profileError } = await supabase
      .from('parents_profiles')
      .select('id, email, password_hash, email_verified, created_at, status')
      .eq('email', email)
      .maybeSingle();

    if (profileError || !profile) {
      // 不泄露账户是否存在
      return NextResponse.json(
        { error: 'Email或密码不正确' },
        { status: 401 }
      );
    }

    // ===== 状态检查 =====
    if (profile.status !== 'active') {
      return NextResponse.json(
        { error: '账户已被禁用，请联系管理员' },
        { status: 403 }
      );
    }

    // ===== 密码校验 =====
    if (!profile.password_hash) {
      // 没有密码（可能是之前 OTP 注册的），提示用户重置
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

    // ===== 更新登录时间 =====
    await supabase
      .from('parents_profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', profile.id);

    // ===== 获取孩子列表 =====
    const { data: children } = await supabase
      .from('children')
      .select('id, nickname, age, grade, country, home_language, home_language_other, created_at, updated_at, status')
      .eq('parent_id', profile.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    // ===== 生成 session token =====
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
