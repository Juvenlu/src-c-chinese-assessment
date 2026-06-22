import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level');

    const client = getSupabaseClient();
    let query = client.from('question_bank').select('*').order('created_at');

    if (level) {
      // Cumulative level: SRC500 includes SRC300, SRC800 includes SRC300+SRC500
      const levelMap: Record<string, string[]> = {
        'SRC300': ['SRC300'],
        'SRC500': ['SRC300', 'SRC500'],
        'SRC800': ['SRC300', 'SRC500', 'SRC800'],
      };
      const levels = levelMap[level] || [level];
      query = query.in('level', levels);
    }

    const { data, error } = await query;

    if (error) throw new Error(`查询题库失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { level, character, word, sentence, meaning_question, options, answer, story_text, story_question, story_options, story_answer } = body;

    if (!level || !character || !word || !sentence || !meaning_question || !options || !answer) {
      return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('question_bank')
      .insert({ level, character, word, sentence, meaning_question, options, answer, story_text, story_question, story_options, story_answer })
      .select()
      .single();

    if (error) throw new Error(`创建题目失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少题目ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('question_bank')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`更新题目失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少题目ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { error } = await client
      .from('question_bank')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`删除题目失败: ${error.message}`);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
