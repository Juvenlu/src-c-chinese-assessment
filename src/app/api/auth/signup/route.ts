import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import {
  getSupabaseClient,
  isValidEmail,
  generateSessionToken,
} from '@/lib/auth-utils';

const SALT_ROUNDS = 10;

/**
 * POST /api/auth/signup
 * 家长邮箱 + 密码注册
 * body: { email, password, nickname, age, grade, country, home_language?, home_language_other?, guest_session_id? }
 *
 * 注册成功后：
 * 1. 创建 auth.users（满足外键约束）
 * 2. 创建 parents_profiles（含 password_hash）
 * 3. 创建第一个 Child Profile
 * 4. 如有 guest_session_id，自动绑定测试结果
 * 5. 自动登录（返回 session token）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body.email || '').toString().trim().toLowerCase();
    const password = (body.password || '').toString();
    const nickname = (body.nickname || '').toString().trim();
    const age = parseInt(body.age, 10);
    const grade = (body.grade || '').toString().trim();
    const country = (body.country || '').toString().trim();
    const homeLanguage = body.home_language || null;
    const homeLanguageOther = body.home_language_other || null;
    const guestSessionId = body.guest_session_id || null;

    // ===== 基础校验 =====
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的Email地址' }, { status: 400 });
    }

    if (!password || password.length < 8) {
      return NextResponse.json({ error: '密码至少需要8位' }, { status: 400 });
    }

    if (!nickname) {
      return NextResponse.json({ error: '请输入孩子昵称' }, { status: 400 });
    }

    if (!age || age < 3 || age > 18) {
      return NextResponse.json({ error: '请选择有效的年龄' }, { status: 400 });
    }

    if (!grade) {
      return NextResponse.json({ error: '请选择年级' }, { status: 400 });
    }

    if (!country) {
      return NextResponse.json({ error: '请选择国家/地区' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // ===== 检查Email是否已注册 =====
    const { data: existingProfile } = await supabase
      .from('parents_profiles')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      return NextResponse.json(
        { error: '这个邮箱已经注册，请直接登录' },
        { status: 409 }
      );
    }

    // ===== 密码哈希 =====
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // ===== 创建 auth.users（满足外键约束）=====
    let userId: string;
    let createdAt: string;

    try {
      const { data: authData, error: createAuthError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { source: 'password_signup' },
        });

      if (createAuthError || !authData.user) {
        // 并发场景：Email已存在
        if (createAuthError?.message?.includes('already registered')) {
          return NextResponse.json(
            { error: '这个邮箱已经注册，请直接登录' },
            { status: 409 }
          );
        }
        throw new Error(createAuthError?.message || '创建账户失败');
      }

      userId = authData.user.id;
      createdAt = authData.user.created_at;
    } catch (authErr: any) {
      // 如果 auth 失败，尝试用 email 在 auth.users 中查找（竞态条件）
      console.warn('[Signup] auth create failed, trying lookup:', authErr.message);
      const { data: listData } = await supabase.auth.admin.listUsers();
      const found = listData?.users?.find(
        (u) => u.email?.toLowerCase() === email
      );
      if (found) {
        userId = found.id;
        createdAt = found.created_at;
      } else {
        throw authErr;
      }
    }

    // ===== 创建 parents_profiles =====
    const { error: profileError } = await supabase
      .from('parents_profiles')
      .insert({
        id: userId,
        email,
        password_hash: passwordHash,
        email_verified: true,
        last_login_at: new Date().toISOString(),
        subscription_status: 'free',
        plan_type: 'free',
        status: 'active',
      });

    if (profileError) {
      console.error('[Signup] profile insert error:', profileError.message);
      // 可能竞态，重新查
      const { data: retryProfile } = await supabase
        .from('parents_profiles')
        .select('id, email, created_at')
        .eq('email', email)
        .maybeSingle();
      if (retryProfile) {
        userId = retryProfile.id;
        createdAt = retryProfile.created_at;
      } else {
        return NextResponse.json(
          { error: '创建账户失败，请稍后重试' },
          { status: 500 }
        );
      }
    }

    // ===== 创建第一个孩子 =====
    const { data: childData, error: childError } = await supabase
      .from('children')
      .insert({
        parent_id: userId,
        nickname,
        age,
        grade,
        country,
        home_language: homeLanguage || null,
        home_language_other: homeLanguage === 'other' ? homeLanguageOther : null,
        status: 'active',
      })
      .select('id, nickname, age, grade, country, home_language, home_language_other, created_at, updated_at, status')
      .single();

    if (childError || !childData) {
      console.error('[Signup] child insert error:', childError?.message);
      return NextResponse.json(
        { error: '创建孩子档案失败，请稍后重试' },
        { status: 500 }
      );
    }

    // ===== 如果有游客测试，自动绑定 =====
    if (guestSessionId) {
      try {
        // 标记 guest session 为已认领
        const { error: claimError } = await supabase
          .from('guest_test_sessions')
          .update({
            claimed: true,
            child_id: childData.id,
          })
          .eq('id', guestSessionId);

        if (claimError) {
          console.warn('[Signup] guest session claim warning:', claimError.message);
        }

        // 保存到 quick_assessment_results（如果有结果数据）
        // 结果数据由前端在注册成功后通过 /api/quick-results 提交
        // 这里只做绑定标记
      } catch (bindErr) {
        console.warn('[Signup] bind guest test warning:', bindErr);
      }
    }

    // ===== 生成 session token =====
    const sessionToken = generateSessionToken(userId, email);

    console.log(`[Signup] new user ${email}, childId=${childData.id}`);

    return NextResponse.json({
      success: true,
      session: sessionToken,
      user: {
        id: userId,
        email,
        email_verified: true,
        created_at: createdAt,
      },
      child: childData,
      children: [childData],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[Signup] unexpected error:', message);
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 }
    );
  }
}
