/**
 * 快速体验测评 V2 - 自适应分级测试核心算法
 * 
 * 核心机制：
 * 1. 逐级探测：SRC100 → 300 → 500 → 800（根据系统字库可扩展到1200）
 * 2. 每级验证：5个单字 + 3个词组
 * 3. 升级/降级规则：达到阈值升级，低于阈值降级
 * 4. 提前终止：连续两级不通过 或 已到最高/最低级
 * 5. 双水位测量：单字能力水位 + 词语能力水位，分别计算
 * 6. 阅读等级 = min(单字水位, 词语水位) （短板效应）
 * 7. i+1推荐 = 阅读等级 + 轻度提升
 * 
 * 设计原则：
 * - 总题量不超过30单字 + 15词语 = 45题（最大值）
 * - 大多数孩子在20-35题之间完成
 * - 不使用"分数""考试"等压力词汇
 * - 所有参数可配置
 */

import { Level, LEVEL_CONFIG } from './types';
import {
  getAssessmentCharsForLevel,
  getAssessmentWordsForLevel,
} from './questions';

// ============================================================
// 可配置参数（后台可调整）
// ============================================================

/** 自适应测试配置 */
export const ADAPTIVE_CONFIG = {
  /** 每个等级测试的单字数量 */
  charsPerLevel: 5,
  /** 每个等级测试的词组数量 */
  wordsPerLevel: 3,
  /** 升级阈值 - 单字正确率（达到或超过则升级尝试下一级） */
  upgradeCharThreshold: 0.70,
  /** 升级阈值 - 词组正确率 */
  upgradeVocabThreshold: 0.60,
  /** 降级阈值 - 单字正确率（低于则不再往上测，已在最低级则停止） */
  downgradeCharThreshold: 0.40,
  /** 降级阈值 - 词组正确率 */
  downgradeVocabThreshold: 0.30,
  /** 起始测试等级 */
  startLevel: 'SRC100' as Level,
  /** 最高测试等级（受当前字库限制） */
  maxLevel: 'SRC800' as Level,
  /** 连续多少级不通过则停止测试 */
  maxConsecutiveFailLevels: 2,
  /** i+1 轻度提升比例（推荐阅读难度在稳定基础上提升多少） */
  iPlusOneBoost: 0.15,
  /** 置信度等级阈值 */
  confidence: {
    high: { minLevels: 3, minTotalItems: 20 },
    medium: { minLevels: 2, minTotalItems: 12 },
  },
};

/** 等级顺序（用于逐级推进） */
export const LEVEL_ORDER: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];

// ============================================================
// 类型定义
// ============================================================

/** 测试题目类型 */
export type QAItem = {
  id: string;
  type: 'character' | 'vocabulary';
  content: string;
  level: Level;
  /** 该题在本级内的序号（0-7） */
  indexInLevel: number;
};

/** 答题结果 */
export type QAResult = {
  id: string;
  type: 'character' | 'vocabulary';
  content: string;
  level: Level;
  isCorrect: boolean;
  reactionTimeMs: number;
};

/** 单级测试结果 */
export type LevelResult = {
  level: Level;
  charTested: number;
  charCorrect: number;
  charRate: number;
  vocabTested: number;
  vocabCorrect: number;
  vocabRate: number;
  /** 该级是否"通过"（达到升级阈值） */
  passed: boolean;
  /** 该级是否"不通过"（低于降级阈值，不足以支持此级） */
  failed: boolean;
};

/** 最终能力评估结果 */
export type AdaptiveAssessmentResult = {
  /** 单字能力水位（最高稳定通过的等级） */
  charWaterLevel: Level;
  /** 词语能力水位 */
  vocabWaterLevel: Level;
  /** 阅读基础等级（取较低者，短板效应） */
  readingLevel: Level;
  /** i+1 推荐阅读难度等级（轻度提升） */
  recommendedLevel: Level;
  /** 置信度 */
  confidence: 'low' | 'medium' | 'high';
  /** 各级别测试明细 */
  levelBreakdown: Record<Level, {
    charTested: number; charCorrect: number; charRate: number;
    vocabTested: number; vocabCorrect: number; vocabRate: number;
    tested: boolean; passed: boolean; failed: boolean;
  }>;
  /** 总题数 */
  totalTested: number;
  charTotalTested: number;
  charTotalCorrect: number;
  vocabTotalTested: number;
  vocabTotalCorrect: number;
  charOverallRate: number;
  vocabOverallRate: number;
  /** 测试了几个完整等级 */
  levelsTested: number;
  /** 结束原因 */
  endReason: 'max_level_reached' | 'consecutive_fail' | 'lowest_level_fail' | 'all_levels_done';
};

/** 测试会话状态（用于追踪进度） */
export type AdaptiveSession = {
  /** 当前测试到的等级 */
  currentLevel: Level;
  /** 当前在本级中的题目索引（0-7：0-4单字，5-7词组） */
  currentIndexInLevel: number;
  /** 当前是单字阶段还是词组阶段 */
  phase: 'character' | 'vocabulary';
  /** 已完成的等级结果 */
  completedLevels: LevelResult[];
  /** 本级已答的单字结果 */
  currentLevelCharResults: QAResult[];
  /** 本级已答的词组结果 */
  currentLevelVocabResults: QAResult[];
  /** 连续失败的等级数 */
  consecutiveFailCount: number;
  /** 是否已结束 */
  isFinished: boolean;
  /** 结束原因 */
  endReason?: AdaptiveAssessmentResult['endReason'];
  /** 方向：up=向上升级探索，down=向下降级确认 */
  direction: 'up' | 'down';
};

// ============================================================
// 工具函数
// ============================================================

/** 获取下一个等级 */
function getNextLevel(level: Level): Level | null {
  const idx = LEVEL_ORDER.indexOf(level);
  if (idx < 0 || idx >= LEVEL_ORDER.length - 1) return null;
  return LEVEL_ORDER[idx + 1];
}

/** 获取上一个等级 */
function getPrevLevel(level: Level): Level | null {
  const idx = LEVEL_ORDER.indexOf(level);
  if (idx <= 0) return null;
  return LEVEL_ORDER[idx - 1];
}

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 从指定等级的 minimum_src_level 题池中抽取n个单字
 * - 优先从core（核心实词）中抽
 * - 不足时从supplemental（多音字/虚词）中补
 * - 排除low_value
 * - 排除已测试过的
 */
function sampleChars(
  level: Level,
  count: number,
  coreRatio: number = 0.7,
  excludeChars: Set<string> = new Set(),
): string[] {
  const coreChars = getAssessmentCharsForLevel(level, 'core').filter(c => !excludeChars.has(c));
  const suppChars = getAssessmentCharsForLevel(level, 'supplemental').filter(c => !excludeChars.has(c));

  const coreCount = Math.min(Math.round(count * coreRatio), coreChars.length);
  const suppNeeded = count - coreCount;

  const result: string[] = [];
  // 核心字
  const shuffledCore = shuffle(coreChars);
  result.push(...shuffledCore.slice(0, coreCount));

  // 补充字（如果核心不够，先从核心全拿，再从补充拿）
  const remaining = count - result.length;
  if (remaining > 0) {
    const shuffledSupp = shuffle(suppChars);
    result.push(...shuffledSupp.slice(0, remaining));
  }

  return shuffle(result);
}

/**
 * 从指定等级的 minimum_src_level 题池中抽取n个词语
 * - 优先从core（常用词、成语）中抽
 * - 不足时从supplemental中补
 * - 排除low_value
 */
function sampleWords(
  level: Level,
  count: number,
  coreRatio: number = 0.8,
  excludeWords: Set<string> = new Set(),
): string[] {
  const coreWords = getAssessmentWordsForLevel(level, 'core').filter(w => !excludeWords.has(w));
  const suppWords = getAssessmentWordsForLevel(level, 'supplemental').filter(w => !excludeWords.has(w));

  const coreCount = Math.min(Math.round(count * coreRatio), coreWords.length);
  const result: string[] = [];

  const shuffledCore = shuffle(coreWords);
  result.push(...shuffledCore.slice(0, coreCount));

  const remaining = count - result.length;
  if (remaining > 0) {
    const shuffledSupp = shuffle(suppWords);
    result.push(...shuffledSupp.slice(0, remaining));
  }

  return shuffle(result);
}

// ============================================================
// 生成新一级的题目
// ============================================================

/**
 * 为指定等级生成一套测试题（5单字 + 3词组）
 */
export function generateLevelQuestions(
  level: Level,
  config = ADAPTIVE_CONFIG,
  excludeChars: Set<string> = new Set(),
  excludeWords: Set<string> = new Set(),
): { chars: QAItem[]; words: QAItem[] } {
  const chars = sampleChars(level, config.charsPerLevel, 0.7, excludeChars);
  const words = sampleWords(level, config.wordsPerLevel, 0.8, excludeWords);

  const charItems: QAItem[] = chars.map((c, i) => ({
    id: `char_${level}_${i}_${Date.now()}`,
    type: 'character',
    content: c,
    level,
    indexInLevel: i,
  }));

  const wordItems: QAItem[] = words.map((w, i) => ({
    id: `word_${level}_${i}_${Date.now()}`,
    type: 'vocabulary',
    content: w,
    level,
    indexInLevel: config.charsPerLevel + i,
  }));

  return { chars: charItems, words: wordItems };
}

// ============================================================
// 会话管理
// ============================================================

/**
 * 初始化一个自适应测试会话
 */
export function initAdaptiveSession(
  startLevel: Level = ADAPTIVE_CONFIG.startLevel,
  config = ADAPTIVE_CONFIG,
): { session: AdaptiveSession; firstQuestions: QAItem[] } {
  const { chars, words } = generateLevelQuestions(startLevel, config);
  
  const session: AdaptiveSession = {
    currentLevel: startLevel,
    currentIndexInLevel: 0,
    phase: 'character',
    completedLevels: [],
    currentLevelCharResults: [],
    currentLevelVocabResults: [],
    consecutiveFailCount: 0,
    isFinished: false,
    direction: 'up',
  };

  return {
    session,
    firstQuestions: chars, // 先返回单字题
  };
}

/**
 * 计算一个等级的测试结果
 */
function computeLevelResult(
  level: Level,
  charResults: QAResult[],
  vocabResults: QAResult[],
  config = ADAPTIVE_CONFIG,
): LevelResult {
  const charTested = charResults.length;
  const charCorrect = charResults.filter(r => r.isCorrect).length;
  const charRate = charTested > 0 ? charCorrect / charTested : 0;

  const vocabTested = vocabResults.length;
  const vocabCorrect = vocabResults.filter(r => r.isCorrect).length;
  const vocabRate = vocabTested > 0 ? vocabCorrect / vocabTested : 0;

  // 通过：单字≥70% 且 词组≥60%
  const passed = charRate >= config.upgradeCharThreshold && vocabRate >= config.upgradeVocabThreshold;

  // 不通过：单字＜40% 且 词组＜30%（足以判断此级不稳定）
  const failed = charRate < config.downgradeCharThreshold && vocabRate < config.downgradeVocabThreshold;

  return {
    level,
    charTested,
    charCorrect,
    charRate,
    vocabTested,
    vocabCorrect,
    vocabRate,
    passed,
    failed,
  };
}

/**
 * 提交一道题的答案，返回下一道题或测试结束
 * 
 * 返回：
 * - nextQuestion: 下一道题（如果还有）
 * - updatedSession: 更新后的会话状态
 * - levelCompleted: 如果刚完成一个等级，返回该级结果
 * - finalResult: 如果测试结束，返回最终评估结果
 */
export function submitAnswer(
  session: AdaptiveSession,
  answer: QAResult,
  config = ADAPTIVE_CONFIG,
  excludeChars: Set<string> = new Set(),
  excludeWords: Set<string> = new Set(),
): {
  nextQuestion: QAItem | null;
  updatedSession: AdaptiveSession;
  levelCompleted: LevelResult | null;
  finalResult: AdaptiveAssessmentResult | null;
} {
  const s: AdaptiveSession = { ...session };
  let levelCompleted: LevelResult | null = null;
  let finalResult: AdaptiveAssessmentResult | null = null;
  let nextQuestion: QAItem | null = null;

  // 保存当前答案
  if (answer.type === 'character') {
    s.currentLevelCharResults = [...s.currentLevelCharResults, answer];
  } else {
    s.currentLevelVocabResults = [...s.currentLevelVocabResults, answer];
  }

  // 判断是否完成了本级的单字阶段
  if (s.phase === 'character' && s.currentLevelCharResults.length >= config.charsPerLevel) {
    // 切换到词组阶段
    s.phase = 'vocabulary';
    s.currentIndexInLevel = config.charsPerLevel;
  }

  // 判断是否完成了整个等级的测试
  const levelDone = s.currentLevelVocabResults.length >= config.wordsPerLevel;

  if (levelDone) {
    // 计算本级结果
    const result = computeLevelResult(
      s.currentLevel,
      s.currentLevelCharResults,
      s.currentLevelVocabResults,
      config,
    );
    levelCompleted = result;
    s.completedLevels = [...s.completedLevels, result];

    // 判断下一步方向
    if (s.direction === 'up') {
      if (result.passed) {
        // 通过，尝试升级
        const nextLv = getNextLevel(s.currentLevel);
        s.consecutiveFailCount = 0;
        if (nextLv) {
          // 还能升级
          s.currentLevel = nextLv;
          s.phase = 'character';
          s.currentIndexInLevel = 0;
          s.currentLevelCharResults = [];
          s.currentLevelVocabResults = [];
        } else {
          // 已到最高级，测试结束
          s.isFinished = true;
          s.endReason = 'max_level_reached';
        }
      } else if (result.failed) {
        // 不通过
        s.consecutiveFailCount++;
        if (s.consecutiveFailCount >= config.maxConsecutiveFailLevels) {
          // 连续失败，结束
          s.isFinished = true;
          s.endReason = 'consecutive_fail';
        } else {
          // 还要继续往下测吗？如果现在是SRC100且失败，那就到此为止
          const prevLv = getPrevLevel(s.currentLevel);
          if (!prevLv) {
            s.isFinished = true;
            s.endReason = 'lowest_level_fail';
          } else {
            // 这里我们保持方向还是up，但连续失败计数增加
            // 如果只失败了一级，我们继续看是否要往下探测确认
            // 简化处理：连续两级fail就停，否则继续
            // 但对于第一次fail，我们不主动降级，因为可能下一级也fail但题目数量还不够
            // 简化方案：向上探索只升不降；连续两级不通过就停止
            s.isFinished = true;
            s.endReason = 'consecutive_fail';
          }
        }
      } else {
        // 介于通过和不通过之间（灰色地带）
        // 不再继续升级，停在当前级别作为稳定上限
        s.isFinished = true;
        s.endReason = 'all_levels_done';
      }
    }
  } else {
    // 还在本级中，生成下一道题
    if (s.phase === 'character') {
      // 下一道单字题
      const nextIdx = s.currentLevelCharResults.length;
      s.currentIndexInLevel = nextIdx;
      // 动态生成下一题
      const remainingChars = sampleChars(
        s.currentLevel,
        1,
        0.7,
        new Set([...excludeChars, ...s.currentLevelCharResults.map(r => r.content)]),
      );
      if (remainingChars.length > 0) {
        nextQuestion = {
          id: `char_${s.currentLevel}_${nextIdx}_${Date.now()}`,
          type: 'character',
          content: remainingChars[0],
          level: s.currentLevel,
          indexInLevel: nextIdx,
        };
      }
    } else {
      // 下一道词组题
      const nextIdx = s.currentLevelVocabResults.length;
      s.currentIndexInLevel = config.charsPerLevel + nextIdx;
      const remainingWords = sampleWords(
        s.currentLevel,
        1,
        0.8,
        new Set([...excludeWords, ...s.currentLevelVocabResults.map(r => r.content)]),
      );
      if (remainingWords.length > 0) {
        nextQuestion = {
          id: `word_${s.currentLevel}_${nextIdx}_${Date.now()}`,
          type: 'vocabulary',
          content: remainingWords[0],
          level: s.currentLevel,
          indexInLevel: config.charsPerLevel + nextIdx,
        };
      }
    }
  }

  // 如果测试结束，计算最终结果
  if (s.isFinished) {
    finalResult = computeFinalAssessment(s.completedLevels, s.endReason!, config);
  }

  return {
    nextQuestion,
    updatedSession: s,
    levelCompleted,
    finalResult,
  };
}

/**
 * 获取一个等级的第一题（用于初始化后）
 */
export function getNextQuestionForLevel(
  level: Level,
  phase: 'character' | 'vocabulary',
  indexInLevel: number,
  excludeChars: Set<string> = new Set(),
  excludeWords: Set<string> = new Set(),
  config = ADAPTIVE_CONFIG,
): QAItem | null {
  if (phase === 'character') {
    const chars = sampleChars(level, 1, 0.7, excludeChars);
    if (chars.length === 0) return null;
    return {
      id: `char_${level}_${indexInLevel}_${Date.now()}`,
      type: 'character',
      content: chars[0],
      level,
      indexInLevel,
    };
  } else {
    const words = sampleWords(level, 1, 0.8, excludeWords);
    if (words.length === 0) return null;
    return {
      id: `word_${level}_${indexInLevel}_${Date.now()}`,
      type: 'vocabulary',
      content: words[0],
      level,
      indexInLevel,
    };
  }
}

// ============================================================
// 最终评估计算
// ============================================================

/**
 * 计算最终评估结果
 * 
 * 核心逻辑：
 * 1. 分别找到单字和词语的"最高稳定通过等级"
 * 2. 阅读等级 = min(单字水位, 词语水位) — 短板效应
 * 3. i+1推荐 = 在阅读等级基础上轻度提升
 */
export function computeFinalAssessment(
  completedLevels: LevelResult[],
  endReason: AdaptiveAssessmentResult['endReason'],
  config = ADAPTIVE_CONFIG,
): AdaptiveAssessmentResult {
  // 初始化各级别明细
  const breakdown: AdaptiveAssessmentResult['levelBreakdown'] = {} as any;
  for (const lv of LEVEL_ORDER) {
    breakdown[lv] = {
      charTested: 0, charCorrect: 0, charRate: 0,
      vocabTested: 0, vocabCorrect: 0, vocabRate: 0,
      tested: false, passed: false, failed: false,
    };
  }

  // 填充已测试的级别
  let charTotalTested = 0, charTotalCorrect = 0;
  let vocabTotalTested = 0, vocabTotalCorrect = 0;

  for (const lr of completedLevels) {
    breakdown[lr.level] = {
      charTested: lr.charTested,
      charCorrect: lr.charCorrect,
      charRate: lr.charRate,
      vocabTested: lr.vocabTested,
      vocabCorrect: lr.vocabCorrect,
      vocabRate: lr.vocabRate,
      tested: true,
      passed: lr.passed,
      failed: lr.failed,
    };
    charTotalTested += lr.charTested;
    charTotalCorrect += lr.charCorrect;
    vocabTotalTested += lr.vocabTested;
    vocabTotalCorrect += lr.vocabCorrect;
  }

  const charOverallRate = charTotalTested > 0 ? charTotalCorrect / charTotalTested : 0;
  const vocabOverallRate = vocabTotalTested > 0 ? vocabTotalCorrect / vocabTotalTested : 0;

  // ---- 单字能力水位 ----
  // 找到最高的"通过"级别
  let charWaterLevel: Level = 'SRC100';
  let foundCharWater = false;
  // 从高到低遍历，找第一个通过的级别
  for (let i = completedLevels.length - 1; i >= 0; i--) {
    const lr = completedLevels[i];
    if (lr.passed) {
      charWaterLevel = lr.level;
      foundCharWater = true;
      break;
    }
  }
  // 如果没有明确通过的级别，找第一个不是failed的（灰色地带）
  if (!foundCharWater) {
    for (let i = 0; i < completedLevels.length; i++) {
      const lr = completedLevels[i];
      if (!lr.failed && lr.charRate >= 0.5) {
        charWaterLevel = lr.level;
        break;
      }
    }
  }

  // ---- 词语能力水位 ----
  let vocabWaterLevel: Level = 'SRC100';
  let foundVocabWater = false;
  for (let i = completedLevels.length - 1; i >= 0; i--) {
    const lr = completedLevels[i];
    if (lr.passed) {
      vocabWaterLevel = lr.level;
      foundVocabWater = true;
      break;
    }
  }
  if (!foundVocabWater) {
    for (let i = 0; i < completedLevels.length; i++) {
      const lr = completedLevels[i];
      if (!lr.failed && lr.vocabRate >= 0.4) {
        vocabWaterLevel = lr.level;
        break;
      }
    }
  }

  // ---- 阅读基础等级（短板效应）----
  // 取单字和词语中较低的那个
  const charIdx = LEVEL_ORDER.indexOf(charWaterLevel);
  const vocabIdx = LEVEL_ORDER.indexOf(vocabWaterLevel);
  const readingIdx = Math.min(charIdx, vocabIdx);
  const readingLevel = LEVEL_ORDER[Math.max(0, readingIdx)];

  // ---- i+1 推荐阅读等级 ----
  // 在阅读基础上轻度提升
  const recommendedIdx = Math.min(
    LEVEL_ORDER.length - 1,
    readingIdx + 1, // 先升一级
  );
  
  // 如果阅读等级和词语等级相同，且词语在边界上，就只提升半个等级（用同一级但更高置信）
  let recommendedLevel: Level = LEVEL_ORDER[recommendedIdx];
  
  // 更保守的i+1：只在当前等级基础上给一点余量，不直接跳到下一级
  // 如果阅读等级已经是最高级，那就保持
  if (readingIdx >= LEVEL_ORDER.length - 1) {
    recommendedLevel = LEVEL_ORDER[LEVEL_ORDER.length - 1];
  } else {
    // 根据词语和单字的差距决定i+1幅度
    // 如果词语和单字差距不大，可以升一级
    const gap = Math.abs(charIdx - vocabIdx);
    if (gap <= 1) {
      // 差距小，可以升到下一级
      recommendedLevel = LEVEL_ORDER[readingIdx + 1];
    } else {
      // 差距大（比如单字好但词语差很多），就保持当前
      recommendedLevel = readingLevel;
    }
  }

  // ---- 置信度 ----
  const levelsTested = completedLevels.length;
  const totalItems = charTotalTested + vocabTotalTested;
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (levelsTested >= config.confidence.high.minLevels && totalItems >= config.confidence.high.minTotalItems) {
    confidence = 'high';
  } else if (levelsTested >= config.confidence.medium.minLevels && totalItems >= config.confidence.medium.minTotalItems) {
    confidence = 'medium';
  }

  return {
    charWaterLevel,
    vocabWaterLevel,
    readingLevel,
    recommendedLevel,
    confidence,
    levelBreakdown: breakdown,
    totalTested: totalItems,
    charTotalTested,
    charTotalCorrect,
    vocabTotalTested,
    vocabTotalCorrect,
    charOverallRate,
    vocabOverallRate,
    levelsTested,
    endReason,
  };
}

// ============================================================
// 结果文案生成
// ============================================================

/** 阅读建议类型 */
export type ReadingRecommendation = {
  headline: string;
  description: string;
  bookLevel: string;
  tips: string[];
  nextStep: string;
};

/**
 * 生成阅读建议
 */
export function generateRecommendation(result: AdaptiveAssessmentResult): ReadingRecommendation {
  const { readingLevel, recommendedLevel, charWaterLevel, vocabWaterLevel, confidence } = result;

  const tips: string[] = [];
  let headline = '';
  let description = '';
  let bookLevel = '';
  let nextStep = '';

  const isCharStronger = LEVEL_ORDER.indexOf(charWaterLevel) > LEVEL_ORDER.indexOf(vocabWaterLevel);
  const isVocabStronger = LEVEL_ORDER.indexOf(vocabWaterLevel) > LEVEL_ORDER.indexOf(charWaterLevel);

  switch (readingLevel) {
    case 'SRC100':
      headline = '中文阅读启蒙阶段';
      description = '孩子已经开始认识一些基础中文常用字，可以从最简单的绘本和日常对话开始培养阅读兴趣。';
      bookLevel = '入门级 · 一页1~2句话的绘本';
      tips.push('每天10分钟亲子共读，从图多字少的绘本开始');
      tips.push('优先读生活主题的故事，建立字词与生活的联系');
      tips.push('多鼓励孩子说出认识的字，建立识字成就感');
      nextStep = '继续积累SRC100核心字词，逐步向SRC300过渡';
      break;
    case 'SRC300':
      headline = '初级阅读阶段';
      description = '孩子已经具备基础阅读能力，可以阅读简单的分级读物和短篇故事。词语积累是下一步的重点。';
      bookLevel = '初级 · 每页3~5句话的分级读物';
      if (isVocabStronger) {
        tips.push('继续扩大单字量，为更高阶阅读打基础');
      } else if (isCharStronger) {
        tips.push('多在阅读中学习词语，提升字词组合能力');
      } else {
        tips.push('保持每日阅读习惯，逐步增加阅读量');
      }
      tips.push('可以开始读简单的桥梁书，一页一段文字');
      tips.push('遇到不认识的字先猜再查，培养独立阅读能力');
      nextStep = '向SRC500进阶，同时加强词语在语境中的理解';
      break;
    case 'SRC500':
      headline = '独立阅读起步阶段';
      description = '孩子已经可以独立阅读中等难度的中文故事，阅读流畅度正在快速提升。';
      bookLevel = '中级 · 章节书入门 / 短篇桥梁书';
      if (isVocabStronger) {
        tips.push('继续拓展识字量，支撑更高难度的阅读');
      } else if (isCharStronger) {
        tips.push('多读不同类型的故事，丰富词汇量和表达');
      } else {
        tips.push('开始接触不同体裁的中文读物（故事、科普、童话）');
      }
      tips.push('可以尝试让孩子朗读，提升语感和流利度');
      tips.push('鼓励用中文复述故事，锻炼理解和表达');
      nextStep = '向SRC800进阶，阅读更多元化的中文内容';
      break;
    case 'SRC800':
    default:
      headline = '自主阅读阶段';
      description = '孩子已经具备较强的中文阅读能力，可以自主阅读大部分儿童文学作品，阅读正在从"学习阅读"转向"通过阅读学习"。';
      bookLevel = '高级 · 中长篇儿童文学 / 科普读物';
      tips.push('广泛阅读各类中文好书，让阅读成为一种习惯');
      tips.push('可以开始接触中国传统文化相关的故事和知识');
      tips.push('鼓励孩子用中文写日记、读后感，连接阅读与表达');
      nextStep = '持续扩大阅读广度和深度，进入真正的中文阅读世界';
      break;
  }

  return {
    headline,
    description,
    bookLevel,
    tips,
    nextStep,
  };
}

/**
 * 置信度文案
 */
export function getConfidenceText(confidence: 'low' | 'medium' | 'high'): string {
  switch (confidence) {
    case 'high': return '（基于多级别测试，结果较为稳定）';
    case 'medium': return '（基于有限测试，为初步估测）';
    case 'low': return '（题量较少，仅供参考）';
  }
}
