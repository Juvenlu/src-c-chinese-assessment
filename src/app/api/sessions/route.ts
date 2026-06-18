import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { Level, LEVEL_CONFIG } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { child_id, level, test_mode } = body as { child_id: string; level: Level; test_mode?: string };

    if (!child_id || !level) {
      return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
    }

    const config = LEVEL_CONFIG[level];
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('test_sessions')
      .insert({
        child_id,
        level,
        status: 'in_progress',
        test_mode: test_mode || 'sampling',
        time_limit_seconds: config.timeLimitSeconds,
      })
      .select()
      .single();

    if (error) throw new Error(`创建测试会话失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const child_id = searchParams.get('child_id');
    const id = searchParams.get('id');

    const client = getSupabaseClient();

    if (id) {
      const { data, error } = await client
        .from('test_sessions')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw new Error(`查询会话失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    let query = client.from('test_sessions').select('*').order('created_at', { ascending: false });

    if (child_id) {
      query = query.eq('child_id', child_id);
    }

    const { data, error } = await query;

    if (error) throw new Error(`查询会话失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const updates: Record<string, unknown> = { status };

    if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await client
      .from('test_sessions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`更新会话失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
