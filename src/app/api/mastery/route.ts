/**
 * 掌握度记录 API
 * 
 * 管理孩子的汉字/词组掌握度历史记录，是"个人测字历史数据库"的核心
 * 
 * 数据库表（需要在Supabase中创建）：
 * - character_mastery: 单字掌握度
 * - vocabulary_mastery: 词组掌握度
 * - assessment_history: 测试评估历史
 * 
 * 注意：当前版本先建立API接口和数据结构，
 *       数据库表创建在seed/init_mastery.sql中
 */

import { NextResponse } from 'next/server';
import { updateMasteryData } from '@/lib/item-selection';
import { DEFAULT_SAMPLING_CONFIG } from '@/lib/types';
import type { MasteryStatus } from '@/lib/types';

// ============================================================
// GET: 获取孩子的掌握度记录
// ============================================================

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const childId = searchParams.get('child_id');
  const type = searchParams.get('type') || 'character'; // character | vocabulary
  const level = searchParams.get('level');

  if (!childId) {
    return NextResponse.json({ error: '缺少child_id参数' }, { status: 400 });
  }

  try {
    // TODO: 从数据库查询
    // const { data, error } = await supabase
    //   .from(type === 'character' ? 'character_mastery' : 'vocabulary_mastery')
    //   .select('*')
    //   .eq('child_id', childId)
    //   .maybeSingle();

    // 临时返回空数据结构
    return NextResponse.json({
      success: true,
      data: {
        child_id: childId,
        level,
        type,
        items: [], // 实际数据
        summary: {
          total: 0,
          mastered: 0,
          learning: 0,
          untested: 0,
          needsReview: 0,
        },
      },
    });
  } catch (error) {
    console.error('获取掌握度记录失败:', error);
    return NextResponse.json({ error: '获取掌握度记录失败' }, { status: 500 });
  }
}

// ============================================================
// POST: 批量更新掌握度（测试完成后调用）
// ============================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      child_id,
      session_id,
      level,
      character_results, // [{ character, is_correct, reaction_time_ms }]
      vocabulary_results, // [{ word, is_correct, reaction_time_ms }]
    } = body;

    if (!child_id) {
      return NextResponse.json({ error: '缺少child_id' }, { status: 400 });
    }

    // 1. 批量更新单字掌握度
    const charUpdates = character_results?.map((item: { character: string; is_correct: boolean }) =>
      processCharacterMastery(child_id, level, item.character, item.is_correct)
    ) || [];

    // 2. 批量更新词组掌握度
    const vocabUpdates = vocabulary_results?.map((item: { word: string; is_correct: boolean }) =>
      processVocabularyMastery(child_id, level, item.word, item.is_correct)
    ) || [];

    // 3. 记录评估历史
    const assessment = await recordAssessmentHistory({
      child_id,
      session_id,
      level,
      char_results: character_results || [],
      vocab_results: vocabulary_results || [],
    });

    return NextResponse.json({
      success: true,
      data: {
        character_updated: charUpdates.length,
        vocabulary_updated: vocabUpdates.length,
        assessment_id: assessment?.id,
      },
    });
  } catch (error) {
    console.error('更新掌握度失败:', error);
    return NextResponse.json({ error: '更新掌握度失败' }, { status: 500 });
  }
}

// ============================================================
// 内部函数
// ============================================================

/**
 * 处理单个汉字的掌握度更新
 * 
 * 规则：
 * - 如果已有记录，更新累计数据
 * - 如果没有记录，创建新记录
 * - 重新计算掌握状态
 */
async function processCharacterMastery(
  childId: string,
  level: string,
  character: string,
  isCorrect: boolean,
) {
  // TODO: 实际数据库操作
  // 1. 查询现有记录
  // 2. 使用 updateMasteryData 计算新状态
  // 3. upsert 到数据库
  
  const newData = updateMasteryData({
    previous: undefined, // TODO: 从DB读取
    currentResult: isCorrect,
  }, DEFAULT_SAMPLING_CONFIG);

  return {
    character,
    ...newData,
  };
}

/**
 * 处理单个词组的掌握度更新
 */
async function processVocabularyMastery(
  childId: string,
  level: string,
  word: string,
  isCorrect: boolean,
) {
  const newData = updateMasteryData({
    previous: undefined,
    currentResult: isCorrect,
  }, DEFAULT_SAMPLING_CONFIG);

  return {
    word,
    ...newData,
  };
}

/**
 * 记录一次完整评估的历史
 */
async function recordAssessmentHistory(input: {
  child_id: string;
  session_id?: string;
  level: string;
  char_results: { character: string; is_correct: boolean }[];
  vocab_results: { word: string; is_correct: boolean }[];
}) {
  const { child_id, session_id, level, char_results, vocab_results } = input;

  const charTotal = char_results.length;
  const charCorrect = char_results.filter(r => r.is_correct).length;
  const charMasteryRate = charTotal > 0 ? charCorrect / charTotal : 0;

  const vocabTotal = vocab_results.length;
  const vocabCorrect = vocab_results.filter(r => r.is_correct).length;
  const vocabMasteryRate = vocabTotal > 0 ? vocabCorrect / vocabTotal : 0;

  // TODO: 写入 assessment_history 表
  return {
    id: `assessment_${Date.now()}`,
    child_id,
    session_id,
    level,
    test_date: new Date().toISOString(),
    char_mastery_rate: charMasteryRate,
    vocab_mastery_rate: vocabMasteryRate,
    char_count: charCorrect,
    vocab_count: vocabCorrect,
  };
}
