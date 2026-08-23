/**
 * 词组分层抽样算法 (Vocabulary Stratified Sampling)
 *
 * 核心原则：
 * - 不是简单随机抽样，而是分层 + 单字验证 + 历史联动
 * - 第一次测试建立基础画像，第二次扩大覆盖+复查，长期追踪稳定性
 * - 单字全面检测 × 词组代表性抽测 × 历史动态复测 = 可靠词汇掌握画像
 */

import { Level, LEVEL_CONFIG } from './types';

// ==================== 类型定义 ====================

export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'other';

export type VocabularyMasteryStatus =
  | 'untested'       // 未测试
  | 'first_test'     // 初次测试
  | 'learning'       // 掌握中（答对但数据不足）
  | 'basic_mastery'  // 基本掌握（正确率达标）
  | 'stable_mastery' // 稳定掌握（连续多次正确）
  | 'needs_review';  // 待复习（曾掌握但遗忘）

export interface VocabularyItem {
  vocab_id: string;
  vocabulary: string;
  characters: string[];     // 组成汉字
  src_level: Level;
  frequency_rank: number;   // 1-10，越高越常用
  reading_frequency: number; // 儿童阅读常见度 1-10
  difficulty: number;       // 难度 1-5
  part_of_speech: PartOfSpeech;
  is_core_vocabulary: boolean;
  is_child_reading_common: boolean;
}

export interface VocabularyTestRecord {
  vocabulary_id: string;
  is_correct: boolean;
  response_time_ms: number;
  tested_at: number;        // timestamp
}

export interface VocabularyMastery {
  vocabulary_id: string;
  total_attempts: number;
  correct_attempts: number;
  accuracy: number;
  last_result: boolean | null;
  last_tested_at: number | null;
  consecutive_correct: number;
  consecutive_wrong: number;
  mastery_status: VocabularyMasteryStatus;
}

export interface SampledVocabulary {
  vocab_id: string;
  vocabulary: string;
  characters: string[];
  pool: 'core' | 'validation' | 'coverage'; // 抽取来源池
  selection_reason: string;  // 抽测原因
  selection_score: number;   // 综合评分
  difficulty: number;
  part_of_speech: PartOfSpeech;
}

export interface CharacterResult {
  character: string;
  is_correct: boolean;
  reaction_time_ms: number;
}

export interface SamplingConfig {
  // 第一次测试三池比例
  firstTestCorePoolRatio: number;      // Pool A 核心高价值
  firstTestValidationPoolRatio: number; // Pool B 单字验证
  firstTestCoveragePoolRatio: number;   // Pool C 结构覆盖补充

  // 后续测试三池比例
  retestReviewPoolRatio: number;        // 未掌握/不稳定
  retestNewPoolRatio: number;           // 未测试新词组
  retestRetentionPoolRatio: number;     // 稳定性复测

  // 单字浓度控制
  maxWordsPerCharacter: number;         // 同字最多相关词组数

  // 验证池中错字词组比例上限
  validationWrongCharMaxRatio: number;  // 含错字词组最大比例

  // 难度梯度
  easyStartRatio: number;               // 前20%简单
  hardEndRatio: number;                 // 后20%有挑战

  // 综合评分权重
  weightReadingFreq: number;
  weightCoreVocab: number;
  weightValidationValue: number;
  weightRepresentativeness: number;
  weightDifficultyBalance: number;
  weightPartOfSpeech: number;
  weightHistoryPriority: number;

  // 掌握阈值
  thresholdBasicMasteryAccuracy: number;   // 基本掌握正确率
  thresholdBasicMasteryAttempts: number;   // 基本掌握最少测试次数
  thresholdStableMasteryConsecutive: number; // 稳定掌握连续正确次数
  thresholdNeedsReviewDays: number;         // 待复习天数
}

export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  firstTestCorePoolRatio: 0.40,
  firstTestValidationPoolRatio: 0.40,
  firstTestCoveragePoolRatio: 0.20,

  retestReviewPoolRatio: 0.45,
  retestNewPoolRatio: 0.45,
  retestRetentionPoolRatio: 0.10,

  maxWordsPerCharacter: 3,
  validationWrongCharMaxRatio: 0.25,
  easyStartRatio: 0.20,
  hardEndRatio: 0.20,

  weightReadingFreq: 0.25,
  weightCoreVocab: 0.15,
  weightValidationValue: 0.20,
  weightRepresentativeness: 0.15,
  weightDifficultyBalance: 0.10,
  weightPartOfSpeech: 0.05,
  weightHistoryPriority: 0.10,

  thresholdBasicMasteryAccuracy: 0.70,
  thresholdBasicMasteryAttempts: 2,
  thresholdStableMasteryConsecutive: 3,
  thresholdNeedsReviewDays: 60,
};

// ==================== 词性判断 ====================

const NOUN_SUFFIXES = ['师', '生', '子', '头', '家', '天', '山', '水', '花', '鸟', '人', '书', '学', '学', '饭', '衣', '车', '路', '门', '房'];
const VERB_SUFFIXES = ['学', '看', '说', '听', '吃', '走', '跑', '跳', '唱', '写', '读', '做', '打', '开', '关', '来', '去', '起', '上', '下'];
const ADJ_SUFFIXES = ['好', '大', '小', '高', '低', '长', '短', '新', '旧', '红', '白', '快', '慢', '多', '少', '美', '亮', '开心', '高兴', '快乐'];

function guessPartOfSpeech(word: string): PartOfSpeech {
  if (word.length >= 2 && ADJ_SUFFIXES.some(s => word.endsWith(s) || word.startsWith(s))) return 'adjective';
  if (word.length >= 2 && VERB_SUFFIXES.some(s => word.startsWith(s))) return 'verb';
  if (word.length >= 2 && NOUN_SUFFIXES.some(s => word.endsWith(s))) return 'noun';
  return 'noun'; // 默认名词
}

// ==================== 词组属性构建 ====================

/**
 * 从字符串词库构建带属性的词组对象数组
 * 基于字库和启发式规则填充默认属性
 */
export function buildVocabularyItems(
  words: string[],
  level: Level,
  charLib: string[],
): VocabularyItem[] {
  const totalChars = charLib.length;
  // 字库中前面的字更基础、更常用
  const charFrequencyRank = new Map<string, number>();
  charLib.forEach((c, i) => {
    // 位置越靠前频率越高，映射到1-10
    const rank = Math.max(1, Math.min(10, Math.round(10 - (i / totalChars) * 8)));
    charFrequencyRank.set(c, rank);
  });

  return words.map((word, idx) => {
    const chars = Array.from(word);
    // 计算词的综合频率（基于组成字的频率）
    const charRanks = chars.map(c => charFrequencyRank.get(c) || 5);
    const avgCharRank = charRanks.reduce((a, b) => a + b, 0) / chars.length;

    // 频率等级：组成字越高频，词越常见
    let frequency_rank = Math.round(avgCharRank * 0.8 + (10 - idx / words.length * 6) * 0.2);
    frequency_rank = Math.max(1, Math.min(10, frequency_rank));

    // 儿童阅读常见度：双字词+简单字 = 更高
    let reading_frequency = Math.round(avgCharRank * 0.7 + (word.length <= 2 ? 3 : 1));
    reading_frequency = Math.max(1, Math.min(10, reading_frequency));

    // 难度：字数越多越难，字越靠后越难
    let difficulty = Math.round(1 + (word.length - 2) * 1.5 + (10 - avgCharRank) * 0.3);
    difficulty = Math.max(1, Math.min(5, difficulty));

    const isCore = frequency_rank >= 7 && word.length === 2;
    const isChildCommon = reading_frequency >= 6;

    return {
      vocab_id: `${level}-vocab-${idx.toString().padStart(3, '0')}`,
      vocabulary: word,
      characters: chars,
      src_level: level,
      frequency_rank,
      reading_frequency,
      difficulty,
      part_of_speech: guessPartOfSpeech(word),
      is_core_vocabulary: isCore,
      is_child_reading_common: isChildCommon,
    };
  });
}

// ==================== 综合评分 ====================

/**
 * 计算词组的综合选择评分 (Vocabulary Selection Score)
 * 分越高越优先被抽取
 */
function calculateSelectionScore(
  item: VocabularyItem,
  validationValue: number,     // 单字验证价值 0-10
  representativeness: number,  // 代表性 0-10
  historyPriority: number,     // 历史优先级 0-10
  config: SamplingConfig,
): number {
  const readingFreqScore = item.reading_frequency; // 1-10
  const coreVocabScore = item.is_core_vocabulary ? 10 : (item.is_child_reading_common ? 7 : 4);
  const difficultyScore = 6 - Math.abs(item.difficulty - 2.5); // 中等难度加分

  const score =
    readingFreqScore * config.weightReadingFreq +
    coreVocabScore * config.weightCoreVocab +
    validationValue * config.weightValidationValue +
    representativeness * config.weightRepresentativeness +
    difficultyScore * config.weightDifficultyBalance +
    5 * config.weightPartOfSpeech + // 词性覆盖在后面统一处理
    historyPriority * config.weightHistoryPriority;

  return Math.round(score * 100) / 100;
}

// ==================== 单字验证价值 ====================

/**
 * 计算词组的单字验证价值
 * - 两个字都正确 → 高验证价值（测试能否组合成词）
 * - 一个正确一个错 → 中等价值（测试语境辅助识别）
 * - 两个都错 → 低价值
 */
function calculateValidationValue(
  item: VocabularyItem,
  charResults: Map<string, CharacterResult>,
): { value: number; correctCount: number; wrongCount: number } {
  let correctCount = 0;
  let wrongCount = 0;

  for (const ch of item.characters) {
    const result = charResults.get(ch);
    if (result) {
      if (result.is_correct) correctCount++;
      else wrongCount++;
    }
  }

  const totalKnown = correctCount + wrongCount;
  if (totalKnown === 0) return { value: 3, correctCount: 0, wrongCount: 0 };

  // 全对 → 高验证价值（组合成词的能力）
  if (wrongCount === 0 && totalKnown >= 2) {
    return { value: 10, correctCount, wrongCount };
  }
  // 部分对 → 中等价值（语境辅助）
  if (correctCount >= 1) {
    return { value: 7, correctCount, wrongCount };
  }
  // 全错 → 低价值
  return { value: 2, correctCount, wrongCount };
}

// ==================== 单字浓度控制 ====================

/**
 * 单字浓度控制：限制同一个汉字在抽测中的词组数量
 * 避免"学"字相关词组大量集中
 */
function applyCharacterConcentrationControl(
  items: VocabularyItem[],
  maxPerChar: number,
): VocabularyItem[] {
  const charCount = new Map<string, number>();
  const result: VocabularyItem[] = [];

  for (const item of items) {
    // 检查每个组成字的计数
    let canAdd = true;
    for (const ch of item.characters) {
      if ((charCount.get(ch) || 0) >= maxPerChar) {
        canAdd = false;
        break;
      }
    }

    if (canAdd) {
      result.push(item);
      for (const ch of item.characters) {
        charCount.set(ch, (charCount.get(ch) || 0) + 1);
      }
    }
  }

  return result;
}

// ==================== 词性覆盖 ====================

function selectForPartOfSpeechCoverage(
  pool: VocabularyItem[],
  targetCount: number,
): VocabularyItem[] {
  const selected: VocabularyItem[] = [];
  const usedIds = new Set<string>();

  // 按词性分组
  const byPOS: Record<PartOfSpeech, VocabularyItem[]> = {
    noun: [], verb: [], adjective: [], adverb: [], other: [],
  };
  for (const item of pool) {
    byPOS[item.part_of_speech].push(item);
  }

  // 轮流从各词性抽取，保证多样性
  const posList: PartOfSpeech[] = ['noun', 'verb', 'adjective', 'adverb', 'other'];
  let posIndex = 0;

  while (selected.length < targetCount) {
    const pos = posList[posIndex % posList.length];
    const candidates = byPOS[pos].filter(i => !usedIds.has(i.vocab_id));
    if (candidates.length > 0) {
      const pick = candidates[0];
      selected.push(pick);
      usedIds.add(pick.vocab_id);
    }
    posIndex++;

    // 如果所有词性都空了，用剩余池兜底
    if (posIndex > posList.length * 3) break;
  }

  // 不够则从剩余中补
  if (selected.length < targetCount) {
    for (const item of pool) {
      if (usedIds.has(item.vocab_id)) continue;
      selected.push(item);
      usedIds.add(item.vocab_id);
      if (selected.length >= targetCount) break;
    }
  }

  return selected.slice(0, targetCount);
}

// ==================== 难度梯度排序 ====================

/**
 * 排序策略：
 * - 前20%：简单、高频、熟悉（帮孩子进入状态）
 * - 中间60%：混合难度和词性
 * - 后20%：稍有挑战、低频但有阅读价值
 *
 * 同时打散相同语义聚集的词组
 */
export function arrangeByDifficultyGradient(
  items: SampledVocabulary[],
  config: SamplingConfig,
): SampledVocabulary[] {
  if (items.length === 0) return [];

  // 先按难度排序
  const sorted = [...items].sort((a, b) => a.difficulty - b.difficulty);

  const total = sorted.length;
  const easyCount = Math.ceil(total * config.easyStartRatio);
  const hardCount = Math.ceil(total * config.hardEndRatio);
  const midCount = total - easyCount - hardCount;

  const easyPart = sorted.slice(0, easyCount);
  const midPart = sorted.slice(easyCount, easyCount + midCount);
  const hardPart = sorted.slice(easyCount + midCount);

  // 打散中部：交叉排列高低频，避免语义聚集
  const shuffledMid = semanticShuffle(midPart);

  // 简单区也轻微打散
  const shuffledEasy = semanticShuffle(easyPart);

  return [...shuffledEasy, ...shuffledMid, ...hardPart];
}

/**
 * 语义打散：避免相同字/相似词连续出现
 * 使用贪心算法，每次选与前一个共享汉字最少的
 */
function semanticShuffle(items: SampledVocabulary[]): SampledVocabulary[] {
  if (items.length <= 2) return [...items];

  const result: SampledVocabulary[] = [];
  const remaining = [...items];

  // 先随机挑第一个
  const firstIdx = Math.floor(Math.random() * Math.min(3, remaining.length));
  result.push(remaining.splice(firstIdx, 1)[0]);

  while (remaining.length > 0) {
    const lastChars = new Set(result[result.length - 1].characters);
    let bestIdx = 0;
    let bestOverlap = Infinity;

    // 从前5个候选中找重叠最少的
    const checkCount = Math.min(5, remaining.length);
    for (let i = 0; i < checkCount; i++) {
      const overlap = remaining[i].characters.filter(c => lastChars.has(c)).length;
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
      }
    }

    result.push(remaining.splice(bestIdx, 1)[0]);
  }

  return result;
}

// ==================== 掌握状态计算 ====================

/**
 * 根据历史记录计算每个词组的掌握状态
 */
export function calculateMasteryStatus(
  records: VocabularyTestRecord[],
  config: SamplingConfig,
): VocabularyMastery {
  if (records.length === 0) {
    return {
      vocabulary_id: '',
      total_attempts: 0,
      correct_attempts: 0,
      accuracy: 0,
      last_result: null,
      last_tested_at: null,
      consecutive_correct: 0,
      consecutive_wrong: 0,
      mastery_status: 'untested',
    };
  }

  const total_attempts = records.length;
  const correct_attempts = records.filter(r => r.is_correct).length;
  const accuracy = correct_attempts / total_attempts;
  const sortedRecords = [...records].sort((a, b) => a.tested_at - b.tested_at);
  const last_result = sortedRecords[sortedRecords.length - 1].is_correct;
  const last_tested_at = sortedRecords[sortedRecords.length - 1].tested_at;

  // 计算连续正确/错误
  let consecutive_correct = 0;
  let consecutive_wrong = 0;
  for (let i = sortedRecords.length - 1; i >= 0; i--) {
    if (sortedRecords[i].is_correct) {
      consecutive_correct++;
      if (consecutive_wrong > 0) break;
    } else {
      consecutive_wrong++;
      if (consecutive_correct > 0) break;
    }
  }

  // 判定状态
  let mastery_status: VocabularyMasteryStatus;
  const daysSinceLast = last_tested_at
    ? (Date.now() - last_tested_at) / (1000 * 60 * 60 * 24)
    : 0;

  if (total_attempts === 1) {
    mastery_status = 'first_test';
  } else if (
    last_result === false ||
    (daysSinceLast > config.thresholdNeedsReviewDays && accuracy < config.thresholdBasicMasteryAccuracy)
  ) {
    mastery_status = 'needs_review';
  } else if (consecutive_correct >= config.thresholdStableMasteryConsecutive) {
    mastery_status = 'stable_mastery';
  } else if (
    total_attempts >= config.thresholdBasicMasteryAttempts &&
    accuracy >= config.thresholdBasicMasteryAccuracy
  ) {
    mastery_status = 'basic_mastery';
  } else {
    mastery_status = 'learning';
  }

  return {
    vocabulary_id: records[0].vocabulary_id,
    total_attempts,
    correct_attempts,
    accuracy,
    last_result,
    last_tested_at,
    consecutive_correct,
    consecutive_wrong,
    mastery_status,
  };
}

// ==================== 第一次测试抽样 ====================

/**
 * 第一次测试：从完整词库中抽取目标数量的词组
 *
 * 三池结构：
 * - Pool A (约40%)：核心高价值词组（高频+儿童阅读常见）
 * - Pool B (约40%)：单字验证词组（基于单字测试结果动态选择）
 * - Pool C (约20%)：结构覆盖补充（词性/难度/结构多样性）
 */
export function sampleFirstTest(
  allItems: VocabularyItem[],
  targetCount: number,
  charResults: Map<string, CharacterResult>,
  config: SamplingConfig = DEFAULT_SAMPLING_CONFIG,
): SampledVocabulary[] {
  if (targetCount >= allItems.length) {
    // 词组太少，全测
    return allItems.map(item => ({
      vocab_id: item.vocab_id,
      vocabulary: item.vocabulary,
      characters: item.characters,
      pool: 'core' as const,
      selection_reason: '词组量少，全量测试',
      selection_score: 10,
      difficulty: item.difficulty,
      part_of_speech: item.part_of_speech,
    }));
  }

  const coreCount = Math.round(targetCount * config.firstTestCorePoolRatio);
  const validationCount = Math.round(targetCount * config.firstTestValidationPoolRatio);
  const coverageCount = targetCount - coreCount - validationCount;

  // --- Pool A: 核心高价值词组 ---
  const coreCandidates = allItems
    .filter(item => item.is_child_reading_common || item.is_core_vocabulary)
    .map(item => {
      const validation = calculateValidationValue(item, charResults);
      const score = calculateSelectionScore(item, validation.value, 8, 5, config);
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);

  // 浓度控制
  const coreSelected = applyCharacterConcentrationControl(coreCandidates, config.maxWordsPerCharacter)
    .slice(0, coreCount);

  const usedIds = new Set(coreSelected.map(i => i.vocab_id));

  // --- Pool B: 单字验证词组 ---
  // 优先选：两个字都答对的词组（验证组合能力）
  // 少量选：含错字的词组（测试语境辅助识别）
  const remainingItems = allItems.filter(i => !usedIds.has(i.vocab_id));

  // 分两类：全对词组 vs 含错词组
  const allCorrectWords: VocabularyItem[] = [];
  const hasWrongWords: VocabularyItem[] = [];
  const noDataWords: VocabularyItem[] = [];

  for (const item of remainingItems) {
    const val = calculateValidationValue(item, charResults);
    if (val.wrongCount > 0) {
      hasWrongWords.push(item);
    } else if (val.correctCount >= 2) {
      allCorrectWords.push(item);
    } else {
      noDataWords.push(item);
    }
  }

  const wrongMaxInValidation = Math.round(validationCount * config.validationWrongCharMaxRatio);
  const validationFromCorrect = applyCharacterConcentrationControl(
    allCorrectWords.sort((a, b) => b.reading_frequency - a.reading_frequency),
    config.maxWordsPerCharacter,
  ).slice(0, validationCount - wrongMaxInValidation);

  const validationFromWrong = applyCharacterConcentrationControl(
    hasWrongWords.sort((a, b) => b.reading_frequency - a.reading_frequency),
    config.maxWordsPerCharacter,
  ).slice(0, wrongMaxInValidation);

  const validationSelected = [...validationFromCorrect, ...validationFromWrong];

  // 不够的话用noDataWords兜底
  if (validationSelected.length < validationCount) {
    const needMore = validationCount - validationSelected.length;
    const validationIds = new Set(validationSelected.map(i => i.vocab_id));
    const fillers = noDataWords
      .filter(i => !validationIds.has(i.vocab_id))
      .sort((a, b) => b.reading_frequency - a.reading_frequency)
      .slice(0, needMore);
    validationSelected.push(...fillers);
  }

  validationSelected.forEach(i => usedIds.add(i.vocab_id));

  // --- Pool C: 结构覆盖补充 ---
  // 保证词性、难度、结构的多样性
  const coverageCandidates = allItems.filter(i => !usedIds.has(i.vocab_id));
  const coverageSelected = selectForPartOfSpeechCoverage(coverageCandidates, coverageCount);

  // 浓度控制（对最终结果再做一次全局浓度检查）
  const allSelected = [...coreSelected, ...validationSelected, ...coverageSelected];
  const finalSelected = applyCharacterConcentrationControl(allSelected, config.maxWordsPerCharacter);

  // 不够数量时用剩余词组补足
  if (finalSelected.length < targetCount) {
    const need = targetCount - finalSelected.length;
    const finalIds = new Set(finalSelected.map(i => i.vocab_id));
    const fillers = allItems
      .filter(i => !finalIds.has(i.vocab_id))
      .sort((a, b) => b.reading_frequency - a.reading_frequency)
      .slice(0, need);
    finalSelected.push(...fillers);
  }

  // 转换成 SampledVocabulary 并添加原因
  const coreSet = new Set(coreSelected.map(i => i.vocab_id));
  const validationSet = new Set(validationSelected.map(i => i.vocab_id));

  const sampled: SampledVocabulary[] = finalSelected
    .slice(0, targetCount)
    .map(item => {
      const val = calculateValidationValue(item, charResults);
      const score = calculateSelectionScore(item, val.value, 7, 5, config);

      let pool: 'core' | 'validation' | 'coverage' = 'coverage';
      let reason = '结构覆盖补充';

      if (coreSet.has(item.vocab_id)) {
        pool = 'core';
        reason = item.is_core_vocabulary ? '核心高频词' : '儿童阅读常见词';
      } else if (validationSet.has(item.vocab_id)) {
        pool = 'validation';
        if (val.wrongCount > 0) {
          reason = '语境辅助识别验证';
        } else if (val.correctCount >= 2) {
          reason = '已掌握单字组合验证';
        } else {
          reason = '单字掌握验证';
        }
      }

      return {
        vocab_id: item.vocab_id,
        vocabulary: item.vocabulary,
        characters: item.characters,
        pool,
        selection_reason: reason,
        selection_score: score,
        difficulty: item.difficulty,
        part_of_speech: item.part_of_speech,
      };
    });

  // 按难度梯度排序
  return arrangeByDifficultyGradient(sampled, config);
}

// ==================== 后续测试抽样（第二次及以后） ====================

/**
 * 第二次及以后测试：基于历史掌握数据
 *
 * 三池结构：
 * - Review Pool (约45%)：未掌握/不稳定词组
 * - New Pool (约45%)：从未测试过的新词组
 * - Retention Pool (约10%)：稳定掌握的词组（验证不遗忘）
 *
 * 自动调整：
 * - 新词组不足 → 多余比例转入复习池
 * - 复习池不足 → 转入新词组或稳定池
 * - 全部测过 → 70%复测不稳定 + 30%稳定性复测
 */
export function sampleRetest(
  allItems: VocabularyItem[],
  targetCount: number,
  charResults: Map<string, CharacterResult>,
  masteryMap: Map<string, VocabularyMastery>,
  config: SamplingConfig = DEFAULT_SAMPLING_CONFIG,
): SampledVocabulary[] {
  // 按掌握状态分池
  const reviewPool: VocabularyItem[] = []; // 未掌握/不稳定
  const newPool: VocabularyItem[] = [];    // 从未测试
  const retentionPool: VocabularyItem[] = []; // 稳定掌握

  for (const item of allItems) {
    const mastery = masteryMap.get(item.vocab_id);
    if (!mastery || mastery.mastery_status === 'untested') {
      newPool.push(item);
    } else if (
      mastery.mastery_status === 'needs_review' ||
      mastery.mastery_status === 'first_test' ||
      mastery.mastery_status === 'learning' ||
      mastery.accuracy < config.thresholdBasicMasteryAccuracy
    ) {
      reviewPool.push(item);
    } else {
      retentionPool.push(item);
    }
  }

  // 计算各池目标数量
  let reviewTarget = Math.round(targetCount * config.retestReviewPoolRatio);
  let newTarget = Math.round(targetCount * config.retestNewPoolRatio);
  let retentionTarget = targetCount - reviewTarget - newTarget;

  // 自动调整：新词组不足
  if (newPool.length < newTarget) {
    const shortage = newTarget - newPool.length;
    newTarget = newPool.length;
    // 多余比例转入复习池
    reviewTarget += Math.round(shortage * 0.7);
    retentionTarget += shortage - Math.round(shortage * 0.7);
  }

  // 自动调整：复习池不足
  if (reviewPool.length < reviewTarget) {
    const shortage = reviewTarget - reviewPool.length;
    reviewTarget = reviewPool.length;
    // 转入新词组池（如果还有）
    if (newPool.length > newTarget) {
      const canAdd = Math.min(shortage, newPool.length - newTarget);
      newTarget += canAdd;
      retentionTarget += shortage - canAdd;
    } else {
      retentionTarget += shortage;
    }
  }

  // 边界保护
  reviewTarget = Math.min(reviewTarget, reviewPool.length);
  newTarget = Math.min(newTarget, newPool.length);
  retentionTarget = Math.min(retentionTarget, retentionPool.length);

  // 如果总数不够 targetCount，尽量补
  const totalAvailable = reviewTarget + newTarget + retentionTarget;
  if (totalAvailable < targetCount) {
    // 全部用上
    reviewTarget = reviewPool.length;
    newTarget = newPool.length;
    retentionTarget = retentionPool.length;
  }

  // --- 从各池选择（按评分排序 + 浓度控制） ---

  // 复习池：按错误严重程度排序
  const reviewSorted = reviewPool
    .map(item => {
      const mastery = masteryMap.get(item.vocab_id)!;
      const historyPriority = 10 - mastery.accuracy * 8; // 正确率越低优先级越高
      const val = calculateValidationValue(item, charResults);
      const score = calculateSelectionScore(item, val.value, 6, historyPriority, config);
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);

  const reviewSelected = applyCharacterConcentrationControl(reviewSorted, config.maxWordsPerCharacter)
    .slice(0, reviewTarget);

  const usedIds = new Set(reviewSelected.map(i => i.vocab_id));

  // 新词组池：核心高频优先 + 单字验证价值
  const newFiltered = newPool.filter(i => !usedIds.has(i.vocab_id));
  const newSorted = newFiltered
    .map(item => {
      const val = calculateValidationValue(item, charResults);
      const score = calculateSelectionScore(item, val.value, 7, 5, config);
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);

  const newSelected = applyCharacterConcentrationControl(newSorted, config.maxWordsPerCharacter)
    .slice(0, newTarget);

  newSelected.forEach(i => usedIds.add(i.vocab_id));

  // 稳定池：随机选 + 优先选择上次测试时间较久的
  const retentionFiltered = retentionPool.filter(i => !usedIds.has(i.vocab_id));
  const retentionSorted = retentionFiltered
    .sort((a, b) => {
      const ma = masteryMap.get(a.vocab_id);
      const mb = masteryMap.get(b.vocab_id);
      const ta = ma?.last_tested_at || 0;
      const tb = mb?.last_tested_at || 0;
      return ta - tb; // 越久没测越优先
    })
    .slice(0, retentionTarget);

  // 转换成 SampledVocabulary
  const reviewSet = new Set(reviewSelected.map(i => i.vocab_id));
  const newSet = new Set(newSelected.map(i => i.vocab_id));

  const allSelected = [...reviewSelected, ...newSelected, ...retentionSorted];
  const finalSelected = applyCharacterConcentrationControl(allSelected, config.maxWordsPerCharacter);

  const sampled: SampledVocabulary[] = finalSelected
    .slice(0, Math.min(targetCount, finalSelected.length))
    .map(item => {
      const val = calculateValidationValue(item, charResults);
      const mastery = masteryMap.get(item.vocab_id);

      let pool: 'core' | 'validation' | 'coverage' = 'validation';
      let reason = '';

      if (reviewSet.has(item.vocab_id)) {
        pool = 'validation';
        if (mastery?.mastery_status === 'needs_review') {
          reason = '待复习词组';
        } else if (mastery?.accuracy !== undefined && mastery.accuracy < 0.5) {
          reason = '历史错误率高';
        } else {
          reason = '掌握中需验证';
        }
      } else if (newSet.has(item.vocab_id)) {
        pool = 'core';
        reason = '首次测新词';
      } else {
        pool = 'coverage';
        reason = '稳定性复测';
      }

      const historyPriority = reviewSet.has(item.vocab_id) ? 9 : (newSet.has(item.vocab_id) ? 5 : 3);
      const score = calculateSelectionScore(item, val.value, 6, historyPriority, config);

      return {
        vocab_id: item.vocab_id,
        vocabulary: item.vocabulary,
        characters: item.characters,
        pool,
        selection_reason: reason,
        selection_score: score,
        difficulty: item.difficulty,
        part_of_speech: item.part_of_speech,
      };
    });

  return arrangeByDifficultyGradient(sampled, config);
}

// ==================== 统一入口 ====================

/**
 * 词组抽测统一入口
 * 自动判断是第一次测试还是后续测试
 */
export function selectVocabularyTest(
  allWords: string[],
  level: Level,
  charLib: string[],
  charResults: CharacterResult[],
  historyRecords?: VocabularyTestRecord[],
  config: SamplingConfig = DEFAULT_SAMPLING_CONFIG,
): {
  sampled: SampledVocabulary[];
  coverage: { tested: number; total: number; rate: number };
} {
  const items = buildVocabularyItems(allWords, level, charLib);
  const charResultMap = new Map(charResults.map(r => [r.character, r]));

  const targetCount = Math.max(5, Math.round(items.length * LEVEL_CONFIG[level].wordSampleRatio));

  // 构建掌握状态Map
  const masteryMap = new Map<string, VocabularyMastery>();
  if (historyRecords && historyRecords.length > 0) {
    // 按词组分组
    const byVocab = new Map<string, VocabularyTestRecord[]>();
    for (const record of historyRecords) {
      if (!byVocab.has(record.vocabulary_id)) {
        byVocab.set(record.vocabulary_id, []);
      }
      byVocab.get(record.vocabulary_id)!.push(record);
    }

    for (const [vid, records] of byVocab) {
      const mastery = calculateMasteryStatus(records, config);
      mastery.vocabulary_id = vid;
      masteryMap.set(vid, mastery);
    }
  }

  const isFirstTest = masteryMap.size === 0;

  let sampled: SampledVocabulary[];
  if (isFirstTest) {
    sampled = sampleFirstTest(items, targetCount, charResultMap, config);
  } else {
    sampled = sampleRetest(items, targetCount, charResultMap, masteryMap, config);
  }

  // 计算覆盖率
  const historicallyTested = masteryMap.size;
  const newlySampledCount = sampled.filter(s => !masteryMap.has(s.vocab_id)).length;
  const totalAfterThis = new Set([...Array.from(masteryMap.keys()), ...sampled.map(s => s.vocab_id)]).size;

  return {
    sampled,
    coverage: {
      tested: historicallyTested + newlySampledCount,
      total: items.length,
      rate: items.length > 0 ? totalAfterThis / items.length : 0,
    },
  };
}

// ==================== 结果更新 ====================

/**
 * 根据本次测试结果更新词组掌握记录
 */
export function updateVocabularyMastery(
  existingRecords: VocabularyTestRecord[],
  newResults: { vocabulary_id: string; is_correct: boolean; response_time_ms: number }[],
  config: SamplingConfig = DEFAULT_SAMPLING_CONFIG,
): { records: VocabularyTestRecord[]; masteryMap: Map<string, VocabularyMastery> } {
  const now = Date.now();
  const newRecords: VocabularyTestRecord[] = newResults.map(r => ({
    vocabulary_id: r.vocabulary_id,
    is_correct: r.is_correct,
    response_time_ms: r.response_time_ms,
    tested_at: now,
  }));

  const allRecords = [...existingRecords, ...newRecords];

  // 按词组分组并计算掌握状态
  const byVocab = new Map<string, VocabularyTestRecord[]>();
  for (const record of allRecords) {
    if (!byVocab.has(record.vocabulary_id)) {
      byVocab.set(record.vocabulary_id, []);
    }
    byVocab.get(record.vocabulary_id)!.push(record);
  }

  const masteryMap = new Map<string, VocabularyMastery>();
  for (const [vid, records] of byVocab) {
    const mastery = calculateMasteryStatus(records, config);
    mastery.vocabulary_id = vid;
    masteryMap.set(vid, mastery);
  }

  return { records: allRecords, masteryMap };
}
