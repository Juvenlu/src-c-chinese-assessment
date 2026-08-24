import { NextRequest, NextResponse } from 'next/server';
import {
  getSupabaseClient,
  isValidEmail,
  maskEmail,
  generateOtpCode,
  hashOtpCode,
  checkOtpRateLimit,
} from '@/lib/auth-utils';

/**
 * POST /api/auth/send-otp
 * 发送邮箱验证码（自建 OTP）
 * body: { email, purpose? }
 *
 * 自建 OTP 优势：
 * 1. 完全控制验证码生成、存储、过期、频控
 * 2. 可灵活对接不同邮件服务商（SMTP、Resend、SendGrid 等）
 * 3. 开发环境直接返回 dev_code 便于联调
 * 4. 不依赖 Supabase 内置邮件服务（免费层容易被 Outlook 拦截）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body.email || '').toString().trim().toLowerCase();
    const purpose = (body.purpose || 'login').toString().trim(); // login / signup

    if (!email) {
      return NextResponse.json({ error: '请输入邮箱地址' }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的Email地址' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // ===== 频控检查 =====
    const rateLimitError = await checkOtpRateLimit(supabase, email);
    if (rateLimitError) {
      return NextResponse.json({ error: rateLimitError }, { status: 429 });
    }

    // ===== 生成验证码 =====
    const code = generateOtpCode(); // 6 位数字
    const codeHash = await hashOtpCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分钟有效

    // ===== 存入 otp_codes 表 =====
    const { error: insertError } = await supabase.from('otp_codes').insert({
      email,
      code_hash: codeHash,
      purpose,
      expires_at: expiresAt.toISOString(),
      attempts_remaining: 5,
      used: false,
      revoked: false,
    });

    if (insertError) {
      console.error('[OTP] insert error:', insertError.message);
      return NextResponse.json(
        { error: '发送失败，请稍后重试' },
        { status: 500 }
      );
    }

    // ===== 发送邮件 =====
    // 开发环境直接返回 dev_code，不真正发邮件
    const isDev = process.env.NODE_ENV !== 'production'
      || process.env.COZE_PROJECT_ENV === 'DEV';

    let sentViaEmail = true;

    if (isDev) {
      // 开发模式：不发邮件，直接在日志输出 + 返回 dev_code
      console.log(`[OTP] DEV mode - code for ${email}: ${code}`);
      sentViaEmail = false;
    } else {
      // 生产/正式环境：尝试发送邮件
      try {
        const emailSent = await sendOtpEmail(email, code, purpose);
        if (!emailSent) {
          // 邮件发送失败，不阻断验证码本身（前端可以提示检查垃圾邮件）
          console.warn(`[OTP] email delivery may have failed for ${email}`);
        }
      } catch (emailErr) {
        console.error('[OTP] email send error:', emailErr);
        // 邮件发送异常不回滚验证码（用户可能通过其他渠道获取）
      }
    }

    // ===== 检查是否已有家长档案 =====
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

    console.log(`[OTP] sent to ${email}, existing=${isExistingAccount}, dev=${isDev}`);

    return NextResponse.json({
      success: true,
      maskedEmail: maskEmail(email),
      message: sentViaEmail
        ? '验证码已发送，请查收邮箱'
        : '验证码已生成，开发模式请查看控制台',
      isExistingAccount,
      childCount,
      expiresIn: 600, // 10 分钟
      // 开发环境直接返回验证码（便于联调测试）
      ...(isDev ? { dev_code: code } : {}),
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

/**
 * 发送 OTP 验证码邮件
 * 优先使用环境变量配置的 SMTP / Resend，没有配置则跳过
 */
async function sendOtpEmail(
  email: string,
  code: string,
  purpose: string
): Promise<boolean> {
  // 检查是否有配置 Resend API Key
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'SRC中文成长平台 <noreply@src-chinese.com>',
          to: [email],
          subject: '您的SRC中文成长平台验证码',
          html: buildOtpEmailHtml(code, purpose),
        }),
      });

      if (response.ok) {
        console.log(`[OTP] email sent via Resend to ${email}`);
        return true;
      }
      const data = await response.json();
      console.error('[OTP] Resend error:', data);
      return false;
    } catch (e) {
      console.error('[OTP] Resend request failed:', e);
      return false;
    }
  }

  // 检查是否有配置自定义 SMTP
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    // SMTP 发送需要 nodemailer 等库，这里暂不实现
    // 如有需要可后续接入
    console.warn('[OTP] SMTP configured but not implemented, skipping email');
    return false;
  }

  // 没有配置任何邮件服务
  console.warn('[OTP] no email service configured, OTP not sent via email');
  return false;
}

function buildOtpEmailHtml(code: string, purpose: string): string {
  const purposeText = purpose === 'signup' ? '注册' : '登录';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SRC中文成长平台验证码</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #FFF8F0; }
    .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    h1 { color: #FF6B35; font-size: 24px; margin-top: 0; }
    .code { font-size: 36px; font-weight: bold; color: #2D3436; letter-spacing: 8px; text-align: center; padding: 20px; background: #FFF8F0; border-radius: 12px; margin: 24px 0; }
    .info { color: #636E72; line-height: 1.6; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐒 SRC中文成长平台</h1>
    <p>您好，</p>
    <p>您正在进行<span style="color: #FF6B35; font-weight: bold;">${purposeText}</span>操作，您的验证码是：</p>
    <div class="code">${code}</div>
    <div class="info">
      <p>• 验证码有效期为 <strong>10 分钟</strong></p>
      <p>• 请勿将验证码告诉他人</p>
      <p>• 如非您本人操作，请忽略此邮件</p>
    </div>
    <div class="footer">
      SRC中文成长平台 · 让中文学习更有趣<br>
      此邮件由系统自动发送，请勿直接回复
    </div>
  </div>
</body>
</html>`;
}
