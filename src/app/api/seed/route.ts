import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ALL_QUESTIONS } from '@/lib/questions';

export async function POST() {
  try {
    const client = getSupabaseClient();

    // Check if questions already exist
    const { count, error: countError } = await client
      .from('question_bank')
      .select('*', { count: 'exact', head: true });

    if (countError) throw new Error(`查询题库失败: ${countError.message}`);

    if (count && count > 0) {
      return NextResponse.json({ message: `题库已有 ${count} 道题目，跳过导入` });
    }

    // Seed all questions
    const allQuestions = [
      ...ALL_QUESTIONS.SRC300,
      ...ALL_QUESTIONS.SRC500,
      ...ALL_QUESTIONS.SRC800,
    ];

    const { error: insertError } = await client
      .from('question_bank')
      .insert(allQuestions);

    if (insertError) throw new Error(`导入题库失败: ${insertError.message}`);

    return NextResponse.json({
      message: `成功导入 ${allQuestions.length} 道题目`,
      count: allQuestions.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
