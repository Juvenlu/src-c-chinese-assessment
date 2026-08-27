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
        // 读取 guest session 的结果数据（含 claimed 状态）
        const { data: guestSession } = await supabase
          .from('guest_test_sessions')
          .select('id, claimed, result_data')
          .eq('id', guestSessionId)
          .maybeSingle();

        // 安全校验 1：guest_session 必须存在
        if (!guestSession) {
          console.warn(`[Signup] guest session not found: ${guestSessionId}`);
          throw new Error('GUEST_SESSION_NOT_FOUND');
        }

        // 安全校验 2：guest_session 必须尚未 claimed
        if (guestSession.claimed) {
          console.warn(`[Signup] guest session already claimed: ${guestSessionId}`);
          throw new Error('GUEST_SESSION_ALREADY_CLAIMED');
        }

        // 安全校验 3：result_data 必须有效
        const resultData = guestSession.result_data as Record<string, any> | null;
        if (!resultData || typeof resultData !== 'object') {
          console.warn(`[Signup] guest session has invalid result_data: ${guestSessionId}`);
          throw new Error('GUEST_SESSION_INVALID_DATA');
        }

        // 标记 guest session 为已认领
        await supabase
          .from('guest_test_sessions')
          .update({
            claimed: true,
            child_id: childData.id,
          })
          .eq('id', guestSessionId);

        // 写入 quick_assessment_results
        // 从 Level 字符串（如 "SRC500"）中提取数字
        const extractLevelNum = (val: any): number | null => {
          if (!val) return null;
          if (typeof val === 'number') return val;
          const m = String(val).match(/(\d+)/);
          return m ? parseInt(m[1], 10) : null;
        };

        const charL = extractLevelNum(resultData.characterLevelLower);
        const charU = extractLevelNum(resultData.characterLevelUpper || resultData.characterLevel);
        const wordL = extractLevelNum(resultData.wordLevelLower);
        const wordU = extractLevelNum(resultData.wordLevelUpper || resultData.wordLevel);
        const readingBase = extractLevelNum(resultData.readingBaseLevel);

        await supabase
          .from('quick_assessment_results')
          .insert({
            child_id: childData.id,
            guest_session_id: guestSessionId,
            character_level_l: charL,
            character_level_u: charU,
            word_level_l: wordL,
            word_level_u: wordU,
            reading_base: readingBase,
            confidence: resultData.confidence || 'medium',
            raw_result: resultData,
          });

        console.log(`[Signup] guest result bound to child ${childData.id}, reading_base=SRC${readingBase}`);
      } catch (bindErr) {
        // 只有明确的校验错误才向外抛出，未知错误保留为 warning 但不阻断注册
        const code = bindErr instanceof Error ? bindErr.message : '';
        if (code.startsWith('GUEST_SESSION_')) {
          // 明确校验失败：返回错误，不继续注册流程
          console.error(`[Signup] guest session claim rejected: ${code}`);
          return NextResponse.json(
            { error: '测试结果无效或已被绑定，请重新测试' },
            { status: 400 }
          );
        }
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
