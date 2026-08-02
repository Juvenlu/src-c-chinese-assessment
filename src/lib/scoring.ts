import { Level, TestAnswer, LEVEL_CONFIG, PART_WEIGHTS, CharTestResult, WordTestResult } from '@/lib/types';

/**
 * Calculate scores for each part of the test
 */
export function calculatePartScores(
  answers: TestAnswer[],
  totalQuestions: number
): {
  characterScore: number;
  vocabScore: number;
  readingScore: number;
  comprehensionScore: number;
} {
  const part1Answers = answers.filter((a) => a.part === 1);
  const part2Answers = answers.filter((a) => a.part === 2);
  const part3Answers = answers.filter((a) => a.part === 3);
  const part4Answers = answers.filter((a) => a.part === 4);

  const part1Correct = part1Answers.filter((a) => a.is_correct).length;
  const part2Correct = part2Answers.filter((a) => a.is_correct).length;
  const part3Correct = part3Answers.filter((a) => a.is_correct).length;
  const part4Correct = part4Answers.filter((a) => a.is_correct).length;

  const questionsPerPart = Math.max(totalQuestions / 4, 1);

  const characterScore = Math.round((part1Correct / Math.max(part1Answers.length, 1)) * 100);
  const vocabScore = Math.round((part2Correct / Math.max(part2Answers.length, 1)) * 100);
  const readingScore = Math.round((part3Correct / Math.max(part3Answers.length, 1)) * 100);
  const comprehensionScore = Math.round((part4Correct / Math.max(part4Answers.length, 1)) * 100);

  return { characterScore, vocabScore, readingScore, comprehensionScore };
}

/**
 * Calculate total weighted score
 */
export function calculateTotalScore(partScores: {
  characterScore: number;
  vocabScore: number;
  readingScore: number;
  comprehensionScore: number;
}): number {
  const total =
    partScores.characterScore * PART_WEIGHTS.character +
    partScores.vocabScore * PART_WEIGHTS.vocabulary +
    partScores.readingScore * PART_WEIGHTS.reading +
    partScores.comprehensionScore * PART_WEIGHTS.comprehension;

  return Math.round(total);
}

/**
 * Calculate stable character count
 * Based on the accuracy rate and the level's total character count
 * Also factors in reaction time as a confidence indicator
 */
export function calculateStableCharCount(
  totalScore: number,
  level: Level,
  answers: TestAnswer[]
): number {
  const config = LEVEL_CONFIG[level];
  
  // Base calculation: score percentage * total chars in level
  const baseRate = totalScore / 100;
  
  // Factor in reaction time confidence
  // If average reaction time is fast (< 3s), add confidence bonus
  // If slow (> 8s), reduce confidence
  const part1Answers = answers.filter((a) => a.part === 1 && a.is_correct);
  const avgReactionTime = part1Answers.length > 0
    ? part1Answers.reduce((sum, a) => sum + (a.reaction_time_ms || 3000), 0) / part1Answers.length
    : 3000;
  
  let confidenceBonus = 0;
  if (avgReactionTime < 2000) {
    confidenceBonus = 0.05; // Fast and confident
  } else if (avgReactionTime < 4000) {
    confidenceBonus = 0.02;
  } else if (avgReactionTime > 8000) {
    confidenceBonus = -0.05; // Hesitant
  }
  
  const stableRate = Math.min(Math.max(baseRate + confidenceBonus, 0), 1);
  const stableCharCount = Math.round(stableRate * config.charCount);
  
  return stableCharCount;
}

/**
 * Calculate stable vocabulary count
 * Typically vocabulary is ~2.86x character count for Chinese
 */
export function calculateStableVocabCount(stableCharCount: number, level: Level): number {
  const config = LEVEL_CONFIG[level];
  return Math.round(stableCharCount * config.vocabMultiplier);
}

/**
 * Determine reading ability level (star rating)
 */
export function getReadingStars(totalScore: number): number {
  if (totalScore >= 90) return 5;
  if (totalScore >= 75) return 4;
  if (totalScore >= 60) return 3;
  if (totalScore >= 40) return 2;
  return 1;
}

/**
 * Get strength area
 */
export function getStrength(partScores: {
  characterScore: number;
  vocabScore: number;
  readingScore: number;
  comprehensionScore: number;
}): string {
  const scores = [
    { name: '识字能力', score: partScores.characterScore },
    { name: '词汇能力', score: partScores.vocabScore },
    { name: '阅读能力', score: partScores.readingScore },
    { name: '理解能力', score: partScores.comprehensionScore },
  ];
  scores.sort((a, b) => b.score - a.score);
  return scores[0].name;
}

// ==========================================
// 智能词组抽测算法 (Word Adaptive Testing)
// ==========================================

/** 抽测原因类型 */
export type SampleReason =
  | 'recent_char_error'    // 最近单字错误
  | 'history_word_error'   // 历史词组错误
  | 'low_mastery'          // 掌握度低
  | 'random_check'         // 随机抽测（验证遗忘）
  | 'forget_check';        // 遗忘验证（>90天）

/** 抽词结果项 */
export interface SampledWord {
  word: string;
  wordId?: string;
  srcLevel: Level;
  reason: SampleReason;
  characters: string[];
  length: number;
}

/** 抽词输入：孩子的掌握数据 */
export interface ChildMasteryData {
  /** 认识的字 */
  recognizedChars: string[];
  /** 不认识的字（最近一次测试） */
  unknownChars: string[];
  /** 各字掌握度 0~1 */
  charMastery: Record<string, number>;
  /** 各词掌握度 0~1 */
  wordMastery: Record<string, number>;
  /** 历史错误过的词组 */
  wrongWordHistory: string[];
  /** 各词最近测试时间戳(ms) */
  wordLastTested: Record<string, number>;
  /** 各字最近测试时间戳(ms) */
  charLastTested: Record<string, number>;
}

/**
 * 智能词组抽测
 *
 * 算法说明：
 * 1. 第一优先（40%）：最近单字错误 → 对应词组
 * 2. 第二优先（30%）：历史词组错误
 * 3. 第三优先（20%）：掌握度 < 80% 的词
 * 4. 第四优先（10%）：随机高掌握词（验证遗忘）
 *
 * 附加规则：
 * - 遗忘机制：>90天未测的词自动提高概率
 * - 去重：不连续抽同一个字的不同词，覆盖更多汉字
 * - 难度分布：双字词80%，三字词15%，四字词5%
 */
export function adaptiveWordSampling(
  wordPool: string[],          // 该等级完整词组库
  charPool: string[],          // 该等级字库
  mastery: ChildMasteryData,
  sampleRatio: number = 0.1    // 抽测比例，默认10%
): SampledWord[] {
  const totalCount = Math.max(Math.round(wordPool.length * sampleRatio), 5);

  // 计算每个词的基础信息
  const wordInfos = wordPool.map((word) => ({
    word,
    chars: Array.from(word),
    length: word.length,
  }));

  // ====== 分层：按原因分类候选词 ======

  const now = Date.now();
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

  // 第一层：最近单字错误对应的词组（40%）
  const tier1 = wordInfos
    .filter((w) => w.chars.some((c) => mastery.unknownChars.includes(c)))
    .sort((a, b) => {
      // 包含更多不认识的字的词优先
      const aUnknown = a.chars.filter((c) => mastery.unknownChars.includes(c)).length;
      const bUnknown = b.chars.filter((c) => mastery.unknownChars.includes(c)).length;
      return bUnknown - aUnknown;
    })
    .map((w) => ({ ...w, reason: 'recent_char_error' as SampleReason }));

  // 第二层：历史词组错误（30%）
  const tier2 = wordInfos
    .filter((w) => mastery.wrongWordHistory.includes(w.word))
    .filter((w) => !tier1.some((t) => t.word === w.word))
    .map((w) => ({ ...w, reason: 'history_word_error' as SampleReason }));

  // 第三层：掌握度低于80%的词（20%）
  const tier3 = wordInfos
    .filter((w) => {
      const m = mastery.wordMastery[w.word];
      return m !== undefined && m < 0.8;
    })
    .filter((w) => !tier1.some((t) => t.word === w.word))
    .filter((w) => !tier2.some((t) => t.word === w.word))
    .sort((a, b) => {
      const ma = mastery.wordMastery[a.word] ?? 1;
      const mb = mastery.wordMastery[b.word] ?? 1;
      return ma - mb;
    })
    .map((w) => ({ ...w, reason: 'low_mastery' as SampleReason }));

  // 第四层：随机高掌握词（10%）—— 验证遗忘
  const tier4 = wordInfos
    .filter((w) => {
      const m = mastery.wordMastery[w.word];
      return m === undefined || m >= 0.9;
    })
    .filter((w) => !tier1.some((t) => t.word === w.word))
    .filter((w) => !tier2.some((t) => t.word === w.word))
    .filter((w) => !tier3.some((t) => t.word === w.word))
    .map((w) => {
      // 遗忘机制：>90天没测的优先
      const last = mastery.wordLastTested[w.word];
      const forgotten = last && now - last > NINETY_DAYS;
      return { ...w, reason: (forgotten ? 'forget_check' : 'random_check') as SampleReason, forgotten };
    })
    .sort((a, b) => {
      // 遗忘的优先
      if (a.forgotten && !b.forgotten) return -1;
      if (!a.forgotten && b.forgotten) return 1;
      return Math.random() - 0.5;
    });

  // ====== 按比例分配名额 ======
  const tier1Count = Math.round(totalCount * 0.4);
  const tier2Count = Math.round(totalCount * 0.3);
  const tier3Count = Math.round(totalCount * 0.2);
  const tier4Count = totalCount - tier1Count - tier2Count - tier3Count;

  const result: SampledWord[] = [];
  const usedChars = new Set<string>();

  // 按难度分布目标：双字词80%，三字词15%，四字词5%
  const biTarget = Math.round(totalCount * 0.8);
  const triTarget = Math.round(totalCount * 0.15);
  const quadTarget = totalCount - biTarget - triTarget;

  let biCount = 0;
  let triCount = 0;
  let quadCount = 0;

  // 从各层抽词，优先选未覆盖字的词，并控制难度分布
  function pickFromTier(tier: typeof tier1, count: number) {
    let picked = 0;
    // 先按"字覆盖率优先"排序：包含更多未使用字的排前面
    const sorted = [...tier].sort((a, b) => {
      const aNew = a.chars.filter((c) => !usedChars.has(c)).length;
      const bNew = b.chars.filter((c) => !usedChars.has(c)).length;
      return bNew - aNew;
    });

    for (const item of sorted) {
      if (picked >= count) break;

      // 难度分布控制
      if (item.length === 2 && biCount >= biTarget) continue;
      if (item.length === 3 && triCount >= triTarget) continue;
      if (item.length === 4 && quadCount >= quadTarget) continue;

      // 去重：避免连续抽同一个字的不同词
      const hasOverlap = item.chars.some((c) => usedChars.has(c));
      // 允许有部分重叠，但优先选新字的
      if (hasOverlap && picked < count - (tier.length - sorted.indexOf(item))) {
        // 还有得选，先跳过
        continue;
      }

      result.push({
        word: item.word,
        srcLevel: 'SRC100' as Level, // 实际level在使用时填充
        reason: item.reason,
        characters: item.chars,
        length: item.length,
      });
      item.chars.forEach((c) => usedChars.add(c));

      if (item.length === 2) biCount++;
      else if (item.length === 3) triCount++;
      else quadCount++;

      picked++;
    }
    return picked;
  }

  pickFromTier(tier1, tier1Count);
  pickFromTier(tier2, tier2Count);
  pickFromTier(tier3, tier3Count);
  pickFromTier(tier4, tier4Count);

  // 如果数量不够（有些层为空），从第四层补齐
  if (result.length < totalCount) {
    const remain = totalCount - result.length;
    const remainingWords = wordInfos.filter(
      (w) => !result.some((r) => r.word === w.word)
    );
    // 随机选，控制难度分布
    const shuffled = [...remainingWords].sort(() => Math.random() - 0.5);
    for (const item of shuffled) {
      if (result.length >= totalCount) break;
      if (item.length === 2 && biCount >= biTarget + 5) continue;
      if (item.length === 3 && triCount >= triTarget + 3) continue;
      if (item.length === 4 && quadCount >= quadTarget + 2) continue;
      result.push({
        word: item.word,
        srcLevel: 'SRC100' as Level,
        reason: 'random_check',
        characters: item.chars,
        length: item.length,
      });
      if (item.length === 2) biCount++;
      else if (item.length === 3) triCount++;
      else quadCount++;
    }
  }

  // 最后打乱顺序，不要按优先级排
  return result.sort(() => Math.random() - 0.5);
}

/**
 * 获取空掌握数据（首次测试时用，所有字都是未测状态）
 */
export function getEmptyMastery(): ChildMasteryData {
  return {
    recognizedChars: [],
    unknownChars: [],
    charMastery: {},
    wordMastery: {},
    wrongWordHistory: [],
    wordLastTested: {},
    charLastTested: {},
  };
}

/**
 * 从逐字测试结果计算初始掌握数据
 */
export function masteryFromCharTest(
  charResults: CharTestResult[],
  prevMastery?: ChildMasteryData
): ChildMasteryData {
  const base = prevMastery ?? getEmptyMastery();
  const now = Date.now();

  const recognized = charResults.filter((r) => r.recognized).map((r) => r.character);
  const unknown = charResults.filter((r) => !r.recognized).map((r) => r.character);

  const newMastery = { ...base.charMastery };
  const newLastTested = { ...base.charLastTested };

  for (const r of charResults) {
    newMastery[r.character] = r.recognized ? 0.9 : 0.1;
    newLastTested[r.character] = now;
  }

  return {
    ...base,
    recognizedChars: [...new Set([...base.recognizedChars, ...recognized])],
    unknownChars: unknown,
    charMastery: newMastery,
    charLastTested: newLastTested,
  };
}

/**
 * Get area to improve
 */
export function getWeakness(partScores: {
  characterScore: number;
  vocabScore: number;
  readingScore: number;
  comprehensionScore: number;
}): string {
  const scores = [
    { name: '识字', score: partScores.characterScore },
    { name: '词汇', score: partScores.vocabScore },
    { name: '阅读', score: partScores.readingScore },
    { name: '理解', score: partScores.comprehensionScore },
  ];
  scores.sort((a, b) => a.score - b.score);
  return scores[0].name;
}

/**
 * Get recommended learning direction
 */
export function getRecommendation(level: Level, totalScore: number): string {
  const levels: Level[] = ['SRC300', 'SRC500', 'SRC800'];
  const currentIdx = levels.indexOf(level);
  
  if (totalScore >= 80 && currentIdx < levels.length - 1) {
    return `准备进入${levels[currentIdx + 1]}，继续挑战更高难度`;
  } else if (totalScore >= 60) {
    return `继续巩固${level}内容，向更高水平迈进`;
  } else {
    return `建议继续学习${level}内容，打牢基础`;
  }
}

/**
 * Get XP for completing a question correctly
 */
export function getXP(part: number, isCorrect: boolean): number {
  if (!isCorrect) return 5; // Participation XP
  switch (part) {
    case 1: return 15;
    case 2: return 20;
    case 3: return 25;
    case 4: return 30;
    default: return 10;
  }
}

/**
 * Get stars earned for a part completion
 */
export function getStarsForPart(correctCount: number, totalCount: number): number {
  const rate = correctCount / Math.max(totalCount, 1);
  if (rate >= 0.9) return 3;
  if (rate >= 0.7) return 2;
  if (rate >= 0.5) return 1;
  return 0;
}

/**
 * Get badge name for part completion
 */
export function getBadgeForPart(part: number, stars: number): string | null {
  if (stars < 1) return null;
  const badgeNames: Record<number, string[]> = {
    1: ['识字入门', '识字达人', '识字大师'],
    2: ['词汇新手', '词汇能手', '词汇高手'],
    3: ['阅读起步', '阅读之星', '阅读达人'],
    4: ['理解新秀', '理解之星', '理解大师'],
  };
  return badgeNames[part]?.[stars - 1] || null;
}

/**
 * 生成高质量的词汇识别干扰项
 * 原则：
 * 1. 优先选同一个字组成的不同词（如同字不同词）
 * 2. 其次选同类型/同词性的词（如都是名词、都是颜色）
 * 3. 最后用同频率等级的随机词补充
 * 4. 绝对保证：干扰项 ≠ 正确答案
 */
export function generateWordDistractors(
  correctWord: string,
  wordPool: string[],  // 该等级所有可用词汇
  count: number = 3,
): string[] {
  if (wordPool.length <= 1) return [];

  const correctChars = new Set(Array.from(correctWord));
  const correctLen = correctWord.length;
  const distractors: string[] = [];
  const used = new Set<string>([correctWord]);

  // 第一层：同一个字开头的词（同字组词，最理想的干扰项）
  const firstChar = correctWord[0];
  const sameStart = wordPool.filter(
    (w) =>
      w.length === correctLen &&
      w.startsWith(firstChar) &&
      w !== correctWord &&
      !used.has(w),
  );
  shuffleArray(sameStart);
  for (const w of sameStart) {
    if (distractors.length >= count) break;
    distractors.push(w);
    used.add(w);
  }

  // 第二层：同一个字结尾的词
  if (distractors.length < count && correctLen >= 2) {
    const lastChar = correctWord[correctWord.length - 1];
    const sameEnd = wordPool.filter(
      (w) =>
        w.length === correctLen &&
        w.endsWith(lastChar) &&
        w !== correctWord &&
        !used.has(w),
    );
    shuffleArray(sameEnd);
    for (const w of sameEnd) {
      if (distractors.length >= count) break;
      distractors.push(w);
      used.add(w);
    }
  }

  // 第三层：含有任意一个相同字的词（同字不同位）
  if (distractors.length < count) {
    const hasCommonChar = wordPool.filter(
      (w) =>
        w.length === correctLen &&
        Array.from(w).some((c) => correctChars.has(c)) &&
        w !== correctWord &&
        !used.has(w),
    );
    shuffleArray(hasCommonChar);
    for (const w of hasCommonChar) {
      if (distractors.length >= count) break;
      distractors.push(w);
      used.add(w);
    }
  }

  // 第四层：同长度的随机词兜底
  if (distractors.length < count) {
    const sameLen = wordPool.filter(
      (w) => w.length === correctLen && !used.has(w),
    );
    shuffleArray(sameLen);
    for (const w of sameLen) {
      if (distractors.length >= count) break;
      distractors.push(w);
      used.add(w);
    }
  }

  // 最后兜底：任意长度的词
  if (distractors.length < count) {
    const rest = wordPool.filter((w) => !used.has(w));
    shuffleArray(rest);
    for (const w of rest) {
      if (distractors.length >= count) break;
      distractors.push(w);
      used.add(w);
    }
  }

  return distractors.slice(0, count);
}

/** Fisher–Yates 洗牌 */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 生成字形识别的干扰项（从同等级字库中选形似/音近的字）
 */
export function generateCharDistractors(
  correctChar: string,
  charPool: string[],
  count: number = 3,
): string[] {
  if (charPool.length <= 1) return [];
  const others = charPool.filter((c) => c !== correctChar);
  shuffleArray(others);
  return others.slice(0, count);
}
