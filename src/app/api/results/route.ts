import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, getCurrentUser } from '@/lib/auth-utils';
import { calculatePartScores, calculateTotalScore, calculateStableCharCount, calculateStableVocabCount } from '@/lib/scoring';
import { LEVEL_CONFIG, Level } from '@/lib/types';
import { requireChildOwnership, requireSessionOwnership } from '@/lib/auth/child-access';

/**
 * POST /api/results
 * 计算并保存测试结果
 *
 * ⚠️  关键安全原则：
 * 1. confirmed_level 只能来自 test_sessions.level（服务器端 session 数据）
 * 2. 绝对不能信任客户端 body 传的 level
 * 3. 必须完成 user → session → child → ownership 全链路校验
 */
export async function POST(request: NextRequest) {
  const client = getSupabaseClient();

  try {
    // 先验证登录状态（鉴权优先于 body 解析）
    const user = await getCurrentUser(request.headers.get('x-session') || '');
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { session_id } = body;

    if (!session_id) {
      return NextResponse.json({ error: 'session_id 不能为空' }, { status: 400 });
    }

    // 第一步：校验 session 归属（user → session → child）
    const auth = await requireSessionOwnership(session_id);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // 第二步：从 session 表读取 level（服务器端权威来源，不信任客户端）
    const { data: session, error: sessionError } = await client
      .from('test_sessions')
      .select('*')
      .eq('id', auth.sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: '测试会话不存在' }, { status: 404 });
    }

    const level = session.level;          // level 来自 session，不是 body
    const childId = auth.childId;         // child_id 从 session→child 推导，不是 body
    const testMode = session.test_mode || 'sampling';

    // 第三步：获取答题数据（同样经过 session → child 校验）
    const { data: answers, error: answersError } = await client
      .from('test_answers')
      .select('*, question_bank!question_id(*)')
      .eq('session_id', auth.sessionId)
      .order('created_at', { ascending: true });

    if (answersError) {
      return NextResponse.json({ error: '获取答题记录失败' }, { status: 500 });
    }

    const typedAnswers = answers?.map((a: any) => ({
      ...a,
      // 正式测试（question_id 为 null）答案的题干存在 question_content 字段
      // 趣味闯关答案从 question_bank 关联读取
      question_content: a.question_content || a.question_bank?.character || a.question_bank?.word || '',
      part: a.part || a.question_bank?.part || 'character',
      question_type: a.question_bank?.type || 'character',
    })) || [];

    // 安全校验：没有有效答案时拒绝生成结果
    const validAnswers = typedAnswers.filter((a: any) => a.question_content && (a.part === 1 || a.part === 2 || a.part === 'character' || a.part === 'vocabulary'));
    if (validAnswers.length === 0) {
      return NextResponse.json({ error: '没有有效答题记录，无法生成结果' }, { status: 400 });
    }

    // 第四步：计算得分（纯计算，不涉及权限）
    const partScores = calculatePartScores(typedAnswers, typedAnswers.length);
    let totalScore: number;
    let stableCharCount: number;
    let stableVocabCount: number;

    const isFormalTest = testMode === 'formal' || testMode === 'full';
    if (isFormalTest) {
      // 正式 SRC 测试：只有单字 + 词组两部分，各占 50% 权重
      const charRate = partScores.characterScore / 100;
      const vocabRate = partScores.vocabScore / 100;
      totalScore = Math.round((charRate * 0.5 + vocabRate * 0.5) * 100);
      // 稳定识字量：单字掌握率 × 等级字库总数
      const levelCharCount = LEVEL_CONFIG[level as keyof typeof LEVEL_CONFIG]?.charCount || 300;
      const levelVocabCount = LEVEL_CONFIG[level as keyof typeof LEVEL_CONFIG]?.vocabCount || 300;
      stableCharCount = Math.round(charRate * levelCharCount);
      stableVocabCount = Math.round(vocabRate * levelVocabCount);
    } else {
      // 趣味闯关：四部分加权
      totalScore = calculateTotalScore(partScores);
      stableCharCount = calculateStableCharCount(totalScore, level, typedAnswers);
      stableVocabCount = calculateStableVocabCount(stableCharCount, level);
    }

    const startTime = new Date(session.started_at).getTime();
    const endTime = session.completed_at ? new Date(session.completed_at).getTime() : Date.now();
    const completionTimeSeconds = Math.round((endTime - startTime) / 1000);

    const characterMasteryRate = partScores.characterScore;
    const vocabMasteryRate = partScores.vocabScore;
    const readingComprehensionRate = Math.round(
      (partScores.readingScore + partScores.comprehensionScore) / 2
    );

    const knownCharacters = typedAnswers
      .filter((a: any) => a.is_correct && a.question_content)
      .map((a: any) => a.question_content as string)
      .filter((content: string) => content.length === 1);

    // 第五步：保存结果（child_id 和 level 都是服务器端权威来源）
    const { data: result, error: resultError } = await client
      .from('test_results')
      .upsert(
        {
          session_id: auth.sessionId,
          child_id: childId,
          level,                    // 来自 session，非 body
          test_mode: testMode,      // 来自 session，非 body
          character_score: partScores.characterScore,
          vocab_score: partScores.vocabScore,
          reading_score: partScores.readingScore,
          comprehension_score: partScores.comprehensionScore,
          total_score: totalScore,
          stable_char_count: stableCharCount,
          stable_vocab_count: stableVocabCount,
          character_mastery_rate: characterMasteryRate,
          vocab_mastery_rate: vocabMasteryRate,
          reading_comprehension_rate: readingComprehensionRate,
          completion_time_seconds: completionTimeSeconds,
          known_characters: knownCharacters.length > 0 ? knownCharacters : null,
        },
        { onConflict: 'session_id' }
      )
      .select()
      .single();

    if (resultError) throw new Error(`保存结果失败: ${resultError.message}`);

    return NextResponse.json({ data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/results
 * 查询测试结果
 *
 * 权限链：user → child/session → ownership
 */
export async function GET(request: NextRequest) {
  const client = getSupabaseClient();

  try {
    const token = request.headers.get('x-session') || '';
    const user = await getCurrentUser(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const childIdParam = searchParams.get('child_id');
    const sessionIdParam = searchParams.get('session_id');

    if (sessionIdParam) {
      // 通过 session_id 查询：session → child 权限链
      const sessionCheck = await requireSessionOwnership(sessionIdParam);
      if (!sessionCheck.ok) {
        return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
      }

      const { data, error } = await client
        .from('test_results')
        .select('*')
        .eq('session_id', sessionCheck.sessionId)
        .maybeSingle();

      if (error) throw new Error(`查询结果失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    if (childIdParam) {
      // 通过 child_id 查询：直接校验归属
      const childCheck = await requireChildOwnership(childIdParam);
      if (!childCheck.ok) {
        return NextResponse.json({ error: childCheck.error }, { status: childCheck.status });
      }

      const { data, error } = await client
        .from('test_results')
        .select('*')
        .eq('child_id', childCheck.childId)
        .order('created_at', { ascending: false });

      if (error) throw new Error(`查询结果失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    // 不传参数时，返回当前用户所有孩子的结果
    const { data: children } = await client
      .from('children')
      .select('id')
      .eq('parent_id', user.id);

    if (!children?.length) {
      return NextResponse.json({ data: [] });
    }

    const childIds = children.map((c: { id: string }) => c.id);
    const { data, error } = await client
      .from('test_results')
      .select('*')
      .in('child_id', childIds)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`查询结果失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
