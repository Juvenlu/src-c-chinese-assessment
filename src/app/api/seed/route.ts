import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getAllQuestions } from '@/lib/questions';

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();

    // Check for force rebuild param
    let forceRebuild = false;
    try {
      const body = await request.json();
      forceRebuild = body?.force === true;
    } catch {
      // No body or invalid JSON - ignore
    }

    // If force rebuild, delete existing questions first
    if (forceRebuild) {
      const { error: deleteError } = await client
        .from('question_bank')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all

      if (deleteError) {
        console.warn('清空题库警告:', deleteError.message);
      }
    } else {
      // Check if questions already exist
      const { count, error: countError } = await client
        .from('question_bank')
        .select('*', { count: 'exact', head: true });

      if (countError) throw new Error(`查询题库失败: ${countError.message}`);

      if (count && count > 0) {
        return NextResponse.json({ message: `题库已有 ${count} 道题目，跳过导入` });
      }
    }

    // Seed all questions
    const allQuestions = getAllQuestions();

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
