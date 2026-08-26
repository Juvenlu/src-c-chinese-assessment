import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getSupabaseClient } from '@/lib/auth-utils';
import { requireChildOwnership } from '@/lib/auth/child-access';

/**
 * POST /api/books/generate
 * 为孩子生成定制绘本（i+1 难度调整）
 *
 * 安全原则：
 * 1. child_id 必须经过 ownership 校验
 * 2. 绘本难度只能依据 confirmed_level（test_results.level）
 * 3. 禁止 fallback 到 estimated_level
 * 4. 禁止客户端直接指定 level 冒充 confirmed_level
 */
export async function POST(request: NextRequest) {
  // 1. 先鉴权：未登录直接 401
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { child_id, episode_id, series_name } = body;

    if (!child_id || !episode_id) {
      return NextResponse.json(
        { error: 'child_id and episode_id are required' },
        { status: 400 }
      );
    }

    // 第一步：校验 child 归属
    const auth = await requireChildOwnership(child_id);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = getSupabaseClient();

    // 第二步：从正式测试结果取 level（confirmed_level，服务器端权威来源）
    // ⚠️  只能用 test_results，不能用 quick_assessment_results
    const { data: testResults, error: resultsError } = await supabase
      .from('test_results')
      .select('level, total_score, stable_char_count')
      .eq('child_id', auth.childId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (resultsError) throw resultsError;

    if (!testResults || testResults.length === 0) {
      return NextResponse.json(
        { error: 'No test results found for this child. Please complete an assessment first.' },
        { status: 400 }
      );
    }

    const latestResult = testResults[0];
    const level = latestResult.level;
    const level_source = 'confirmed';

    // 第三步：获取原绘本页面内容
    const { data: pages, error: pagesError } = await supabase
      .from('book_episode_pages')
      .select('*')
      .eq('episode_id', episode_id)
      .order('page_number', { ascending: true });

    if (pagesError) throw pagesError;

    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: 'No pages found for this episode' }, { status: 404 });
    }

    // 第四步：生成定制绘本（i+1 简化处理）
    const charCount = latestResult.stable_char_count || 300;
    const initial_char_count = charCount;

    const pagesJson = pages.map((p: any) => ({
      page_number: p.page_number,
      image_url: p.image_url,
      text: p.original_text ? simplifyText(p.original_text, level) : null,
      original_text: p.original_text,
      vocabulary_level: level,
    }));

    const newChars = generateNewChars(pagesJson, level);
    const cumulativeChars = charCount + Math.floor(newChars.length * 0.3);

    // 第五步：保存定制绘本（child_id 来自 ownership 校验结果）
    const { data: customBook, error: insertError } = await supabase
      .from('custom_books')
      .insert({
        child_id: auth.childId,
        episode_id,
        level_tier: level,
        initial_char_count: initial_char_count,
        pages_json: pagesJson,
        new_chars: newChars,
        cumulative_chars: cumulativeChars,
        version: 1,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({
      data: customBook,
      level_source,
      level,
    }, { status: 201 });
  } catch (error: any) {
    console.error('[books/generate] error:', error);
    return NextResponse.json(
      { error: 'Failed to generate custom book' },
      { status: 500 }
    );
  }
}

function simplifyText(text: string, level: string): string {
  if (!text) return text;
  return text; // 占位：实际 i+1 改写逻辑
}

function generateNewChars(pages: any[], level: string): string[] {
  const uniqueChars = new Set<string>();
  for (const page of pages) {
    if (page.text) {
      for (const char of page.text) {
        if (/[\u4e00-\u9fa5]/.test(char)) {
          uniqueChars.add(char);
        }
      }
    }
  }
  return Array.from(uniqueChars).slice(0, 20);
}
