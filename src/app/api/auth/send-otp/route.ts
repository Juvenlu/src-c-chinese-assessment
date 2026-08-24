import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabase, isValidEmail, maskEmail } from '@/lib/auth-utils';

/**
 * POST /api/auth/send-otp
 * 发送邮箱验证码（OTP）
 * body: { email }
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

    const supabase = getAdminSupabase();

    // 使用 Supabase Auth 发送 OTP
    // signInWithOtp 会自动处理：新用户创建 + 老用户发送
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // 不创建 session，验证后再创建
        shouldCreateUser: true,
        // 邮箱跳转 URL（也支持直接用 token 验证）
        emailRedirectTo: undefined,
      },
    });

    if (error) {
      console.error('[OTP] send failed:', error.message);
      
      // 频率限制
      if (error.message.includes('over email send rate limit') || error.status === 429) {
        return NextResponse.json(
          { error: '请稍等片刻后再次获取验证码' },
          { status: 429 }
        );
      }
      
      return NextResponse.json(
        { error: '发送失败，请稍后重试' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      maskedEmail: maskEmail(email),
      message: '验证码已发送，请查收邮箱',
    });
  } catch (err) {
    console.error('[OTP] unexpected error:', err);
    return NextResponse.json(
      { error: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}
