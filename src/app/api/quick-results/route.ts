import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getSupabaseClient } from '@/lib/auth-utils';

/**
 * GET /api/quick-results?child_id=xxx
 * 获取孩子的快速测评结果列表（登录用户只能看自己孩子的）
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const childId = searchParams.get('child_id');

    if (!childId) {
      return NextResponse.json({ error: '缺少孩子ID' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // 先验证归属
    const { data: child } = await supabase
      .from('children')
      .select('id')
      .eq('id', childId)
      .eq('parent_id', user.id)
      .maybeSingle();

    if (!child) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const { data: results } = await supabase
      .from('quick_assessment_results')
      .select('*')
      .eq('child_id', childId)
      .order('created_at', { ascending: false })
      .limit(20);

    return NextResponse.json({ results: results || [] });
  } catch (err) {
    console.error('[quick-results GET] error:', err);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}
