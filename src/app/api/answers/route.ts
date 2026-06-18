import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Support both single answer and batch answers
    const answers = Array.isArray(body.answers) ? body.answers : [body];

    const client = getSupabaseClient();

    const rows = answers.map((a: Record<string, unknown>) => ({
      session_id: a.session_id,
      question_id: a.question_id || null,
      part: typeof a.part === 'string' ? (a.part === 'character' ? 1 : a.part === 'vocab' ? 2 : a.part === 'sentence' ? 3 : 4) : a.part,
      is_recognized: a.is_recognized ?? null,
      selected_answer: a.selected_answer ?? null,
      is_correct: a.is_correct ?? false,
      reaction_time_ms: a.reaction_time_ms ?? null,
      question_content: a.question_content ?? null,
    }));

    const { data, error } = await client
      .from('test_answers')
      .insert(rows)
      .select();

    if (error) throw new Error(`提交答案失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const session_id = searchParams.get('session_id');
    const child_id = searchParams.get('child_id');

    const client = getSupabaseClient();

    if (session_id) {
      const { data, error } = await client
        .from('test_answers')
        .select('*')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });

      if (error) throw new Error(`查询答案失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    if (child_id) {
      // Get all answers for a child via their sessions
      const { data: sessions } = await client
        .from('test_sessions')
        .select('id')
        .eq('child_id', child_id);

      if (!sessions?.length) return NextResponse.json({ data: [] });

      const sessionIds = sessions.map((s: { id: string }) => s.id);
      const { data, error } = await client
        .from('test_answers')
        .select('*')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: true });

      if (error) throw new Error(`查询答案失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    return NextResponse.json({ error: '缺少session_id或child_id' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
