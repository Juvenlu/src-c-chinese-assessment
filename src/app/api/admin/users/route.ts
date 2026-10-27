import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

/**
 * GET /api/admin/users
 * 管理后台：获取所有用户（家长+孩子）列表
 *
 * 安全说明：
 * 使用 x-admin-password header 验证，预期口令仅来自服务端环境变量 ADMIN_PASSWORD。
 * 环境变量缺失时 fail-closed（503），无硬编码兜底。
 */

export async function GET(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: '服务配置错误' },
      { status: 503 }
    );
  }
  const adminPwd = req.headers.get('x-admin-password');
  if (!adminPwd || adminPwd !== expected) {
    return NextResponse.json(
      { error: '管理员密码错误' },
      { status: 401 }
    );
  }

  const supabase = getSupabaseClient();

  // 查询所有家长及其孩子
  const { data: parents, error: parentsError } = await supabase
    .from('parents_profiles')
    .select(`
      id,
      email,
      email_verified,
      created_at,
      subscription_status,
      plan_type,
      children (
        id,
        nickname,
        age,
        grade,
        country,
        home_language,
        status,
        created_at,
        updated_at
      )
    `)
    .order('created_at', { ascending: false });

  if (parentsError) {
    return NextResponse.json(
      { error: parentsError.message },
      { status: 500 }
    );
  }

  // 同时查出所有无主孩子（没有 parent_id 的）
  const { data: orphanChildren, error: orphanError } = await supabase
    .from('children')
    .select('*')
    .is('parent_id', null)
    .order('created_at', { ascending: false });

  if (orphanError) {
    return NextResponse.json(
      { error: orphanError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    users: parents || [],
    all_children: [
      ...(parents?.flatMap((p: any) => (p.children || []).map((c: any) => ({ ...c, parent_email: p.email }))) || []),
      ...(orphanChildren?.map((c: any) => ({ ...c, parent_email: null })) || []),
    ],
  });
}
