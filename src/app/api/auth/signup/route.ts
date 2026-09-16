import { NextRequest, NextResponse } from 'next/server';

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * POST /api/auth/signup
 * 家长邮箱 + 密码注册
 * body: { email, password, nickname, age, grade, country, home_language?, home_language_other?, guest_session_id? }
 *
 * Production: Vercel → Worker → D1（fail-fast，绝不 fallback 到 Supabase）
 * Development: 优先 Worker，未配置时 fallback Supabase（仅限本地开发）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    // Production：必须走 Worker，配置缺失直接 fail-fast
    if (IS_PRODUCTION && !workerConfigured) {
      console.error(
        '[auth/signup POST] PRODUCTION ERROR: Worker is not configured. ' +
          'Required: WORKER_GUEST_API_ENABLED=true, WORKER_BASE_URL, SRC_WORKER_SERVICE_KEY.',
      );
      return NextResponse.json(
        { error: '服务配置错误' },
        { status: 500 },
      );
    }

    // Worker 已配置：走 Vercel → Worker → D1
    if (workerConfigured) {
      const res = await fetch(`${WORKER_BASE_URL}/v1/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY as string,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      // 透传 Set-Cookie（HMAC Session）
      const setCookie = res.headers.get('set-cookie');
      const responseHeaders: Record<string, string> = {};
      if (setCookie) {
        responseHeaders['Set-Cookie'] = setCookie;
      }

      if (!res.ok) {
        return NextResponse.json(data, { status: res.status, headers: responseHeaders });
      }

      return NextResponse.json(data, { status: res.status, headers: responseHeaders });
    }

    // Development fallback：Supabase（仅开发环境，Production 不会到达此处）
    const bcrypt = (await import('bcryptjs')).default;
    const {
      getSupabaseClient,
      isValidEmail,
      generateSessionToken,
    } = await import('@/lib/auth-utils');

    const SALT_ROUNDS = 10;

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
        const { data: guestSession } = await supabase
          .from('guest_test_sessions')
          .select('id, claimed, result_data')
          .eq('id', guestSessionId)
          .maybeSingle();

        if (!guestSession) {
          console.warn(`[Signup] guest session not found: ${guestSessionId}`);
          throw new Error('GUEST_SESSION_NOT_FOUND');
        }
        if (guestSession.claimed) {
          console.warn(`[Signup] guest session already claimed: ${guestSessionId}`);
          throw new Error('GUEST_SESSION_ALREADY_CLAIMED');
        }

        const resultData = guestSession.result_data as Record<string, any> | null;
        if (!resultData || typeof resultData !== 'object') {
          console.warn(`[Signup] guest session has invalid result_data: ${guestSessionId}`);
          throw new Error('GUEST_SESSION_INVALID_DATA');
        }

        await supabase
          .from('guest_test_sessions')
          .update({
            claimed: true,
            child_id: childData.id,
          })
          .eq('id', guestSessionId);

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
        const code = bindErr instanceof Error ? bindErr.message : '';
        if (code.startsWith('GUEST_SESSION_')) {
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
