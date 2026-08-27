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
import { requireChildOwnership } from '@/lib/auth/child-access';
import {
  numToLevel,
  getNextLevel,
  getRecommendedTestLevel,
  getConfirmedLevel,
  getEstimatedLevel,
  getDisplayLevel,
  deriveAssessmentStatus,
  isValidLevel,
} from '@/lib/level-service';

const supabase = getSupabaseClient();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const childId = searchParams.get('child_id');

  if (!childId) {
    return NextResponse.json({ error: '缺少child_id参数' }, { status: 400 });
  }

  // 鉴权：验证当前用户对该 child 的访问权限
  const auth = await requireChildOwnership(childId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
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

  // 从 raw_result 中提取 Quick Assessment 主估算等级（characterLevel）
  // 主估算等级是 estimated_level 的权威来源，character_level_u 仅为区间上限
  const raw = latestQuick?.raw_result as Record<string, any> | null | undefined;
  const extractLevelNum = (val: any): number | undefined => {
    if (!val) return undefined;
    if (typeof val === 'number') return val;
    const m = String(val).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : undefined;
  };
  const quickCharacterLevel = extractLevelNum(raw?.characterLevel);

  // ===== 3. 确定级别与状态（统一使用 Level Service）
  const confirmedLevel = getConfirmedLevel(latestFormal);
  const estimatedLevel = getEstimatedLevel({
    reading_base: latestQuick?.reading_base,
    character_level_u: latestQuick?.character_level_u,
    character_level: quickCharacterLevel,
  });
  const recommendedTestLevel = getRecommendedTestLevel({
    reading_base: latestQuick?.reading_base,
    character_level_u: latestQuick?.character_level_u,
    word_level_u: latestQuick?.word_level_u,
  });
  const assessmentStatus = deriveAssessmentStatus({
    hasFormalTest: !!latestFormal,
    hasQuickResult: !!latestQuick,
  });

  // current_level：正式测试优先用 confirmed_level；只有快速测评时用 estimated_level
  const currentLevel = confirmedLevel ?? estimatedLevel;
  // 展示用级别：优先 confirmed，其次 estimated，最低 SRC100
  const displayLevel = getDisplayLevel({ confirmedLevel, estimatedLevel });
  // assessment_type（兼容旧字段 assessmentType）
  const assessmentType = latestFormal ? 'formal' : latestQuick ? 'quick' : 'none';

  const currentLevelNum = displayLevel === 'SRC100' ? 100 : displayLevel === 'SRC300' ? 300 : displayLevel === 'SRC500' ? 500 : 800;

  // ===== 4. 获取字库数据（以展示级别为基准展示字库规模）
  const allSrcChars = getCharList(displayLevel);
  const allWords = getWordList(displayLevel);
  const rjbLevel = getCorrespondingRJBLevel(displayLevel);
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
    // === 快速测评：不输出精确掌握数，避免"100%正式掌握"错觉
    // estimated 状态只给出等级估算，mastery 相关用 0/null 区分 confirmed
    charMasteryRate = 0;
    vocabMasteryRate = 0;
    masteredCount = 0;
    vocabMastered = 0;
    testedCount = 0;
    vocabTested = 0;
    learningCount = 0;
    untestedCount = 0;
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

  // ===== 8. 下一等级（由 Level Service 统一计算，基于 confirmed_level）
  const nextLevel = currentLevel ? getNextLevel(currentLevel) ?? undefined : undefined;

  // ===== 9. 优势/弱项/建议
  const strengths = hasFormalTest
    ? generateStrengths(charMasteryRate, vocabMasteryRate)
    : [];
  const areasToImprove = hasFormalTest
    ? generateAreasToImprove(charMasteryRate, vocabMasteryRate)
    : [];
  const recommendations = generateRecommendations(
    recommendedTestLevel,
    hasFormalTest,
    charMasteryRate,
    vocabMasteryRate,
    latestQuick?.confidence || 'low',
  );

  return {
    childId,
    // ===== 核心架构字段（统一字段命名） =====
    // confirmed_level：正式测试确认的级别，null 表示尚未完成正式测试
    confirmed_level: confirmedLevel,
    // estimated_level：快速测评预估的级别，null 表示尚未完成快速测评
    estimated_level: estimatedLevel,
    // recommended_test_level：推荐的正式测试级别
    recommended_test_level: recommendedTestLevel,
    // current_level：当前级别 = confirmed_level 优先，无正式测试时用 estimated_level
    current_level: confirmedLevel ?? estimatedLevel ?? null,
    // next_level：下一级别（基于 current_level 由 Level Service 统一计算）
    next_level: nextLevel ?? null,
    // assessment_status：not_started / estimated / confirmed
    assessment_status: assessmentStatus,
    // ===== 兼容旧字段（前端暂用，后续逐步迁移） =====
    currentLevel: displayLevel,
    assessmentType,
    suggestedLevel: estimatedLevel ?? undefined,
    // ===== 掌握度数据 =====
    srcMastery: {
      level: displayLevel,
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
