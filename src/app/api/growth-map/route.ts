/**
 * 成长地图 API
 * 
 * 数据来源优先级（正式测试为唯一参照指标）：
 * 1. test_results（正式字词库测试）→ 完整成长地图）
 * 2. quick_assessment_results（快速测评 → 建议级别 + 引导做正式测试）
 * 3. 都没有 → 起点引导
 * 
 * 核心原则：
 * - 直接测试（快速测评）仅做引流，给出建议级别
 * - 只有完成正式字词库测试（SRC100/300/500/800）后才显示完整报告
 * - 正式测试结果是成长地图的唯一参照指标
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

  if (!childId) {
    return NextResponse.json({ error: '缺少child_id参数' }, { status: 400 });
  }

  try {
    const growthMap = await calculateGrowthMap(childId);
    return NextResponse.json({ success: true, data: growthMap });
  } catch (error) {
    console.error('[growth-map] error:', error);
    return NextResponse.json({ error: '生成成长地图失败' }, { status: 500 });
  }
}

/**
 * 计算成长地图数据
 * 优先使用正式测试结果（test_results），否则降级到快速测评（仅建议级别）
 */
async function calculateGrowthMap(childId: string): Promise<GrowthMapData> {
  // ===== 1. 查询正式测试结果（test_results）
  const { data: formalResults, error: formalError } = await supabase
    .from('test_results')
    .select('*')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (formalError) {
    console.error('[growth-map] formal results error:', formalError);
  }

  const latestFormal = formalResults?.[0];
  const hasFormalTest = !!latestFormal;

  // ===== 2. 查询快速测评结果
  const { data: quickResults, error: qrError } = await supabase
    .from('quick_assessment_results')
    .select('*')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (qrError) {
    console.error('[growth-map] quick results error:', qrError);
  }

  const latestQuick = quickResults?.[0];
  const allQuickResults = quickResults || [];

  // ===== 3. 确定当前级别
  let currentLevel: Level;
  let suggestedLevel: Level | null = null; // 快速测评建议级别
  let assessmentType: 'formal' | 'quick' | 'none' = 'none';

  if (latestFormal) {
    // 有正式测试 → 用正式测试级别
    currentLevel = latestFormal.level as Level;
    assessmentType = 'formal';
  } else if (latestQuick) {
    // 只有快速测评 → 用建议级别
    currentLevel = numToLevel(latestQuick.reading_base || latestQuick.character_level_u || 100);
    suggestedLevel = currentLevel;
    assessmentType = 'quick';
  } else {
    // 都没有 → 最低级
    currentLevel = 'SRC100';
    assessmentType = 'none';
  }

  const currentLevelNum = levelToNum(currentLevel);

  // ===== 4. 获取字库数据
  const allSrcChars = getCharList(currentLevel);
  const allWords = getWordList(currentLevel);
  const rjbLevel = getCorrespondingRJBLevel(currentLevel);
  const allRJBChars = getRJBCharList(rjbLevel);

  // ===== 5. 计算掌握度
  let charMasteryRate: number;
  let vocabMasteryRate: number;
  let masteredCount: number;
  let vocabMastered: number;
  let testedCount: number;
  let vocabTested: number;
  let learningCount: number;
  let untestedCount: number;

  if (latestFormal) {
    // === 正式测试：精确数据
    charMasteryRate = (latestFormal.character_mastery_rate ?? latestFormal.character_score / 100) || 0;
    vocabMasteryRate = (latestFormal.vocab_mastery_rate ?? latestFormal.vocab_score / 100) || 0;
    masteredCount = latestFormal.stable_char_count || Math.floor(allSrcChars.length * charMasteryRate);
    vocabMastered = latestFormal.stable_vocab_count || Math.floor(allWords.length * vocabMasteryRate);
    testedCount = allSrcChars.length;
    vocabTested = allWords.length;
    learningCount = Math.floor(testedCount * 0.1);
    untestedCount = 0;
  } else if (latestQuick) {
    // === 快速测评：估算值（中位估算
    const charLower = latestQuick.character_level_l || 0;
    const charUpper = latestQuick.character_level_u || currentLevelNum;
    const wordLower = latestQuick.word_level_l || 0;
    const wordUpper = latestQuick.word_level_u || currentLevelNum;

    const charMasteryNum = Math.round((charLower + charUpper) / 2);
    const wordMasteryNum = Math.round((wordLower + wordUpper) / 2);

    charMasteryRate = Math.min(1, Math.max(0, charMasteryNum / allSrcChars.length));
    vocabMasteryRate = Math.min(1, Math.max(0, wordMasteryNum / allWords.length));

    masteredCount = Math.min(allSrcChars.length, Math.max(0, charMasteryNum));
    vocabMastered = Math.min(allWords.length, Math.max(0, wordMasteryNum));

    testedCount = Math.floor(allSrcChars.length * 0.3); // 快速测评覆盖率约30%
    vocabTested = Math.floor(allWords.length * 0.3);
    learningCount = Math.floor(testedCount * 0.15);
    untestedCount = allSrcChars.length - testedCount;
  } else {
    // === 无测试数据
    charMasteryRate = 0;
    vocabMasteryRate = 0;
    masteredCount = 0;
    vocabMastered = 0;
    testedCount = 0;
    vocabTested = 0;
    learningCount = 0;
    untestedCount = allSrcChars.length;
  }

  // ===== 6. 人教版交叉计算
  const rjbSet = new Set(allRJBChars);
  const overlapChars = allSrcChars.filter(c => rjbSet.has(c));
  const rjbMastered = Math.floor(overlapChars.length * charMasteryRate);
  const rjbTotal = allRJBChars.length;
  const rjbMasteryRate = rjbTotal > 0 ? rjbMastered / rjbTotal : 0;

  // ===== 7. 成长趋势
  const trend = buildTrend(
    hasFormalTest ? formalResults || [] : allQuickResults,
    hasFormalTest,
    currentLevelNum,
    allSrcChars.length,
    allWords.length,
  );

  // ===== 8. 下一等级
  const currentIdx = LEVEL_NAMES.indexOf(currentLevel);
  const nextLevel = currentIdx < LEVEL_NAMES.length - 1 ? LEVEL_NAMES[currentIdx + 1] : undefined;

  // ===== 9. 优势/弱项/建议
  const strengths = hasFormalTest
    ? generateStrengths(charMasteryRate, vocabMasteryRate)
    : [];
  const areasToImprove = hasFormalTest
    ? generateAreasToImprove(charMasteryRate, vocabMasteryRate)
    : [];
  const recommendations = generateRecommendations(
    currentLevel,
    hasFormalTest,
    charMasteryRate,
    vocabMasteryRate,
    latestQuick?.confidence || 'low',
  );

  return {
    childId,
    currentLevel,
    assessmentType,
    srcMastery: {
      level: currentLevel,
      mastered: masteredCount,
      learning: learningCount,
      untested: untestedCount,
      masteryRate: charMasteryRate,
      total: allSrcChars.length,
      isFullTest: hasFormalTest,
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
      tested: vocabTested,
      correct: vocabMastered,
      masteryRate: vocabMasteryRate,
      isFullTest: hasFormalTest,
    },
    nextLevel,
    suggestedLevel: suggestedLevel || undefined,
    quickConfidence: latestQuick?.confidence || undefined,
    trend,
    strengths,
    areasToImprove,
    recommendations,
  };
}

/**
 * 构建成长趋势数据
 */
function buildTrend(
  results: any[],
  isFormal: boolean,
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

  const sorted = [...results].sort((a, b) =>
    new Date(a.completed_at || a.created_at).getTime() - new Date(b.completed_at || b.created_at).getTime()
  );

  const charTrend = sorted.map(r => ({
    date: formatDate(new Date(r.completed_at || r.created_at)),
    rate: isFormal
      ? r.character_mastery_rate ?? (r.character_score ?? 0) / 100
      : r.character_level_u
        ? ((r.character_level_l + r.character_level_u) / 2) / totalChars
        : 0,
  }));

  const vocabTrend = sorted.map(r => ({
    date: formatDate(new Date(r.completed_at || r.created_at)),
    rate: isFormal
      ? r.vocab_mastery_rate ?? (typeof r.vocab_score === 'number' ? r.vocab_score / 100 : 0)
      : r.word_level_u
        ? ((r.word_level_l + r.word_level_u) / 2) / totalWords
        : 0,
  }));

  return {
    charMastery: charTrend,
    vocabMastery: vocabTrend,
  };
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function generateStrengths(charRate: number, vocabRate: number): string[] {
  const strengths: string[] = [];
  if (charRate >= 0.8) {
    strengths.push('单字掌握扎实，基础框架已建立');
  } else if (charRate >= 0.5) {
    strengths.push('单字掌握稳步提升中，基础框架已建立');
  }
  if (vocabRate >= 0.7) {
    strengths.push('词汇量增长较快，阅读接触广泛');
  } else if (vocabRate >= 0.4) {
    strengths.push('词汇识别能力持续进步中，具备基本阅读词汇量');
  }
  if (strengths.length === 0) {
    strengths.push('正在起步阶段，潜力巨大');
  }
  return strengths;
}

function generateAreasToImprove(charRate: number, vocabRate: number): string[] {
  const areas: string[] = [];
  if (vocabRate < charRate - 0.1) {
    areas.push('词组应用需要加强，建议多阅读加强词语积累');
  }
  if (charRate < 0.5) {
    areas.push('建议通过阅读在真实语境中加深对汉字的理解');
  }
  if (areas.length === 0 && charRate < 0.9) {
    areas.push('继续巩固已学字词，向更高阶迈进');
  }
  return areas;
}

function generateRecommendations(
  level: Level,
  hasFormalTest: boolean,
  charRate: number,
  vocabRate: number,
  confidence: string,
): string[] {
  // 如果只有快速测评时，重点引导做正式测试
  if (!hasFormalTest && confidence !== 'none') {
    return [
      `建议从${level}级别正式字词库测试开始，获取更精准的识字量评估`,
      '每日15分钟中文绘本阅读，在语境中巩固识字',
      '每周1次正式测字，持续跟踪成长进度',
    ];
  }

  const recs: string[] = [];
  
  if (charRate < 0.6) {
    recs.push('每日15分钟中文绘本阅读');
    recs.push('每周1次完整测字，跟踪成长进度');
  } else if (charRate < 0.85) {
    recs.push('继续扩大阅读常用字');
    recs.push('通过词组和闯关进一步提升中文理解能力');
  } else {
    recs.push('向更高一级字词库挑战');
    recs.push('增加四字词和简单句式练习');
  }
  
  if (vocabRate < charRate - 0.1) {
    recs.splice(1, 0, '词语识别是当前阅读提升的关键，建议通过分级绘本在语境中积累常用词语');
  }

  return recs.slice(0, 3);
}

export const runtime = 'nodejs';
