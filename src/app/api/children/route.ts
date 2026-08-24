import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getAdminSupabase } from '@/lib/auth-utils';

/**
 * GET /api/children
 * 获取当前家长的孩子列表
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const supabase = getAdminSupabase();
    const { data: children } = await supabase
      .from('children')
      .select('*')
      .eq('parent_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    return NextResponse.json({ children: children || [] });
  } catch (err) {
    console.error('[children GET] error:', err);
    return NextResponse.json({ error: '获取孩子列表失败' }, { status: 500 });
  }
}

/**
 * POST /api/children
 * 创建孩子档案
 * body: { nickname, age, grade, country, home_language?, home_language_other?, guest_session_id? }
 * 如果传入 guest_session_id，会把该游客测试结果绑定到新孩子
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await req.json();
    const {
      nickname,
      age,
      grade,
      country,
      home_language,
      home_language_other,
      guest_session_id,
    } = body;

    // 校验必填
    if (!nickname || !age || !grade || !country) {
      return NextResponse.json(
        { error: '请填写所有必填信息（昵称、年龄、年级、国家）' },
        { status: 400 }
      );
    }

    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum) || ageNum < 3 || ageNum > 18) {
      return NextResponse.json({ error: '年龄范围：3-18岁' }, { status: 400 });
    }

    const supabase = getAdminSupabase();

    // 创建孩子
    const { data: child, error: childError } = await supabase
      .from('children')
      .insert({
        parent_id: user.id,
        nickname: nickname.trim(),
        age: ageNum,
        grade: grade.trim(),
        country: country.trim(),
        home_language: home_language || null,
        home_language_other: home_language_other || null,
        status: 'active',
      })
      .select()
      .single();

    if (childError || !child) {
      console.error('[children POST] create error:', childError);
      return NextResponse.json({ error: '创建孩子档案失败' }, { status: 500 });
    }

    // 如果传入了游客测试 session，绑定结果
    if (guest_session_id) {
      await bindGuestTestToChild(supabase, guest_session_id, child.id);
    }

    return NextResponse.json({ success: true, child });
  } catch (err) {
    console.error('[children POST] error:', err);
    return NextResponse.json({ error: '创建失败，请稍后重试' }, { status: 500 });
  }
}

/**
 * 把游客测试结果绑定到孩子
 */
async function bindGuestTestToChild(
  supabase: ReturnType<typeof getAdminSupabase>,
  guestSessionId: string,
  childId: string
) {
  try {
    // 找到游客会话
    const { data: session } = await supabase
      .from('guest_test_sessions')
      .select('*')
      .eq('id', guestSessionId)
      .maybeSingle();

    if (!session || session.claimed) {
      return; // 没有或已被认领，静默忽略
    }

    // 如果已经有结果数据，存入 quick_assessment_results
    if (session.result_data && session.test_status === 'completed') {
      const rd = session.result_data as Record<string, unknown>;
      
      await supabase
        .from('quick_assessment_results')
        .insert({
          child_id: childId,
          guest_session_id: guestSessionId,
          character_level_lower: rd.characterLevelLower as number,
          character_level_upper: rd.characterLevelUpper as number,
          word_level_lower: rd.wordLevelLower as number,
          word_level_upper: rd.wordLevelUpper as number,
          reading_base_level: rd.readingBaseLevel as number,
          recommended_reading: rd.recommendedReadingDesc as string,
          confidence: rd.confidence as string,
          total_questions: rd.totalQuestions as number,
          character_count: rd.characterCount as number,
          word_count: rd.wordCount as number,
          level_results: rd.levelResults,
          quality_flags: rd.qualityFlags,
        });
    }

    // 标记为已认领
    await supabase
      .from('guest_test_sessions')
      .update({
        claimed: true,
        child_id: childId,
        completed_at: session.completed_at || new Date().toISOString(),
      })
      .eq('id', guestSessionId);
  } catch (err) {
    console.error('[bindGuestTest] error:', err);
    // 绑定失败不影响孩子创建
  }
}
