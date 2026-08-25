/**
 * 成长地图 API
 * 
 * 根据孩子的测字历史生成完整的成长地图数据，包括：
 * - SRC阅读识字掌握度
 * - 人教版教材识字掌握度
 * - 词组掌握度
 * - 成长趋势
 * - 优势与建议
 * 
 * 数据来源优先级：
 * 1. quick_assessment_results（快速测评结果）
 * 2. test_results / character_mastery / vocabulary_mastery（正式测试，暂无则降级到 测试，如有）
 */

import { NextResponse } from 'next/server';
import { getCharList, getWordList, getRJBCharList, getCorrespondingRJBLevel } from '@/lib/questions';
import { LEVEL_CONFIG } from '@/lib/types';
import type { Level, GrowthMapData } from '@/lib/types';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const supabase = getSupabaseClient();

const LEVEL_NAMES: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
const LEVEL_NUMBERS: Record<string, number> = {
  SRC100: 100,
  SRC300: 300,
  SRC500: 500,
  SRC800: 800,
};

function numToLevel(num: number): Level {
  if (num >= 800) return 'SRC800';
  if (num >= 500) return 'SRC500';
  if (num >= 300) return 'SRC300';
  return 'SRC100';
}

function levelToNum(level: Level): number {
  return LEVEL_NUMBERS[level] || 100;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const childId = searchParams.get('child_id');
  const levelParam = searchParams.get('level');

  if (!childId) {
    return NextResponse.json({ error: '缺少child_id参数' }, { status: 400 });
  }

  try {
    const growthMap = await calculateGrowthMap(childId, levelParam as Level | null);
    return NextResponse.json({ success: true, data: growthMap });
  } catch (error) {
    console.error('生成成长地图失败:', error);
    return NextResponse.json({ error: '生成成长地图失败' }, { status: 500 });
  }
}

/**
 * 计算成长地图数据
 * 
 * 优先从 quick_assessment_results 获取最新测评数据
 * 如果没有数据，返回最低级别的空数据
 */
async function calculateGrowthMap(
  childId: string,
  levelParam: Level | null,
): Promise<GrowthMapData> {
  // 1. 获取最新快速测评结果
  const { data: quickResults, error: qrError } = await supabase
    .from('quick_assessment_results')
    .select('*')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (qrError) {
    console.error('[growth-map] quick results error:', qrError);
  }

  const latest = quickResults?.[0];
  const allResults = quickResults || [];

  // 2. 确定当前级别
  let currentLevel: Level;
  if (latest) {
    currentLevel = numToLevel(latest.reading_base || latest.character_level_u || 100);
  } else if (levelParam && LEVEL_NAMES.includes(levelParam as Level)) {
    currentLevel = levelParam as Level;
  } else {
    currentLevel = 'SRC100';
  }

  const currentLevelNum = levelToNum(currentLevel);

  // 3. 获取字库数据
  const allSrcChars = getCharList(currentLevel);
  const allWords = getWordList(currentLevel);
  const rjbLevel = getCorrespondingRJBLevel(currentLevel);
  const allRJBChars = getRJBCharList(rjbLevel);

  // 4. 基于快速测评结果计算掌握度
  let charMasteryRate: number;
  let vocabMasteryRate: number;
  let masteredCount: number;
  let vocabMastered: number;
  let testedRatio = 0;
  let vocabTested = 0;

  if (latest) {
    // 单字掌握度 = (lower + upper) / 2 / 总字数
    const charLower = latest.character_level_l || 0;
    const charUpper = latest.character_level_u || currentLevelNum;
    const wordLower = latest.word_level_l || 0;
    const wordUpper = latest.word_level_u || currentLevelNum;

    // 用中位值作为掌握量
    const charMasteryNum = Math.round((charLower + charUpper) / 2);
    const wordMasteryNum = Math.round((wordLower + wordUpper) / 2);

    // 计算当前级别的掌握率（相对于当前级别的总字数）
    charMasteryRate = Math.min(1, Math.max(0, charMasteryNum / allSrcChars.length));
    vocabMasteryRate = Math.min(1, Math.max(0, wordMasteryNum / allWords.length));

    masteredCount = Math.min(allSrcChars.length, Math.max(0, charMasteryNum));
    vocabMastered = Math.min(allWords.length, Math.max(0, wordMasteryNum));

    // 抽测覆盖率（约 30% 左右）
    testedRatio = Math.min(0.8, (latest.raw_result?.totalQuestions ?? 30) / Math.max(allSrcChars.length, 1));
    vocabTested = Math.floor(allWords.length * 0.3);
  } else {
    // 没有测试数据：0
    charMasteryRate = 0;
    vocabMasteryRate = 0;
    masteredCount = 0;
    vocabMastered = 0;
  }

  const testedCount = Math.floor(allSrcChars.length * Math.max(testedRatio, 0.3));
  const learningCount = Math.floor(testedCount * 0.15);
  const untestedCount = allSrcChars.length - testedCount;

  // 5. 人教版交叉计算
  const rjbSet = new Set(allRJBChars);
  const overlapChars = allSrcChars.filter(c => rjbSet.has(c));
  const rjbMastered = Math.floor(overlapChars.length * charMasteryRate);
  const rjbTotal = allRJBChars.length;
  const rjbMasteryRate = rjbTotal > 0 ? rjbMastered / rjbTotal : 0;

  // 6. 成长趋势
  const trend = buildTrend(allResults, currentLevelNum, allSrcChars.length, allWords.length);

  // 7. 下一等级
  const currentIdx = LEVEL_NAMES.indexOf(currentLevel);
  const nextLevel = currentIdx < LEVEL_NAMES.length - 1 ? LEVEL_NAMES[currentIdx + 1] : undefined;

  return {
    childId,
    currentLevel,
    srcMastery: {
      level: currentLevel,
      mastered: masteredCount,
      learning: learningCount,
      untested: untestedCount,
      masteryRate: charMasteryRate,
      total: allSrcChars.length,
      isFullTest: testedCount >= allSrcChars.length * 0.9,
    },
    pepMastery: {
      level: rjbLevel,
      mastered: rjbMastered,
      total: rjbTotal,
      masteryRate: rjbMasteryRate,
      covered: overlapChars.length,
      coverageRate: rjbTotal > 0 ? overlapChars.length / rjbTotal : 0,
    },
    vocabMastery: {
      mastered: vocabMastered,
      tested: vocabTested || Math.floor(allWords.length * 0.3),
      correct: vocabMastered,
      masteryRate: vocabMasteryRate,
      isFullTest: false,
    },
    nextLevel,
    trend,
    strengths: generateStrengths(charMasteryRate, vocabMasteryRate),
    areasToImprove: generateAreasToImprove(charMasteryRate, vocabMasteryRate),
    recommendations: generateRecommendations(currentLevel, charMasteryRate, vocabMasteryRate, latest?.confidence || 'low'),
  };
}

/**
 * 构建成长趋势数据
 * - 如果有历史测试记录就用真实数据，否则返回空趋势或单点
 */
function buildTrend(
  results: any[],
  currentLevelNum: number,
  totalChars: number,
  totalWords: number,
) {
  if (!results || results.length === 0) {
    return {
      charMastery: [],
      vocabMastery: [],
    };
  }

  // 按时间排序（从旧到新）
  const sorted = [...results].sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const charTrend = sorted.map(r => ({
    date: formatDate(new Date(r.created_at)),
    rate: Math.min(1, r.character_level_u ? ((r.character_level_l + r.character_level_u) / 2) / totalChars : 0),
  }));

  const vocabTrend = sorted.map(r => ({
    date: formatDate(new Date(r.created_at)),
    rate: Math.min(1, r.word_level_u ? ((r.word_level_l + r.word_level_u) / 2) / totalWords : 0),
  }));

  return {
    charMastery: charTrend,
    vocabMastery: vocabTrend,
  };
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function generateStrengths(charRate: number, vocabRate: number): string[] {
  const strengths: string[] = [];
  if (charRate >= 0.8) {
    strengths.push('单字基础扎实，已达到同级别上等水平');
  } else if (charRate >= 0.6) {
    strengths.push('单字掌握稳步提升中，基础框架已建立');
  } else if (charRate >= 0.3) {
    strengths.push('已经开始建立中文识字基础');
  }
  if (vocabRate >= 0.7) {
    strengths.push('词组理解能力强，能够在语境中灵活运用');
  }
  if (charRate > vocabRate + 0.1 && charRate > 0.3) {
    strengths.push('识字量增长较快，阅读接触广泛');
  }
  if (strengths.length === 0) {
    strengths.push('学习态度积极，继续加油！');
  }
  return strengths.slice(0, 3);
}

function generateAreasToImprove(charRate: number, vocabRate: number): string[] {
  const areas: string[] = [];
  if (vocabRate < charRate - 0.1 && vocabRate < 0.7) {
    areas.push('词组应用需要加强，建议多阅读加强词语积累');
  }
  if (charRate < 0.7 && charRate > 0) {
    areas.push('核心高频字需要继续巩固，建议每日坚持识字练习');
  }
  if (charRate < 0.5 && charRate > 0) {
    areas.push('基础字库覆盖面需要扩大，建议从SRC低一级别巩固');
  }
  if (areas.length === 0) {
    areas.push('继续保持目前的学习节奏');
  }
  areas.push('建议通过阅读在真实语境中加深对汉字的理解');
  return areas.slice(0, 3);
}

function generateRecommendations(level: Level, charRate: number, vocabRate: number, confidence: string): string[] {
  const recs: string[] = [];
  if (confidence === 'high' && charRate >= 0.7) {
    recs.push('可以尝试更高一级的绘本阅读');
  }
  recs.push('每日15分钟中文绘本阅读');
  recs.push('每周1次完整测字，跟踪成长进度');
  if (vocabRate < 0.6 && vocabRate > 0) {
    recs.push('增加词汇专项练习');
  }
  if (confidence === 'low') {
    recs.push('建议完成一次完整测评获得更精准的评估');
  }
  return recs.slice(0, 3);
}
