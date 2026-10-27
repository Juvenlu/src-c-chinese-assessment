import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: Request) {
  // 服务端环境变量校验（fail-closed：未配置拒绝服务，无硬编码兜底；请求时读取避免模块加载期固化）
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: '服务配置错误' }, { status: 503 });
  }
  const adminPwd = request.headers.get('x-admin-password');
  if (!adminPwd || adminPwd !== expected) {
    return NextResponse.json({ error: '无权访问' }, { status: 401 });
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
