import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/auth-utils';

/**
 * GET /api/admin/users
 * 管理后台：获取所有用户（家长+孩子）列表
 * 注意：生产环境需要管理员权限校验
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    // 获取所有家长
    const { data: parents, error: parentsError } = await supabase
      .from('parents_profiles')
      .select(`
        id,
        email,
        email_verified,
        created_at,
        last_login_at,
        subscription_status,
        plan_type,
        status,
        children (
          id,
          nickname,
          age,
          grade,
          country,
          home_language,
          home_language_other,
          created_at,
          updated_at,
          status
        )
      `)
      .order('created_at', { ascending: false });

    if (parentsError) throw parentsError;

    // 获取所有孩子（包括没有 parent_id 的旧数据）
    const { data: allChildren, error: childrenError } = await supabase
      .from('children')
      .select(`
        id,
        parent_id,
        nickname,
        age,
        grade,
        country,
        home_language,
        home_language_other,
        created_at,
        updated_at,
        status
      `)
      .order('created_at', { ascending: false });

    if (childrenError) throw childrenError;

    // 获取每个孩子的正式测试次数
    const { data: formalResults, error: formalResultsError } = await supabase
      .from('test_results')
      .select('child_id, id')
      .not('child_id', 'is', null);

    if (formalResultsError) throw formalResultsError;

    // 获取每个孩子的快速测评次数
    const { data: quickResults, error: quickResultsError } = await supabase
      .from('quick_assessment_results')
      .select('child_id, id')
      .not('child_id', 'is', null);

    if (quickResultsError) {
      // 如果表还不存在，暂时忽略快速测评统计
      console.warn('[admin users] quick_assessment_results query failed, count only formal tests');
    }

    // 汇总每个孩子的测试次数（正式测试 + 快速测评）
    const testCountMap: Record<string, number> = {};
    formalResults.forEach((r: { child_id: string }) => {
      if (r.child_id) {
        testCountMap[r.child_id] = (testCountMap[r.child_id] || 0) + 1;
      }
    });
    if (quickResults) {
      quickResults.forEach((r: { child_id: string }) => {
        if (r.child_id) {
          testCountMap[r.child_id] = (testCountMap[r.child_id] || 0) + 1;
        }
      });
    }

    // 组装返回数据
    const users = (parents || []).map((p: any) => ({
      parent_id: p.id,
      email: p.email,
      email_verified: p.email_verified,
      subscription_status: p.subscription_status,
      plan_type: p.plan_type,
      parent_created_at: p.created_at,
      last_login_at: p.last_login_at,
      status: p.status,
      children: (p.children || []).map((c: any) => ({
        ...c,
        test_count: testCountMap[c.id] || 0,
      })),
    }));

    // 所有孩子（含未分配家长的，方便管理后台直接使用）
    const parentEmailMap: Record<string, string> = {};
    (parents || []).forEach((p: any) => {
      if (p.children) {
        p.children.forEach((c: any) => {
          parentEmailMap[c.id] = p.email;
        });
      }
    });

    const all_children = (allChildren || []).map((c: any) => ({
      ...c,
      test_count: testCountMap[c.id] || 0,
      parent_email: parentEmailMap[c.id] || null,
    }));

    return NextResponse.json({
      users,
      all_children,
      total: users.length,
      total_children: all_children.length,
    });
  } catch (err) {
    console.error('[admin users] error:', err);
    return NextResponse.json({ error: '获取用户列表失败' }, { status: 500 });
  }
}
