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

    // 获取每个孩子的测试次数
    const { data: results, error: resultsError } = await supabase
      .from('test_results')
      .select('child_id, id')
      .not('child_id', 'is', null);

    if (resultsError) throw resultsError;

    // 统计每个孩子的测试次数
    const testCountMap: Record<string, number> = {};
    results.forEach((r: { child_id: string }) => {
      if (r.child_id) {
        testCountMap[r.child_id] = (testCountMap[r.child_id] || 0) + 1;
      }
    });

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

    return NextResponse.json({
      users,
      total: users.length,
      total_children: users.reduce((sum: number, u: any) => sum + u.children.length, 0),
    });
  } catch (err) {
    console.error('[admin users] error:', err);
    return NextResponse.json({ error: '获取用户列表失败' }, { status: 500 });
  }
}
