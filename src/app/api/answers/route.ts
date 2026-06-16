import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { SubmitAnswerInput } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SubmitAnswerInput;
    const { session_id, question_id, part, is_recognized, selected_answer, is_correct, reaction_time_ms } = body;

    if (!session_id || !question_id || !part) {
      return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('test_answers')
      .insert({
        session_id,
        question_id,
        part,
        is_recognized,
        selected_answer,
        is_correct,
        reaction_time_ms,
      })
      .select()
      .single();

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

    if (!session_id) {
      return NextResponse.json({ error: '缺少session_id' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('test_answers')
      .select('*')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`查询答案失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
