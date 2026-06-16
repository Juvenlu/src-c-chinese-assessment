import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  calculatePartScores,
  calculateTotalScore,
  calculateStableCharCount,
  calculateStableVocabCount,
} from '@/lib/scoring';
import { Level, TestAnswer } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id } = body;

    if (!session_id) {
      return NextResponse.json({ error: '缺少session_id' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // Get session info
    const { data: session, error: sessionError } = await client
      .from('test_sessions')
      .select('*')
      .eq('id', session_id)
      .single();

    if (sessionError) throw new Error(`查询会话失败: ${sessionError.message}`);
    if (!session) throw new Error('会话不存在');

    // Get all answers for this session
    const { data: answers, error: answersError } = await client
      .from('test_answers')
      .select('*')
      .eq('session_id', session_id);

    if (answersError) throw new Error(`查询答案失败: ${answersError.message}`);

    const typedAnswers = (answers || []) as TestAnswer[];

    // Calculate scores
    const partScores = calculatePartScores(typedAnswers, typedAnswers.length);
    const totalScore = calculateTotalScore(partScores);

    // Calculate stable char/vocab counts
    const level = session.level as Level;
    const stableCharCount = calculateStableCharCount(totalScore, level, typedAnswers);
    const stableVocabCount = calculateStableVocabCount(stableCharCount, level);

    // Calculate completion time
    const startTime = new Date(session.started_at).getTime();
    const endTime = session.completed_at ? new Date(session.completed_at).getTime() : Date.now();
    const completionTimeSeconds = Math.round((endTime - startTime) / 1000);

    // Calculate mastery rates
    const characterMasteryRate = partScores.characterScore;
    const vocabMasteryRate = partScores.vocabScore;
    const readingComprehensionRate = Math.round(
      (partScores.readingScore + partScores.comprehensionScore) / 2
    );

    // Save results
    const { data: result, error: resultError } = await client
      .from('test_results')
      .upsert(
        {
          session_id,
          child_id: session.child_id,
          level,
          character_score: partScores.characterScore,
          vocab_score: partScores.vocabScore,
          reading_score: partScores.readingScore,
          comprehension_score: partScores.comprehensionScore,
          total_score: totalScore,
          stable_char_count: stableCharCount,
          stable_vocab_count: stableVocabCount,
          character_mastery_rate: characterMasteryRate,
          vocab_mastery_rate: vocabMasteryRate,
          reading_comprehension_rate: readingComprehensionRate,
          completion_time_seconds: completionTimeSeconds,
        },
        { onConflict: 'session_id' }
      )
      .select()
      .single();

    if (resultError) throw new Error(`保存结果失败: ${resultError.message}`);

    return NextResponse.json({ data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const child_id = searchParams.get('child_id');
    const session_id = searchParams.get('session_id');

    const client = getSupabaseClient();

    if (session_id) {
      const { data, error } = await client
        .from('test_results')
        .select('*')
        .eq('session_id', session_id)
        .maybeSingle();

      if (error) throw new Error(`查询结果失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    if (child_id) {
      const { data, error } = await client
        .from('test_results')
        .select('*')
        .eq('child_id', child_id)
        .order('created_at', { ascending: false });

      if (error) throw new Error(`查询结果失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    const { data, error } = await client
      .from('test_results')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`查询结果失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
