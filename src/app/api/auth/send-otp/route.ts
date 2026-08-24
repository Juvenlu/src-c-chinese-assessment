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

    // 检查家长档案是否存在
    const { data: profile } = await supabase
      .from('parents_profiles')
      .select('id, email')
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

    // 使用 Supabase Auth 发送 OTP
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
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
      isExistingAccount,
      childCount,
    });
  } catch (err) {
    console.error('[OTP] unexpected error:', err);
    return NextResponse.json(
      { error: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}
