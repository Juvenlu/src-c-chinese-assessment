/**
 * 快速体验测评 V2.0 - 自适应分级测试核心算法
 *
 * 核心机制：
 * 1. 逐级探测：SRC100 → 300 → 500 → 800
 * 2. 每级验证：6个单字 + 3个词语 = 9题/级
 * 3. 升级/停止/临界三种状态判断
 * 4. 临界状态：追加边界确认题（单字最多30，词语最多15，总题≤45）
 * 5. Confidence Booster：每级升级后混入1道上一级核心题，不计分
 * 6. 双水位测量：Character Level + Word Level 独立计算
 * 7. Reading Base Level ≤ Word Level（短板效应）
 * 8. i+1推荐：阅读基础 + 轻度提升
 * 9. 置信度：高/中/低
 *
 * 设计原则：
 * - 孩子在体验，系统在测量
 * - 前端不显示题目SRC等级
 * - 单字能力不能掩盖词语能力不足
 * - 所有参数后台可配置
 * - 不修改原始SRC字库
 */

import { Level, LEVEL_CONFIG } from './types';
import {
  getAssessmentCharsForLevel,
  getAssessmentWordsForLevel,
} from './questions';

// ============================================================
// 可配置参数（后台可调整）
// ============================================================

/** 自适应测试配置 - 所有阈值与限制均在此集中管理 */
export const ASSESSMENT_CONFIG = {
  /** 每级基础测试：单字数量 */
  questionsPerLevelCharacter: 6,
  /** 每级基础测试：词语数量 */
  questionsPerLevelWord: 3,
  /** 单字最大测试数量（含边界确认） */
  maxCharacterQuestions: 30,
  /** 词语最大测试数量（含边界确认） */
  maxWordQuestions: 15,
  /** 总题量上限（单字+词语） */
  maxTotalQuestions: 45,
  /** 起始测试等级 */
  startLevel: 'SRC100' as Level,
  /** 最高测试等级 */
  maxLevel: 'SRC800' as Level,

  /** 各等级单字通过率阈值 */
  characterPassThreshold: {
    SRC100: 0.80,
    SRC300: 0.80,
    SRC500: 0.75,
    SRC800: 0.75,
  } as Record<Level, number>,

  /** 各等级词语通过率阈值 */
  wordPassThreshold: {
    SRC100: 0.80,
    SRC300: 0.80,
    SRC500: 0.75,
    SRC800: 0.75,
  } as Record<Level, number>,

  /**
   * 临界区间（在阈值 ± 范围内视为临界，需要追加边界确认题）
   * 例如阈值0.80，range=0.15 → 0.65~0.95为临界
   */
  borderlineRange: 0.15,

  /** 每次边界确认追加的单字题数 */
  borderlineAddChars: 3,
  /** 每次边界确认追加的词语题数 */
  borderlineAddWords: 2,

  /** 核心题占比目标（实际可在附近浮动） */
  coreRatioTarget: 0.70,

  /** 是否启用 Confidence Booster */
  enableConfidenceBooster: true,
  /** Confidence Booster 插入位置（每题组第几题后插入） */
  boosterInsertPosition: 2,

  /** i+1 轻度提升规则：按reading base提升比例 */
  iPlus1Ratio: 0.10,
  /** i+1 最小提升字数 */
  iPlus1MinAdd: 30,
  /** i+1 最大提升字数 */
  iPlus1MaxAdd: 80,

  /** 置信度规则 */
  confidence: {
    /** 总题数 ≥ 此值 → 有机会高置信 */
    highMinQuestions: 25,
    /** 总题数 < 此值 → 低置信 */
    lowMaxQuestions: 12,
    /** 是否使用了边界确认 → 中等及以上 */
    borderlineBonus: true,
    /** 单字/词语结果一致性差 → 降一级 */
    consistencyPenalty: true,
  },

  /** 答题异常检测 */
  quality: {
    /** 单题最短响应时间（毫秒），低于此值标记为过快 */
    minResponseTimeMs: 300,
    /** 连续同答案最大次数 */
    maxConsecutiveSameAnswer: 8,
  },
};

// ============================================================
// 类型定义
// ============================================================

/** 题目角色 */
export type QuestionRole =
  | 'scoring'       // 正常计分题
  | 'confidence_booster' // 信心缓冲题（不计分）
  | 'borderline';   // 边界确认题（计分）

/** 测试题型 */
export type AssessmentQuestionType = 'character' | 'word';

/** 单道测试题 */
export interface AssessmentQuestion {
  id: string;
  content: string;
  type: AssessmentQuestionType;
  minimumSrcLevel: Level;
  role: QuestionRole;
  scoring: boolean; // 是否参与能力计算
  sequenceNumber: number;
  tags: string[]; // core / supplement / polyphonic / etc.
}

/** 单道答题记录 */
export interface AnswerRecord {
  questionId: string;
  questionContent: string;
  questionType: AssessmentQuestionType;
  minimumSrcLevel: Level;
  questionRole: QuestionRole;
  userAnswer: boolean; // true=认识, false=不认识
  correct: boolean;    // 对于视觉识字，"认识"的自报型题目，这里等同userAnswer的"自报"
  responseTimeMs: number;
  sequenceNumber: number;
  scoring: boolean;
}

/** 等级测试结果 */
export interface LevelResult {
  level: Level;
  /** 单字：计分题数 */
  charTested: number;
  /** 单字：正确题数 */
  charCorrect: number;
  /** 单字：正确率 */
  charAccuracy: number;
  /** 词语：计分题数 */
  wordTested: number;
  /** 词语：正确题数 */
  wordCorrect: number;
  /** 词语：正确率 */
  wordAccuracy: number;
  /** 是否使用了边界确认题 */
  usedBorderline: boolean;
  /** 等级状态 */
  status: 'clear_pass' | 'clear_fail' | 'borderline_pass' | 'borderline_fail';
}

/** 置信度等级 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** 最终测评结果 */
export interface QuickAssessmentResult {
  /** 单字识别能力水位（等级） */
  characterLevel: Level;
  /** 单字能力区间下限 */
  characterLevelLower: Level;
  /** 单字能力区间上限 */
  characterLevelUpper: Level;
  /** 词语识别能力水位 */
  wordLevel: Level;
  /** 词语能力区间下限 */
  wordLevelLower: Level;
  /** 词语能力区间上限 */
  wordLevelUpper: Level;
  /** 阅读基础等级（≤ wordLevel） */
  readingBaseLevel: Level;
  /** 阅读基础等级描述 */
  readingBaseDesc: string;
  /** 推荐阅读难度等级 */
  recommendedReadingLevel: Level;
  /** 推荐阅读描述（如 "SRC500–550"） */
  recommendedReadingDesc: string;
  /** 置信度 */
  confidence: ConfidenceLevel;
  /** 各等级明细 */
  levelResults: LevelResult[];
  /** 总答题数 */
  totalQuestions: number;
  /** 总单字题数 */
  totalCharQuestions: number;
  /** 总词语题数 */
  totalWordQuestions: number;
  /** 总时长（毫秒） */
  totalTimeMs: number;
  /** 测试质量标记 */
  qualityFlags: string[];
  /** guest session ID（保存到后端后返回） */
  guestSessionId?: string;
}

/** 测试会话状态（供前端步进使用） */
export interface AssessmentSession {
  questions: AssessmentQuestion[];
  currentIndex: number;
  answers: AnswerRecord[];
  startedAt: number;
  completed: boolean;
  result: QuickAssessmentResult | null;
}

// ============================================================
// 工具函数
// ============================================================

/** 所有等级顺序（从低到高） */
const ALL_LEVELS: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];

/** 获取等级在序列中的索引 */
function levelIndex(level: Level): number {
  return ALL_LEVELS.indexOf(level);
}

/** 获取下一个等级 */
function nextLevel(level: Level): Level | null {
  const idx = levelIndex(level);
  return idx >= 0 && idx < ALL_LEVELS.length - 1 ? ALL_LEVELS[idx + 1] : null;
}

/** 取随机n个元素（Fisher-Yates） */
function sample<T>(arr: T[], n: number, exclude: Set<string> = new Set(), keyFn: (x: T) => string = (x) => String(x)): T[] {
  const candidates = arr.filter((x) => !exclude.has(keyFn(x)));
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

/**
 * 打乱数组，同时尽量打散"相似"项（简单策略：同字开头/结尾不连续）
 */
function shuffleWithDiversity<T>(arr: T[], getKey: (x: T) => string): T[] {
  const result = [...arr];
  // Fisher-Yates 基础打乱
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  // 简单相邻去聚集：从前向后，如果i和i-1首字相同，尝试与后面的交换
  for (let i = 1; i < result.length; i++) {
    const prevKey = getKey(result[i - 1]);
    const currKey = getKey(result[i]);
    if (prevKey[0] === currKey[0]) {
      // 向后找一个首字不同的交换
      for (let k = i + 1; k < result.length; k++) {
        if (getKey(result[k])[0] !== prevKey[0]) {
          [result[i], result[k]] = [result[k], result[i]];
          break;
        }
      }
    }
  }
  return result;
}

// ============================================================
// 题目生成 - 为指定等级生成一组基础题 + Confidence Booster
// ============================================================

/**
 * 生成某个等级的基础题组（6单字 + 3词语）
 * Booster：如果prevLevel存在，在第3题位置插入1道上一级核心单字题（不计分）
 */
function generateLevelQuestions(
  level: Level,
  prevLevel: Level | null,
  charCount: number,
  wordCount: number,
  usedCharSet: Set<string>,
  usedWordSet: Set<string>,
  startSeq: number,
): { questions: AssessmentQuestion[]; newUsedChars: Set<string>; newUsedWords: Set<string> } {
  const config = ASSESSMENT_CONFIG;
  const result: AssessmentQuestion[] = [];
  const newUsedChars = new Set(usedCharSet);
  const newUsedWords = new Set(usedWordSet);

  // 取出该等级的核心与补充字
  const coreChars = getAssessmentCharsForLevel(level, 'core');
  const supplementChars = getAssessmentCharsForLevel(level, 'supplemental');
  const coreWords = getAssessmentWordsForLevel(level, 'core');
  const supplementWords = getAssessmentWordsForLevel(level, 'supplemental');

  // 单字：目标 70% 核心 + 30% 补充，按比例随机取
  const coreCharTarget = Math.round(charCount * config.coreRatioTarget);
  const supplementCharTarget = charCount - coreCharTarget;

  const selectedCoreChars = sample(coreChars, coreCharTarget, newUsedChars);
  selectedCoreChars.forEach((c) => newUsedChars.add(c));

  const suppCharsNeeded = supplementCharTarget + (coreCharTarget - selectedCoreChars.length);
  const selectedSuppChars = sample(supplementChars, suppCharsNeeded, newUsedChars);
  selectedSuppChars.forEach((c) => newUsedChars.add(c));

  const allSelectedChars = [...selectedCoreChars, ...selectedSuppChars];
  const charItems = shuffleWithDiversity(allSelectedChars, (c) => c).map((char, idx) => ({
    id: `char-${level}-${idx}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    content: char,
    type: 'character' as AssessmentQuestionType,
    minimumSrcLevel: level,
    role: 'scoring' as QuestionRole,
    scoring: true,
    sequenceNumber: startSeq + idx,
    tags: [coreChars.includes(char) ? 'core' : 'supplement'],
  }));

  // 词语：核心优先，补充补缺
  const selectedCoreWords = sample(coreWords, wordCount, newUsedWords);
  selectedCoreWords.forEach((w) => newUsedWords.add(w));

  let wordsNeeded = wordCount - selectedCoreWords.length;
  const selectedSuppWords = wordsNeeded > 0 ? sample(supplementWords, wordsNeeded, newUsedWords) : [];
  selectedSuppWords.forEach((w) => newUsedWords.add(w));

  const allSelectedWords = [...selectedCoreWords, ...selectedSuppWords];
  const wordItems = shuffleWithDiversity(allSelectedWords, (w) => w).map((word, idx) => ({
    id: `word-${level}-${idx}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    content: word,
    type: 'word' as AssessmentQuestionType,
    minimumSrcLevel: level,
    role: 'scoring' as QuestionRole,
    scoring: true,
    sequenceNumber: startSeq + charItems.length + idx,
    tags: [coreWords.includes(word) ? 'core' : 'supplement'],
  }));

  // 随机交错排列单字和词语题（不让孩子明显感觉"先单字后词语"）
  // 策略：先单字题组，再词语题组，但整体打乱前2题和末2题做轻度混合
  // 为了孩子体验连贯，保持"先单字再词语"的大致顺序，但每3题中插入轻微顺序调整
  const mixed: AssessmentQuestion[] = [];
  const charQ = [...charItems];
  const wordQ = [...wordItems];
  // 简单交错：前半以单字为主，后半以词语为主
  while (charQ.length > 0 || wordQ.length > 0) {
    if (charQ.length > 0 && (wordQ.length === 0 || Math.random() < 0.65)) {
      mixed.push(charQ.shift()!);
    } else if (wordQ.length > 0) {
      mixed.push(wordQ.shift()!);
    }
  }

  // 重新编号
  mixed.forEach((q, idx) => {
    q.sequenceNumber = startSeq + idx;
  });

  // Confidence Booster：在第 boosterInsertPosition 后插入 1 道上一级核心单字题
  if (config.enableConfidenceBooster && prevLevel) {
    const prevCoreChars = getAssessmentCharsForLevel(prevLevel, 'core');
    const booster = sample(prevCoreChars, 1, new Set([...newUsedChars]));
    if (booster.length > 0) {
      const boosterQ: AssessmentQuestion = {
        id: `booster-${prevLevel}-${Date.now().toString(36)}`,
        content: booster[0],
        type: 'character',
        minimumSrcLevel: prevLevel,
        role: 'confidence_booster',
        scoring: false,
        sequenceNumber: config.boosterInsertPosition, // 插入位置
        tags: ['booster', 'core'],
      };
      newUsedChars.add(booster[0]);
      // 将 booster 插入指定位置
      const before = mixed.slice(0, config.boosterInsertPosition);
      const after = mixed.slice(config.boosterInsertPosition);
      mixed.splice(config.boosterInsertPosition, 0, boosterQ);
      // 重新排号
      before.forEach((q, i) => { q.sequenceNumber = startSeq + i; });
      boosterQ.sequenceNumber = startSeq + config.boosterInsertPosition;
      after.forEach((q, i) => { q.sequenceNumber = startSeq + config.boosterInsertPosition + 1 + i; });
      // 为简化：直接整体重编号
      mixed.forEach((q, idx) => { q.sequenceNumber = startSeq + idx; });
      result.push(...mixed);
    } else {
      result.push(...mixed);
    }
  } else {
    result.push(...mixed);
  }

  return { questions: result, newUsedChars, newUsedWords };
}

// ============================================================
// 等级状态判断
// ============================================================

/** 判断一个等级的测试结果属于哪种状态 */
function judgeLevelStatus(
  level: Level,
  charCorrect: number,
  charTested: number,
  wordCorrect: number,
  wordTested: number,
): {
  status: 'clear_pass' | 'clear_fail' | 'borderline';
  charAccuracy: number;
  wordAccuracy: number;
  charPassed: boolean;
  wordPassed: boolean;
} {
  const config = ASSESSMENT_CONFIG;
  const charAcc = charTested > 0 ? charCorrect / charTested : 0;
  const wordAcc = wordTested > 0 ? wordCorrect / wordTested : 0;
  const charThresh = config.characterPassThreshold[level];
  const wordThresh = config.wordPassThreshold[level];
  const range = config.borderlineRange;

  const charPassed = charAcc >= charThresh;
  const wordPassed = wordAcc >= wordThresh;

  // 判断是否在临界区间内（任一项处于阈值±range）
  const charBorderline = Math.abs(charAcc - charThresh) <= range;
  const wordBorderline = Math.abs(wordAcc - wordThresh) <= range;

  // 两项都明显通过 → clear_pass
  if (charAcc > charThresh + range && wordAcc > wordThresh + range) {
    return { status: 'clear_pass', charAccuracy: charAcc, wordAccuracy: wordAcc, charPassed, wordPassed };
  }
  // 两项都明显未通过 → clear_fail
  if (charAcc < charThresh - range && wordAcc < wordThresh - range) {
    return { status: 'clear_fail', charAccuracy: charAcc, wordAccuracy: wordAcc, charPassed, wordPassed };
  }
  // 其它情况 → 临界
  return { status: 'borderline', charAccuracy: charAcc, wordAccuracy: wordAcc, charPassed, wordPassed };
}

// ============================================================
// 自适应测试生成（一次性生成完整流程）
// ============================================================

/**
 * 生成一次完整的自适应测试题单
 *
 * 说明：由于"直接测试"是自报型（认识/不认识），
 * 自适应逻辑理论上应根据答题结果动态调整。
 * 但为了前端实现简单、体验流畅，我们采用"预生成 + 提前终止"策略：
 * - 预生成全部四级的基础题
 * - 前端按顺序推进，到某级明显失败时提前结束
 * - 边界确认题在判定临界时再追加
 *
 * 这个函数负责生成"基础题单"（不含边界确认题）
 */
export function generateAdaptiveAssessment(): {
  questions: AssessmentQuestion[];
  levelRanges: Record<Level, { start: number; end: number }>; // 每级在questions数组中的索引范围
} {
  const config = ASSESSMENT_CONFIG;
  const levels: Level[] = [];
  let cur: Level | null = config.startLevel;
  while (cur && levelIndex(cur) <= levelIndex(config.maxLevel)) {
    levels.push(cur);
    cur = nextLevel(cur);
  }

  const allQuestions: AssessmentQuestion[] = [];
  const levelRanges: Record<string, { start: number; end: number }> = {};
  let usedChars = new Set<string>();
  let usedWords = new Set<string>();
  let seq = 0;

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const prev = i > 0 ? levels[i - 1] : null;
    const { questions, newUsedChars, newUsedWords } = generateLevelQuestions(
      level,
      prev,
      config.questionsPerLevelCharacter,
      config.questionsPerLevelWord,
      usedChars,
      usedWords,
      seq,
    );

    levelRanges[level] = { start: seq, end: seq + questions.length };
    allQuestions.push(...questions);
    usedChars = newUsedChars;
    usedWords = newUsedWords;
    seq += questions.length;
  }

  return { questions: allQuestions, levelRanges };
}

// ============================================================
// 结果计算
// ============================================================

/**
 * 根据答题记录计算各等级结果 + 双水位 + Reading Base + 置信度
 */
export function calculateQuickResult(
  answers: AnswerRecord[],
  totalTimeMs: number,
): QuickAssessmentResult {
  const config = ASSESSMENT_CONFIG;

  // 按等级 + 类型汇总（仅计分题参与能力计算）
  const scoringAnswers = answers.filter((a) => a.scoring);
  const levelMap = new Map<Level, {
    charCorrect: number; charTested: number;
    wordCorrect: number; wordTested: number;
    usedBorderline: boolean;
  }>();

  for (const ans of scoringAnswers) {
    const lv = ans.minimumSrcLevel;
    if (!levelMap.has(lv)) {
      levelMap.set(lv, { charCorrect: 0, charTested: 0, wordCorrect: 0, wordTested: 0, usedBorderline: false });
    }
    const rec = levelMap.get(lv)!;
    if (ans.questionType === 'character') {
      rec.charTested++;
      if (ans.userAnswer) rec.charCorrect++;
    } else {
      rec.wordTested++;
      if (ans.userAnswer) rec.wordCorrect++;
    }
    if (ans.questionRole === 'borderline') {
      rec.usedBorderline = true;
    }
  }

  // 构建各等级结果
  const levelResults: LevelResult[] = [];
  for (const lv of ALL_LEVELS) {
    const rec = levelMap.get(lv);
    if (!rec || (rec.charTested === 0 && rec.wordTested === 0)) continue;

    const charAcc = rec.charTested > 0 ? rec.charCorrect / rec.charTested : 0;
    const wordAcc = rec.wordTested > 0 ? rec.wordCorrect / rec.wordTested : 0;
    const judge = judgeLevelStatus(lv, rec.charCorrect, rec.charTested, rec.wordCorrect, rec.wordTested);

    levelResults.push({
      level: lv,
      charTested: rec.charTested,
      charCorrect: rec.charCorrect,
      charAccuracy: charAcc,
      wordTested: rec.wordTested,
      wordCorrect: rec.wordCorrect,
      wordAccuracy: wordAcc,
      usedBorderline: rec.usedBorderline,
      status: judge.status === 'borderline'
        ? (judge.charPassed && judge.wordPassed ? 'borderline_pass' : 'borderline_fail')
        : judge.status,
    });
  }

  // ---- 计算 Character Level ----
  // 从高到低找第一个"通过（含临界通过）"的等级作为能力上界；下界为其下一级
  const charLevel = findAbilityLevel(levelResults, 'char');

  // ---- 计算 Word Level ----
  const wordLevel = findAbilityLevel(levelResults, 'word');

  // ---- Reading Base Level：取较低者（且 ≤ wordLevel）----
  const readingBase = lowerOf(charLevel.estimated, wordLevel.estimated);

  // ---- 推荐阅读等级：轻度 i+1 ----
  const recommended = calcIPlus1Reading(readingBase);

  // ---- 置信度 ----
  const confidence = calcConfidence(
    answers,
    levelResults,
    charLevel,
    wordLevel,
    totalTimeMs,
  );

  const totalCharQ = answers.filter((a) => a.questionType === 'character').length;
  const totalWordQ = answers.filter((a) => a.questionType === 'word').length;

  // 质量检测
  const qualityFlags = detectQualityIssues(answers, totalTimeMs);

  return {
    characterLevel: charLevel.estimated,
    characterLevelLower: charLevel.lower,
    characterLevelUpper: charLevel.upper,
    wordLevel: wordLevel.estimated,
    wordLevelLower: wordLevel.lower,
    wordLevelUpper: wordLevel.upper,
    readingBaseLevel: readingBase,
    readingBaseDesc: getReadingBaseDesc(readingBase),
    recommendedReadingLevel: recommended.level,
    recommendedReadingDesc: recommended.desc,
    confidence,
    levelResults,
    totalQuestions: answers.length,
    totalCharQuestions: totalCharQ,
    totalWordQuestions: totalWordQ,
    totalTimeMs,
    qualityFlags,
  };
}

/** 单/词能力水位计算结果 */
interface AbilityLevel {
  estimated: Level;
  lower: Level;
  upper: Level;
}

/** 从等级结果中找出能力水位（char 或 word） */
function findAbilityLevel(levelResults: LevelResult[], type: 'char' | 'word'): AbilityLevel {
  // 从高到低遍历，找第一个"通过"的等级
  const passed: Level[] = [];
  const failed: Level[] = [];

  for (const lr of levelResults) {
    const acc = type === 'char' ? lr.charAccuracy : lr.wordAccuracy;
    const tested = type === 'char' ? lr.charTested : lr.wordTested;
    if (tested === 0) continue;
    const threshKey = type === 'char'
      ? ASSESSMENT_CONFIG.characterPassThreshold[lr.level]
      : ASSESSMENT_CONFIG.wordPassThreshold[lr.level];

    if (acc >= threshKey) {
      passed.push(lr.level);
    } else {
      failed.push(lr.level);
    }
  }

  // 找到最高通过等级
  let highestPass: Level | null = null;
  for (let i = ALL_LEVELS.length - 1; i >= 0; i--) {
    if (passed.includes(ALL_LEVELS[i])) {
      highestPass = ALL_LEVELS[i];
      break;
    }
  }

  // 找到最低失败等级
  let lowestFail: Level | null = null;
  for (let i = 0; i < ALL_LEVELS.length; i++) {
    if (failed.includes(ALL_LEVELS[i])) {
      lowestFail = ALL_LEVELS[i];
      break;
    }
  }

  // 估算
  if (highestPass && lowestFail && levelIndex(highestPass) < levelIndex(lowestFail)) {
    // 有上界有下界 → 区间
    return {
      estimated: highestPass,
      lower: highestPass,
      upper: lowestFail,
    };
  }
  if (highestPass) {
    // 全部通过 → 最高等级作为下界
    return {
      estimated: highestPass,
      lower: highestPass,
      upper: highestPass,
    };
  }
  if (lowestFail) {
    // 全部失败 → 最低级
    return {
      estimated: ALL_LEVELS[0],
      lower: ALL_LEVELS[0],
      upper: ALL_LEVELS[0],
    };
  }
  return { estimated: 'SRC100', lower: 'SRC100', upper: 'SRC100' };
}

/** 取两个等级中较低者 */
function lowerOf(a: Level, b: Level): Level {
  return levelIndex(a) <= levelIndex(b) ? a : b;
}

/** i+1 阅读推荐 */
function calcIPlus1Reading(base: Level): { level: Level; desc: string } {
  const config = ASSESSMENT_CONFIG;
  const baseCount = LEVEL_CONFIG[base].charCount;
  const add = Math.max(
    config.iPlus1MinAdd,
    Math.min(config.iPlus1MaxAdd, Math.round(baseCount * config.iPlus1Ratio)),
  );
  const recCount = baseCount + add;

  // 找到这个估算量落在哪个等级范围
  let recLevel: Level = base;
  for (const lv of ALL_LEVELS) {
    if (recCount >= LEVEL_CONFIG[lv].charCount) {
      recLevel = lv;
    }
  }

  const desc = `${base.replace('SRC', '')}–${Math.min(
    LEVEL_CONFIG[recLevel].charCount,
    recCount,
  )}`;

  return { level: recLevel, desc: `SRC${desc} 左右` };
}

/** 阅读基础描述文字 */
function getReadingBaseDesc(level: Level): string {
  switch (level) {
    case 'SRC100': return '起步中文基础';
    case 'SRC300': return '基础阅读';
    case 'SRC500': return '初步阅读基础';
    case 'SRC800': return '进阶阅读基础';
    default: return '基础阅读';
  }
}

/** 置信度计算 */
function calcConfidence(
  answers: AnswerRecord[],
  levelResults: LevelResult[],
  charLevel: AbilityLevel,
  wordLevel: AbilityLevel,
  totalTimeMs: number,
): ConfidenceLevel {
  const config = ASSESSMENT_CONFIG.confidence;
  const scoringCount = answers.filter((a) => a.scoring).length;
  const usedBorderline = levelResults.some((lr) => lr.usedBorderline);

  // 题量太少 → 低
  if (scoringCount < config.lowMaxQuestions) return 'low';

  // 单字和词语差距超过两级 → 降为低（一致性差）
  const levelGap = Math.abs(levelIndex(charLevel.estimated) - levelIndex(wordLevel.estimated));
  if (config.consistencyPenalty && levelGap >= 2) return 'low';

  // 题量够 + 有边界确认 + 一致性好 → 高
  if (scoringCount >= config.highMinQuestions
    && usedBorderline
    && levelGap <= 1) {
    return 'high';
  }

  // 其它 → 中
  return 'medium';
}

/** 答题质量检测 */
function detectQualityIssues(answers: AnswerRecord[], totalTimeMs: number): string[] {
  const flags: string[] = [];
  const config = ASSESSMENT_CONFIG.quality;
  const avgTime = answers.length > 0 ? totalTimeMs / answers.length : 0;

  // 平均每题过快
  if (avgTime < config.minResponseTimeMs && answers.length >= 5) {
    flags.push('too_fast');
  }

  // 连续同答案
  let maxStreak = 0;
  let streak = 0;
  let last: boolean | null = null;
  for (const a of answers) {
    if (last === a.userAnswer) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 1;
      last = a.userAnswer;
    }
  }
  if (maxStreak >= config.maxConsecutiveSameAnswer) {
    flags.push('consecutive_same_answer');
  }

  return flags;
}

// ============================================================
// 学习建议（供结果页使用）
// ============================================================

export function generateLearningRecommendation(result: QuickAssessmentResult): string[] {
  const base = result.readingBaseLevel;
  const wordLower = result.wordLevel;
  const charHigher = result.characterLevel;

  const tips: string[] = [];

  // 词语是短板
  if (levelIndex(wordLower) < levelIndex(charHigher)) {
    tips.push('词语识别是当前阅读提升的关键，建议通过分级绘本在语境中积累常用词语。');
  }

  switch (base) {
    case 'SRC100':
      tips.push('从最常见的生活场景汉字开始，结合图片和简单故事建立识字兴趣。');
      tips.push('每天认识3-5个新字，在亲子共读中反复出现，孩子更容易记住。');
      break;
    case 'SRC300':
      tips.push('已经具备基础识字量，可以开始尝试简单的分级绘本和短句故事。');
      tips.push('重点扩展常用两字词，让孩子在语境中理解字义和词意。');
      break;
    case 'SRC500':
      tips.push('阅读基础初步形成，可以读懂大部分低幼儿童绘本和简单中文故事。');
      tips.push('下一步可以增加四字词和简单句式的练习，逐步提升理解深度。');
      break;
    case 'SRC800':
      tips.push('已经具备较好的阅读基础，可以独立阅读大多数儿童中文读物。');
      tips.push('建议开始接触更丰富的文体（科普、童话、历史），在阅读中持续扩大词汇量。');
      break;
  }

  return tips;
}

// ============================================================
// 向后端兼容：保留 generateQuickAssessment 函数名（旧接口）
// ============================================================

/**
 * 生成快速测试题（旧函数名保留，内部调用新版）
 * @deprecated 请使用 generateAdaptiveAssessment
 */
export function generateQuickAssessment() {
  const { questions } = generateAdaptiveAssessment();
  return questions;
}

/**
 * 估算SRC等级（旧函数名保留，内部调用新版）
 * @deprecated 请使用 calculateQuickResult
 */
export function estimateSRCLevel(
  charAnswers: Record<string, boolean>,
  wordAnswers: Record<string, boolean>,
) {
  // 简化适配：构造 AnswerRecord 数组
  const answers: AnswerRecord[] = [];
  let seq = 0;
  for (const [char, correct] of Object.entries(charAnswers)) {
    // 粗略猜测等级（按字在哪级新增）
    let lv: Level = 'SRC100';
    for (const l of ALL_LEVELS) {
      const chars = [...getAssessmentCharsForLevel(l, 'core'), ...getAssessmentCharsForLevel(l, 'supplemental')];
      // 这里只做近似
      if (chars.includes(char)) { lv = l; break; }
    }
    answers.push({
      questionId: `char-${seq}`,
      questionContent: char,
      questionType: 'character',
      minimumSrcLevel: lv,
      questionRole: 'scoring',
      userAnswer: correct,
      correct,
      responseTimeMs: 1500,
      sequenceNumber: seq++,
      scoring: true,
    });
  }
  const result = calculateQuickResult(answers, 120000);
  return result.readingBaseLevel;
}
