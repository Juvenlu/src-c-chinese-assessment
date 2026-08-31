import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'srcc2026';

export async function GET(request: Request) {
  // 简单密码校验（与前端 Admin 密码一致）
  const adminPwd = request.headers.get('x-admin-password');
  if (adminPwd !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('test_results')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '查询失败' }, { status: 500 });
  }
}
