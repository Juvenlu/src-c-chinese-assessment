import { NextRequest, NextResponse } from 'next/server';
import {
  getSupabaseClient,
  isValidEmail,
  generateSessionToken,
  verifyOtpHash,
} from '@/lib/auth-utils';

/**
 * POST /api/auth/verify-otp
 * 验证邮箱验证码并登录/注册 —— 自建 OTP 验证
 * body: { email, code }
 *
 * 验证成功后：
 * 1. 确保 auth.users + parents_profiles 存在
 * 2. 更新 last_login_at + email_verified
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

    const supabase = getSupabaseClient();

    // ===== 查找最新未使用的验证码 =====
    const { data: otpRecords, error: queryError } = await supabase
      .from('otp_codes')
      .select('id, email, code_hash, expires_at, attempts_remaining, used, revoked, created_at')
      .eq('email', email)
      .eq('used', false)
      .eq('revoked', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    if (queryError) {
      console.error('[OTP] query error:', queryError.message);
      return NextResponse.json(
        { error: '验证失败，请稍后重试' },
        { status: 500 }
      );
    }

    if (!otpRecords || otpRecords.length === 0) {
      return NextResponse.json(
        { error: '验证码已过期，请重新获取' },
        { status: 400 }
      );
    }

    // 逐个检查验证码
    let matchedOtp: typeof otpRecords[0] | null = null;

    for (const record of otpRecords) {
      if (verifyOtpHash(code, record.code_hash)) {
        matchedOtp = record;
        break;
      }
    }

    if (!matchedOtp) {
      // 验证码不正确，扣减尝试次数
      const latest = otpRecords[0];
      const newAttempts = Math.max(0, latest.attempts_remaining - 1);

      await supabase
        .from('otp_codes')
        .update({ attempts_remaining: newAttempts, revoked: newAttempts <= 0 })
        .eq('id', latest.id);

      if (newAttempts <= 0) {
        return NextResponse.json(
          { error: '错误次数过多，验证码已失效，请重新获取' },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: '验证码不正确，请重新输入' },
        { status: 400 }
      );
    }

    // ===== 验证成功，标记为已使用 =====
    await supabase
      .from('otp_codes')
      .update({ used: true })
      .eq('id', matchedOtp.id);

    // ===== 查找或创建 auth.user =====
    let userId: string;
    let isNewUser = false;
    let createdAt: string;

    // 先查询 auth.users
    const { data: authUser, error: authLookupError } = await supabase.auth.admin.listUsers();
    const existingAuthUser = authUser?.users?.find(
      (u) => u.email?.toLowerCase() === email
    );

    if (existingAuthUser) {
      userId = existingAuthUser.id;
      createdAt = existingAuthUser.created_at;
    } else {
      // 新用户，通过 admin API 创建 auth.user（不发确认邮件）
      const { data: newAuthData, error: createAuthError } =
        await supabase.auth.admin.createUser({
          email,
          email_confirm: true, // 直接确认，不需要邮件
          user_metadata: { source: 'otp_signup' },
        });

      if (createAuthError || !newAuthData.user) {
        console.error('[OTP] create auth user error:', createAuthError?.message);
        // 可能是并发创建，再查一次
        const { data: retryData } = await supabase.auth.admin.listUsers();
        const retryUser = retryData?.users?.find(
          (u) => u.email?.toLowerCase() === email
        );
        if (retryUser) {
          userId = retryUser.id;
          createdAt = retryUser.created_at;
        } else {
          throw new Error('创建账户失败: ' + (createAuthError?.message || 'unknown'));
        }
      } else {
        userId = newAuthData.user.id;
        createdAt = newAuthData.user.created_at;
        isNewUser = true;
      }
    }

    // ===== 查找或创建 parents_profiles =====
    const { data: existingProfile } = await supabase
      .from('parents_profiles')
      .select('id, email, created_at, subscription_status, plan_type, status, email_verified')
      .eq('id', userId)
      .maybeSingle();

    if (!existingProfile) {
      const { error: insertError } = await supabase
        .from('parents_profiles')
        .insert({
          id: userId,
          email,
          email_verified: true,
          last_login_at: new Date().toISOString(),
          subscription_status: 'free',
          plan_type: 'free',
          status: 'active',
        });

      if (insertError) {
        console.warn('[OTP] profile insert warning:', insertError.message);
      }
    } else {
      // 更新登录时间和验证状态
      await supabase
        .from('parents_profiles')
        .update({
          email_verified: true,
          last_login_at: new Date().toISOString(),
        })
        .eq('id', userId);
    }

    // ===== 获取孩子列表 =====
    const { data: children } = await supabase
      .from('children')
      .select('id, nickname, age, grade, country, home_language, home_language_other, created_at, updated_at, status')
      .eq('parent_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    // ===== 生成 session token =====
    const sessionToken = generateSessionToken(userId, email);

    const user = {
      id: userId,
      email,
      email_verified: true,
      created_at: createdAt,
    };

    console.log(`[OTP] verified for ${email}, userId=${userId}, isNew=${isNewUser}`);

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
