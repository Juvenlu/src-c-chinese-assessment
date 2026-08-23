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
 * 双体系交叉计算：基于唯一character_id去重
 */

import { NextResponse } from 'next/server';
import { getCharList, getWordList, getRJBCharList, getCorrespondingRJBLevel } from '@/lib/questions';
import { LEVEL_CONFIG, DEFAULT_SAMPLING_CONFIG } from '@/lib/types';
import type { Level, GrowthMapData, MasteryStatus } from '@/lib/types';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const childId = searchParams.get('child_id');
  const level = (searchParams.get('level') || 'SRC300') as Level;

  if (!childId) {
    return NextResponse.json({ error: '缺少child_id参数' }, { status: 400 });
  }

  try {
    const growthMap = await calculateGrowthMap(childId, level);
    return NextResponse.json({ success: true, data: growthMap });
  } catch (error) {
    console.error('生成成长地图失败:', error);
    return NextResponse.json({ error: '生成成长地图失败' }, { status: 500 });
  }
}

/**
 * 计算成长地图数据
 * 
 * 核心逻辑：
 * 1. 从character_mastery表获取孩子所有SRC字的掌握情况
 * 2. 计算SRC等级的掌握率
 * 3. 交叉计算人教版对应等级的掌握情况（通过字的交集）
 * 4. 从vocabulary_mastery表获取词组掌握情况
 * 5. 生成成长趋势（从历史记录表）
 */
async function calculateGrowthMap(
  childId: string,
  level: Level,
): Promise<GrowthMapData> {
  // 获取该等级的所有字
  const allSrcChars = getCharList(level);
  const allWords = getWordList(level);
  const rjbLevel = getCorrespondingRJBLevel(level);
  const allRJBChars = getRJBCharList(rjbLevel);

  // TODO: 从数据库获取孩子的掌握数据
  // 暂时使用模拟数据框架
  // 实际实现时应查询 character_mastery 和 vocabulary_mastery 表
  
  const levelConfig = LEVEL_CONFIG[level];
  
  // 模拟：假设有60-80%的字已测试，掌握率75%左右
  const testedRatio = 0.7;
  const masteryRate = 0.75;
  
  const testedCount = Math.floor(allSrcChars.length * testedRatio);
  const masteredCount = Math.floor(testedCount * masteryRate);
  const learningCount = Math.floor(testedCount * 0.15);
  const untestedCount = allSrcChars.length - testedCount;

  // 人教版交叉计算
  // 找SRC和人教版的交集
  const rjbSet = new Set(allRJBChars);
  const overlapChars = allSrcChars.filter(c => rjbSet.has(c));
  // 假设掌握率类似
  const rjbMastered = Math.floor(overlapChars.length * masteryRate);
  // 人教版未覆盖的SRC字也算"掌握的教材字"吗？不算！
  // 只有同时在人教版字库中且孩子掌握的字，才算
  const rjbTotal = allRJBChars.length;
  const rjbMasteryRate = rjbMastered / rjbTotal;

  // 词组掌握
  const vocabTested = Math.floor(allWords.length * 0.5);
  const vocabMastered = Math.floor(vocabTested * 0.65);

  // 成长趋势（模拟历史3个时间点）
  const now = new Date();
  const trend = {
    charMastery: [
      { date: formatDate(addMonths(now, -6)), rate: masteryRate - 0.2 },
      { date: formatDate(addMonths(now, -3)), rate: masteryRate - 0.1 },
      { date: formatDate(now), rate: masteryRate },
    ],
    vocabMastery: [
      { date: formatDate(addMonths(now, -6)), rate: 0.45 },
      { date: formatDate(addMonths(now, -3)), rate: 0.55 },
      { date: formatDate(now), rate: vocabMastered / vocabTested },
    ],
  };

  // 下一等级
  const levels: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  const currentIdx = levels.indexOf(level);
  const nextLevel = currentIdx < levels.length - 1 ? levels[currentIdx + 1] : undefined;

  return {
    childId,
    currentLevel: level,
    srcMastery: {
      level,
      mastered: masteredCount,
      learning: learningCount,
      untested: untestedCount,
      masteryRate,
      total: allSrcChars.length,
      isFullTest: testedCount >= allSrcChars.length * 0.95,
    },
    pepMastery: {
      level: rjbLevel,
      mastered: rjbMastered,
      total: rjbTotal,
      masteryRate: rjbMasteryRate,
      covered: overlapChars.length,
      coverageRate: overlapChars.length / rjbTotal,
    },
    vocabMastery: {
      mastered: vocabMastered,
      tested: vocabTested,
      masteryRate: vocabMastered / vocabTested,
    },
    nextLevel,
    trend,
    strengths: generateStrengths(masteryRate, vocabMastered / vocabTested),
    areasToImprove: generateAreasToImprove(masteryRate, vocabMastered / vocabTested),
    recommendations: generateRecommendations(level, masteryRate, vocabMastered / vocabTested),
  };
}

// 辅助函数
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
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
  }
  if (vocabRate >= 0.7) {
    strengths.push('词组理解能力强，能够在语境中灵活运用');
  }
  if (charRate > vocabRate + 0.1) {
    strengths.push('识字量增长较快，阅读接触广泛');
  }
  if (strengths.length < 2) {
    strengths.push('学习态度积极，每次测试都有新进步');
  }
  return strengths.slice(0, 3);
}

function generateAreasToImprove(charRate: number, vocabRate: number): string[] {
  const areas: string[] = [];
  if (vocabRate < charRate - 0.1) {
    areas.push('词组应用需要加强，建议多阅读加强词语积累');
  }
  if (charRate < 0.7) {
    areas.push('核心高频字需要继续巩固，建议每日坚持识字练习');
  }
  if (charRate < 0.5) {
    areas.push('基础字库覆盖面需要扩大，建议从SRC低一级别巩固');
  }
  areas.push('建议通过阅读在真实语境中加深对汉字的理解');
  return areas.slice(0, 3);
}

function generateRecommendations(level: Level, charRate: number, vocabRate: number): string[] {
  const recs: string[] = [];
  if (charRate >= 0.8 && vocabRate >= 0.7) {
    recs.push('可以尝试更高一级的绘本阅读');
  }
  recs.push('每日15分钟中文绘本阅读');
  recs.push('每周1次完整测字，跟踪成长进度');
  if (vocabRate < 0.6) {
    recs.push('增加词汇专项练习');
  }
  return recs;
}
