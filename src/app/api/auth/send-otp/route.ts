import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient as createClient } from '@/storage/database/supabase-client';
import { getSupabaseClient, isValidEmail, maskEmail } from '@/lib/auth-utils';

/**
 * POST /api/auth/send-otp
 * 发送邮箱验证码（OTP）— 使用 Supabase 原生 OTP 邮件发送
 * body: { email, purpose? }
 *
 * Supabase 原生 signInWithOtp 会自动：
 * 1. 生成 6 位数字验证码
 * 2. 通过配置的邮件服务发送到用户邮箱
 * 3. 验证码 10 分钟有效
 * 4. 新用户自动创建 auth.users 记录
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body.email || '').toString().trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: '请输入邮箱地址' }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的Email地址' }, { status: 400 });
    }

    // 用 Supabase 客户端调用 signInWithOtp
    const supabaseForAuth = createClient();
    const { data, error } = await supabaseForAuth.auth.signInWithOtp({
      email,
      options: {
        // 新用户自动创建账户
        shouldCreateUser: true,
        // 不返回用户信息（只发邮件）
        emailRedirectTo: undefined,
      },
    });

    if (error) {
      console.error('[OTP] send error:', error.message);
      // Supabase 频控错误处理
      if (error.message.includes('rate limit') || error.status === 429) {
        return NextResponse.json(
          { error: '发送次数过多，请稍后再试' },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: '发送失败，请稍后重试' },
        { status: 500 }
      );
    }

    // 检查是否已有家长档案（用于前端判断走注册还是登录流程）
    const supabase = getSupabaseClient();
    const { data: profile } = await supabase
      .from('parents_profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    const isExistingAccount = !!profile;
    let childCount = 0;

    if (isExistingAccount && profile) {
      const { count } = await supabase
        .from('children')
        .select('*', { count: 'exact', head: true })
        .eq('parent_id', profile.id)
        .eq('status', 'active');
      childCount = count || 0;
    }

    // 开发环境下从返回中提取验证码（仅用于联调，生产环境通过邮件送达）
    // Supabase 1.x signInWithOtp 在 shouldCreateUser 时可能返回 user
    // 这里不依赖返回值，验证码通过邮件送达
    const isDev = process.env.NODE_ENV !== 'production'
      || process.env.COZE_PROJECT_ENV === 'DEV';

    console.log(`[OTP] sent via Supabase to ${email}, existing=${isExistingAccount}`);

    return NextResponse.json({
      success: true,
      maskedEmail: maskEmail(email),
      message: '验证码已发送，请查收邮箱',
      isExistingAccount,
      childCount,
      expiresIn: 600, // 10分钟，和 Supabase 默认一致
      // 开发环境日志提示
      ...(isDev ? { _dev_note: '验证码已通过Supabase邮件系统发送，请检查收件箱' } : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[OTP] unexpected error:', message);
    return NextResponse.json(
      { error: '发送失败，请稍后重试' },
      { status: 500 }
    );
  }
}
