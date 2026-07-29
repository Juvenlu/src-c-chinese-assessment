import { NextRequest, NextResponse } from 'next/server';

/**
 * 发送邮箱验证码 API
 * 注意：这是演示版本，实际生产环境需要集成真实的邮件服务（如 SendGrid、AWS SES 等）
 */
export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json();

    if (!email || !code) {
      return NextResponse.json(
        { error: '邮箱和验证码不能为空' },
        { status: 400 }
      );
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: '邮箱格式不正确' },
        { status: 400 }
      );
    }

    // 验证验证码格式（6 位数字）
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: '验证码格式不正确' },
        { status: 400 }
      );
    }

    // TODO: 实际生产环境中，这里应该调用邮件服务发送验证码
    // 例如使用 SendGrid、AWS SES、阿里云邮件推送等
    // 示例代码：
    // await sendEmail({
    //   to: email,
    //   subject: 'SRC-C 验证码',
    //   html: `<p>您的验证码是：<strong>${code}</strong></p><p>验证码 5 分钟内有效。</p>`
    // });

    console.log(`[验证码] 邮箱：${email}, 验证码：${code}`);

    return NextResponse.json({
      success: true,
      message: '验证码已发送',
    });
  } catch (error) {
    console.error('发送验证码失败:', error);
    return NextResponse.json(
      { error: '发送失败，请重试' },
      { status: 500 }
    );
  }
}
