import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, age, grade, country, language_env } = body;

    if (!name || !age || !grade || !country || !language_env) {
      return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('children')
      .insert({ name, age, grade, country, language_env })
      .select()
      .single();

    if (error) throw new Error(`创建孩子档案失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('children')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`查询孩子档案失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
