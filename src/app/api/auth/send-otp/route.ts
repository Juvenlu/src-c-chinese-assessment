import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseClient, isValidEmail, maskEmail } from '@/lib/auth-utils';

// 验证码有效期（毫秒）- 10分钟
const OTP_EXPIRY_MS = 10 * 60 * 1000;
// 验证码长度
const OTP_LENGTH = 6;
// 重发间隔（秒）
const RESEND_COOLDOWN_SEC = 60;
// 每小时最大发送次数
const MAX_SENDS_PER_HOUR = 5;

/**
 * 生成6位数字验证码
 */
function generateOtpCode(): string {
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i++) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

/**
 * 哈希验证码（不存明文）
 */
function hashOtp(code: string, email: string): string {
  return crypto
    .createHash('sha256')
    .update(`${email.toLowerCase()}:${code}`)
    .digest('hex');
}

/**
 * POST /api/auth/send-otp
 * 发送邮箱验证码（OTP）
 * body: { email, purpose? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body.email || '').toString().trim().toLowerCase();
    const purpose = body.purpose || 'login';

    if (!email) {
      return NextResponse.json({ error: '请输入邮箱地址' }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的Email地址' }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const now = new Date();

    // 检查频率限制：60秒内不能重发
    const oneMinuteAgo = new Date(now.getTime() - RESEND_COOLDOWN_SEC * 1000);
    const { data: recentSend } = await supabase
      .from('otp_codes')
      .select('id, created_at')
      .eq('email', email)
      .eq('purpose', purpose)
      .gt('created_at', oneMinuteAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentSend) {
      const secondsLeft = RESEND_COOLDOWN_SEC - Math.floor(
        (now.getTime() - new Date(recentSend.created_at).getTime()) / 1000
      );
      return NextResponse.json(
        { error: `请${secondsLeft}秒后再获取验证码` },
        { status: 429 }
      );
    }

    // 检查每小时发送次数上限
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const { count: sendsInLastHour } = await supabase
      .from('otp_codes')
      .select('*', { count: 'exact', head: true })
      .eq('email', email)
      .eq('purpose', purpose)
      .gt('created_at', oneHourAgo.toISOString());

    if ((sendsInLastHour || 0) >= MAX_SENDS_PER_HOUR) {
      return NextResponse.json(
        { error: '发送次数过多，请稍后再试' },
        { status: 429 }
      );
    }

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

    // 生成验证码
    const code = generateOtpCode();
    const codeHash = hashOtp(code, email);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    // 保存验证码
    const { error: insertError } = await supabase
      .from('otp_codes')
      .insert({
        email,
        code_hash: codeHash,
        purpose,
        expires_at: expiresAt.toISOString(),
        attempts_remaining: 5,
      });

    if (insertError) {
      console.error('[OTP] save failed:', insertError.message);
      return NextResponse.json(
        { error: '发送失败，请稍后重试' },
        { status: 500 }
      );
    }

    // 开发环境下直接返回验证码（便于测试），生产环境通过邮件发送
    const isDev = process.env.NODE_ENV !== 'production'
      || process.env.COZE_PROJECT_ENV === 'DEV'
      || process.env.NEXT_PUBLIC_DEV_MODE === 'true';

    // TODO: 接入真实SMTP后，通过邮件发送验证码
    // 当前环境无SMTP配置，开发模式直接返回验证码便于联调
    const devCode = isDev ? code : undefined;

    console.log(`[OTP] sent to ${email}, code=${devCode || '***'}, existing=${isExistingAccount}`);

    return NextResponse.json({
      success: true,
      maskedEmail: maskEmail(email),
      message: '验证码已发送，请查收邮箱',
      isExistingAccount,
      childCount,
      expiresIn: OTP_EXPIRY_MS / 1000,
      // 仅开发环境返回，生产环境移除
      ...(devCode ? { dev_code: devCode } : {}),
    });
  } catch (err) {
    console.error('[OTP] unexpected error:', err);
    return NextResponse.json(
      { error: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}
