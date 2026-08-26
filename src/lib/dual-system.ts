/**
 * 双体系映射模块
 * SRC字库 ↔ 人教版识字表
 * 通过字符级（character → character）映射
 */
import { LEVEL_CONFIG, type Level } from './types';
import { getNextLevel, SRC_TO_RJB } from './level-service';

/**
 * 字符映射结果
 */
export interface CharMappingResult {
  /** 字库总字数 */
  totalCount: number;
  /** 被SRC测试覆盖的字数 */
  coveredCount: number;
  /** 覆盖率（0-1） */
  coverageRate: number;
  /** 覆盖的字中孩子掌握的数量 */
  masteredCount: number;
  /** 覆盖范围内的正确率（0-1） */
  masteryRateInCoverage: number;
  /** 家长端显示用：已掌握量（直接用masteredCount，不是估算） */
  displayMasteredCount: number;
}

/**
 * 双体系结果
 */
export interface DualSystemResult {
  src: {
    level: Level;
    totalCount: number;
    testedCount: number;
    correctCount: number;
    masteryRate: number;
    estimatedMasteredCount: number;
    isFullTest: boolean;
  };
  pep: {
    level: string;
    totalCount: number;
    coveredCount: number;
    coverageRate: number;
    masteredCount: number;
    masteryRateInCoverage: number;
    displayMasteredCount: number;
  };
  vocabulary: {
    testedCount: number;
    correctCount: number;
    masteryRate: number;
  };
}

/**
 * 计算SRC与对应等级人教版的覆盖率
 * 对应关系：SRC100↔人教版100, SRC300↔人教版300, ...
 */
export function calculatePepCoverage(
  srcLevel: Level,
  srcChars: string[],
  pepChars: string[]
): {
  overlap: string[];
  totalPep: number;
  overlapCount: number;
  coverageRate: number;
} {
  const pepSet = new Set(pepChars);
  const overlap: string[] = [];

  for (const c of srcChars) {
    if (pepSet.has(c)) {
      overlap.push(c);
    }
  }

  return {
    overlap,
    totalPep: pepChars.length,
    overlapCount: overlap.length,
    coverageRate: pepChars.length > 0 ? overlap.length / pepChars.length : 0,
  };
}

/**
 * 从SRC测试结果推导人教版掌握情况
 * 核心原则：未测试 ≠ 不认识
 */
export function calculatePepMastery(
  srcKnownChars: string[],
  srcUnknownChars: string[],
  pepChars: string[]
): CharMappingResult {
  const pepSet = new Set(pepChars);
  const knownInPep = new Set<string>();
  const unknownInPep = new Set<string>();

  for (const c of srcKnownChars) {
    if (pepSet.has(c)) {
      knownInPep.add(c);
    }
  }

  for (const c of srcUnknownChars) {
    if (pepSet.has(c)) {
      unknownInPep.add(c);
    }
  }

  const coveredCount = knownInPep.size + unknownInPep.size;
  const masteredCount = knownInPep.size;
  const masteryRateInCoverage =
    coveredCount > 0 ? masteredCount / coveredCount : 0;

  return {
    totalCount: pepChars.length,
    coveredCount,
    coverageRate: pepChars.length > 0 ? coveredCount / pepChars.length : 0,
    masteredCount,
    masteryRateInCoverage,
    // 家长端显示：显示实际掌握的字数量，分母用人教版总字数
    // 注意：未测试的字不计入"不认识"
    displayMasteredCount: masteredCount,
  };
}

/**
 * 计算SRC抽测估算掌握量
 * - 全测：直接用correctCount
 * - 抽测：correctCount / testedCount * totalCount（估算）
 */
export function estimateSrcMastery(
  level: Level,
  testedCount: number,
  correctCount: number
): {
  masteryRate: number;
  estimatedMasteredCount: number;
  isFullTest: boolean;
} {
  const config = LEVEL_CONFIG[level];
  const totalCount = config.charCount;
  const isFullTest = testedCount >= totalCount * 0.95; // 95%以上视为全测

  const masteryRate = testedCount > 0 ? correctCount / testedCount : 0;
  const estimatedMasteredCount = isFullTest
    ? correctCount
    : Math.round(masteryRate * totalCount);

  return {
    masteryRate,
    estimatedMasteredCount,
    isFullTest,
  };
}

/**
 * 获取对应等级的人教版级别名
 */
export function getPepLevelName(srcLevel: Level): string {
  const map: Record<Level, string> = {
    SRC100: '人教版100',
    SRC300: '人教版300',
    SRC500: '人教版500',
    SRC800: '人教版800',
  };
  return map[srcLevel] || '人教版';
}

/**
 * 综合计算双体系完整结果
 */
export function calculateDualSystemResult(params: {
  level: Level;
  srcCharsTotal: string[];
  pepCharsTotal: string[];
  srcKnownChars: string[];
  srcUnknownChars: string[];
  vocabTestedCount: number;
  vocabCorrectCount: number;
}): DualSystemResult {
  const {
    level,
    srcCharsTotal,
    pepCharsTotal,
    srcKnownChars,
    srcUnknownChars,
    vocabTestedCount,
    vocabCorrectCount,
  } = params;

  const testedCount = srcKnownChars.length + srcUnknownChars.length;

  // SRC阅读识字
  const srcEstimate = estimateSrcMastery(level, testedCount, srcKnownChars.length);

  // 人教版基础识字（映射）
  const pepResult = calculatePepMastery(
    srcKnownChars,
    srcUnknownChars,
    pepCharsTotal
  );

  // 词组掌握
  const vocabMasteryRate =
    vocabTestedCount > 0 ? vocabCorrectCount / vocabTestedCount : 0;

  return {
    src: {
      level,
      totalCount: srcCharsTotal.length,
      testedCount,
      correctCount: srcKnownChars.length,
      masteryRate: srcEstimate.masteryRate,
      estimatedMasteredCount: srcEstimate.estimatedMasteredCount,
      isFullTest: srcEstimate.isFullTest,
    },
    pep: {
      level: getPepLevelName(level),
      totalCount: pepCharsTotal.length,
      coveredCount: pepResult.coveredCount,
      coverageRate: pepResult.coverageRate,
      masteredCount: pepResult.masteredCount,
      masteryRateInCoverage: pepResult.masteryRateInCoverage,
      displayMasteredCount: pepResult.displayMasteredCount,
    },
    vocabulary: {
      testedCount: vocabTestedCount,
      correctCount: vocabCorrectCount,
      masteryRate: vocabMasteryRate,
    },
  };
}
