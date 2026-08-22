/**
 * 智能抽样算法模块 (Item Selection Algorithm)
 * 
 * 设计原则：
 * - 独立模块，未来可替换为IRT / CAT / Bayesian 等更高级算法
 * - 不与具体UI或数据库耦合，输入输出为纯数据
 * 
 * 核心逻辑：
 * 1. 从字库获取全部候选项目
 * 2. 根据历史掌握数据分为三个池：复测池 / 新题池 / 稳定性复测池
 * 3. 按配置比例从各池抽样
 * 4. 分层随机 + 去聚集（避免相似题连续出现）
 */

import type { Level, CharacterMastery, VocabularyMastery, SampledItem, ItemPoolType, SamplingConfig, MasteryStatus } from './types';
import { DEFAULT_SAMPLING_CONFIG } from './types';

// ============================================================
// 1. 掌握状态判定
// ============================================================

/**
 * 根据测试历史计算单个项目的掌握状态
 */
export function calculateMasteryStatus(
  totalTests: number,
  correctCount: number,
  lastResult: boolean,
  streakCorrect: number,
  config: SamplingConfig = DEFAULT_SAMPLING_CONFIG,
): MasteryStatus {
  if (totalTests === 0) return 'untested';
  if (totalTests === 1) return 'first_test';

  const accuracy = correctCount / totalTests;

  // 稳定掌握：最近至少N次正确 且 累计正确率≥阈值
  if (lastResult && streakCorrect >= config.stableMinCorrectStreak && accuracy >= config.stableMinAccuracy) {
    return 'stable_mastery';
  }

  // 基本掌握：累计正确率≥阈值 且 最近一次正确
  if (lastResult && accuracy >= config.stableMinAccuracy) {
    return 'basic_mastery';
  }

  // 需要复习：最近一次错误，或正确率低于60%
  if (!lastResult || accuracy < 0.6) {
    return 'needs_review';
  }

  // 掌握中
  return 'learning';
}

// ============================================================
// 2. 池子划分
// ============================================================

interface PoolDivisionResult {
  reviewPool: string[];    // 复测池：未稳定掌握的
  newPool: string[];       // 新题池：从未测试过的
  retentionPool: string[]; // 稳定性复测池：已掌握但超时未测
}

/**
 * 将候选项目分到三个池子
 * 
 * @param allItems 全部候选项目（单字或词组）
 * @param masteryMap 掌握度映射 key=item value=掌握数据
 * @param config 抽样配置
 * @param lastTestDateMap 每个项目的最后测试日期（可选，用于遗忘判断）
 */
export function divideIntoPools(
  allItems: string[],
  masteryMap: Map<string, { status: MasteryStatus; lastTestDate?: string; lastResult?: boolean }>,
  config: SamplingConfig = DEFAULT_SAMPLING_CONFIG,
): PoolDivisionResult {
  const now = Date.now();
  const forgetMs = config.forgetThresholdDays * 24 * 60 * 60 * 1000;

  const reviewPool: string[] = [];
  const newPool: string[] = [];
  const retentionPool: string[] = [];

  for (const item of allItems) {
    const mastery = masteryMap.get(item);

    if (!mastery || mastery.status === 'untested') {
      newPool.push(item);
      continue;
    }

    // 已稳定掌握但超过遗忘阈值 → 稳定性复测池
    if (mastery.status === 'stable_mastery' && mastery.lastTestDate) {
      const daysSince = now - new Date(mastery.lastTestDate).getTime();
      if (daysSince > forgetMs) {
        retentionPool.push(item);
        continue;
      }
      // 稳定掌握且近期测过 → 不抽
      continue;
    }

    // 其余未稳定掌握的 → 复测池
    if (mastery.status !== 'stable_mastery') {
      reviewPool.push(item);
    }
  }

  return { reviewPool, newPool, retentionPool };
}

// ============================================================
// 3. 分层抽样核心函数
// ============================================================

/**
 * 从单个池子中随机抽样
 */
function sampleFromPool(pool: string[], count: number): string[] {
  if (count <= 0 || pool.length === 0) return [];
  const actualCount = Math.min(count, pool.length);
  
  // Fisher-Yates 洗牌
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled.slice(0, actualCount);
}

/**
 * 智能抽样：从三个池子按比例抽取
 * 
 * @param totalCount 目标总题数
 * @param pools 三个池子
 * @param config 抽样配置
 * @returns 抽样结果及每个项目的来源池
 */
export function intelligentSample(
  totalCount: number,
  pools: PoolDivisionResult,
  config: SamplingConfig = DEFAULT_SAMPLING_CONFIG,
): SampledItem[] {
  const { reviewPool, newPool, retentionPool } = pools;
  
  // 计算每个池子的目标数量
  const reviewTarget = Math.floor(totalCount * config.reviewRatio);
  const newTarget = Math.floor(totalCount * config.newItemRatio);
  const retentionTarget = totalCount - reviewTarget - newTarget; // 剩余给稳定性复测

  const result: SampledItem[] = [];
  let priority = 0;

  // 先从复测池抽（优先级最高）
  const reviewItems = sampleFromPool(reviewPool, reviewTarget);
  for (const item of reviewItems) {
    result.push({ content: item, type: 'character', poolType: 'review', priority: priority++, level: 'SRC100' });
  }

  // 再从新题池抽
  const newItems = sampleFromPool(newPool, newTarget);
  for (const item of newItems) {
    result.push({ content: item, type: 'character', poolType: 'new', priority: priority++, level: 'SRC100' });
  }

  // 最后从稳定性复测池抽
  const retentionItems = sampleFromPool(retentionPool, retentionTarget);
  for (const item of retentionItems) {
    result.push({ content: item, type: 'character', poolType: 'retention', priority: priority++, level: 'SRC100' });
  }

  // 如果总数不够，从剩余池子补
  const remaining = totalCount - result.length;
  if (remaining > 0) {
    // 优先补新题池，其次复测池
    const usedItems = new Set(result.map(r => r.content));
    const candidates = [
      ...newPool.filter(i => !usedItems.has(i)),
      ...reviewPool.filter(i => !usedItems.has(i)),
      ...retentionPool.filter(i => !usedItems.has(i)),
    ];
    const extra = sampleFromPool(candidates, remaining);
    for (const item of extra) {
      result.push({ content: item, type: 'character', poolType: 'new', priority: priority++, level: 'SRC100' });
    }
  }

  return result.slice(0, totalCount);
}

// ============================================================
// 4. 去聚集机制（防止相似题连续出现）
// ============================================================

/**
 * 判断两个汉字是否"相似"
 * 简单规则：相同部首、形近字、同音字等
 * 这里使用基础规则，未来可接入更复杂的形近字库
 */
function isCharSimilar(a: string, b: string): boolean {
  // 相同字
  if (a === b) return true;
  
  // 共享偏旁部首的简化判断（基于Unicode同部首聚类）
  // 这里用一个简单启发式：如果两个字有相同的部件，就算相似
  // 实际应用中可以接入完整的偏旁部首数据库
  
  // 常见易混字对（简化版）
  const similarGroups = [
    ['木', '林', '森', '树'],
    ['山', '峰', '岩', '岛'],
    ['水', '江', '河', '海', '湖', '洋', '流'],
    ['火', '炎', '烧', '炒'],
    ['人', '从', '众', '他', '们', '你', '他', '住', '位'],
    ['日', '明', '晴', '时', '早', '晚'],
    ['月', '朋', '明', '期'],
    ['口', '唱', '吃', '叫', '听'],
    ['心', '想', '思', '念', '意', '情'],
    ['手', '打', '拿', '找', '把', '拉'],
    ['眼', '看', '睛', '睡', '眨'],
    ['言', '说', '话', '语', '读', '讲'],
  ];
  
  for (const group of similarGroups) {
    if (group.includes(a) && group.includes(b)) return true;
  }
  
  return false;
}

/**
 * 对抽样结果进行去聚集重排
 * 确保相似字形、相似意义的题目不连续出现
 */
export function deagglomerate(items: SampledItem[]): SampledItem[] {
  if (items.length <= 2) return items;

  const result: SampledItem[] = [];
  const remaining = [...items];

  while (remaining.length > 0) {
    let selectedIndex = -1;

    // 找一个与上一个不相似的
    const lastContent = result.length > 0 ? result[result.length - 1].content : '';
    const secondLast = result.length > 1 ? result[result.length - 2].content : '';

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i].content;
      
      // 只对单字做形近判断（词组用首字判断）
      const charToCheck = candidate.length === 1 ? candidate : candidate[0];
      const lastChar = lastContent.length === 1 ? lastContent : lastContent[0] || '';
      const secondChar = secondLast.length === 1 ? secondLast : secondLast[0] || '';

      // 不与上一个、上上个相似
      if (!isCharSimilar(charToCheck, lastChar) && !isCharSimilar(charToCheck, secondChar)) {
        selectedIndex = i;
        break;
      }
    }

    // 如果找不到不相似的（剩余太少），就取第一个
    if (selectedIndex === -1) selectedIndex = 0;

    result.push(remaining[selectedIndex]);
    remaining.splice(selectedIndex, 1);
  }

  return result;
}

// ============================================================
// 5. 完整的单字测试生成入口
// ============================================================

export interface GenerateCharacterTestInput {
  level: Level;
  allCharacters: string[];          // 该等级全部单字
  totalCharCount: number;           // 等级总字数
  masteryMap: Map<string, { status: MasteryStatus; lastTestDate?: string; lastResult?: boolean }>;
  config?: Partial<SamplingConfig>;
  isFirstTest?: boolean;            // 是否首次测试（无历史数据）
}

/**
 * 生成单字测试列表（智能抽样版）
 * 
 * 对于首次测试：完全随机抽样（保证分层覆盖）
 * 对于重复测试：按 45%复测 + 45%新题 + 10%稳定性 抽样
 */
export function generateCharacterTest(
  input: GenerateCharacterTestInput,
): SampledItem[] {
  const { level, allCharacters, masteryMap, isFirstTest = false } = input;
  
  const config: SamplingConfig = {
    ...DEFAULT_SAMPLING_CONFIG,
    ...input.config,
  };

  // 计算目标题量
  const ratio = config.charTestRatio[level];
  const targetCount = Math.max(5, Math.floor(allCharacters.length * ratio));

  // 首次测试：纯随机 + 分层
  if (isFirstTest || masteryMap.size === 0) {
    const sampled = sampleFromPool(allCharacters, targetCount);
    return deagglomerate(
      sampled.map((content, idx) => ({
        content,
        type: 'character' as const,
        poolType: 'new' as ItemPoolType,
        priority: idx,
        level,
      })),
    );
  }

  // 重复测试：三分池智能抽样
  const pools = divideIntoPools(allCharacters, masteryMap, config);
  const sampled = intelligentSample(targetCount, pools, config);
  
  // 填充 level 信息
  const withLevel = sampled.map(item => ({ ...item, level }));
  
  // 去聚集
  return deagglomerate(withLevel);
}

// ============================================================
// 6. 词组测试生成
// ============================================================

export interface GenerateVocabTestInput {
  level: Level;
  allWords: string[];               // 该等级全部词组
  testedChars: string[];            // 本次单字测试涉及的字
  charMasteryMap: Map<string, { status: MasteryStatus; lastResult?: boolean }>;
  wordMasteryMap: Map<string, { status: MasteryStatus; lastTestDate?: string; lastResult?: boolean }>;
  config?: Partial<SamplingConfig>;
}

/**
 * 生成词组测试列表
 * 
 * 规则：
 * - 词组测试量 = 单字测试量 × 词组比例
 * - 优先选择含本次单字测试中错误/不稳定字的词组
 * - 确保覆盖尽量多的不同汉字
 * - 难度分布：双字词80%、三字词15%、四字词5%
 */
export function generateVocabTest(
  input: GenerateVocabTestInput,
): SampledItem[] {
  const { level, allWords, testedChars, charMasteryMap, wordMasteryMap } = input;
  
  const config: SamplingConfig = {
    ...DEFAULT_SAMPLING_CONFIG,
    ...input.config,
  };

  // 目标词组数量 = 单字测试量 × 词组比例
  const targetCount = Math.max(3, Math.floor(testedChars.length * config.wordTestRatio[level]));

  // 按字长分组
  const words2char: string[] = [];
  const words3char: string[] = [];
  const words4char: string[] = [];
  
  for (const word of allWords) {
    if (word.length === 2) words2char.push(word);
    else if (word.length === 3) words3char.push(word);
    else if (word.length >= 4) words4char.push(word);
  }

  // 难度分布：双字词80%、三字词15%、四字词5%
  const target2char = Math.floor(targetCount * 0.80);
  const target3char = Math.floor(targetCount * 0.15);
  const target4char = targetCount - target2char - target3char;

  const result: SampledItem[] = [];
  const usedChars = new Set<string>();
  let priority = 0;

  // 从含未掌握单字的词组中优先选（复测池）
  const unstableChars = new Set<string>();
  for (const char of testedChars) {
    const mastery = charMasteryMap.get(char);
    if (mastery && mastery.status !== 'stable_mastery') {
      unstableChars.add(char);
    }
  }

  /**
   * 从指定词组池选择与目标字集相关的词组
   */
  function selectWordsRelatedToChars(
    wordPool: string[],
    charSet: Set<string>,
    count: number,
    poolType: ItemPoolType,
  ): string[] {
    // 筛选包含目标字的词
    const related = wordPool.filter(w => {
      for (const ch of w) {
        if (charSet.has(ch)) return true;
      }
      return false;
    });
    
    // 按"新字覆盖量"排序：优先选包含更多未覆盖字的词
    related.sort((a, b) => {
      const aNewChars = a.split('').filter(c => !usedChars.has(c) && charSet.has(c)).length;
      const bNewChars = b.split('').filter(c => !usedChars.has(c) && charSet.has(c)).length;
      return bNewChars - aNewChars;
    });

    return related.slice(0, count);
  }

  // 按难度分别抽词
  function sampleByDifficulty(
    charSet: Set<string>,
    poolType: ItemPoolType,
  ) {
    // 双字词
    const words2 = selectWordsRelatedToChars(words2char, charSet, target2char - result.filter(r => r.content.length === 2).length, poolType);
    for (const w of words2) {
      result.push({ content: w, type: 'word', poolType, priority: priority++, level });
      for (const ch of w) usedChars.add(ch);
    }
    
    // 三字词
    const words3 = selectWordsRelatedToChars(words3char, charSet, target3char - result.filter(r => r.content.length === 3).length, poolType);
    for (const w of words3) {
      result.push({ content: w, type: 'word', poolType, priority: priority++, level });
      for (const ch of w) usedChars.add(ch);
    }
    
    // 四字词
    const words4 = selectWordsRelatedToChars(words4char, charSet, target4char - result.filter(r => r.content.length >= 4).length, poolType);
    for (const w of words4) {
      result.push({ content: w, type: 'word', poolType, priority: priority++, level });
      for (const ch of w) usedChars.add(ch);
    }
  }

  // 第一步：含未掌握单字的词组（复测池）
  if (unstableChars.size > 0) {
    sampleByDifficulty(unstableChars, 'review');
  }

  // 第二步：从未测过的词组中选（新题池）
  if (result.length < targetCount) {
    const untestedWords = allWords.filter(w => {
      const m = wordMasteryMap.get(w);
      return !m || m.status === 'untested';
    });
    const remaining = targetCount - result.length;
    const selected = sampleFromPool(untestedWords, remaining);
    for (const w of selected) {
      result.push({ content: w, type: 'word', poolType: 'new', priority: priority++, level });
    }
  }

  // 第三步：如果还不够，用其他词组补
  if (result.length < targetCount) {
    const usedWords = new Set(result.map(r => r.content));
    const remaining = allWords.filter(w => !usedWords.has(w));
    const extra = sampleFromPool(remaining, targetCount - result.length);
    for (const w of extra) {
      result.push({ content: w, type: 'word', poolType: 'retention', priority: priority++, level });
    }
  }

  // 去聚集
  return deagglomerate(result.slice(0, targetCount));
}

// ============================================================
// 7. 掌握度更新
// ============================================================

export interface UpdateMasteryInput {
  previous?: {
    totalTests: number;
    correctCount: number;
    lastResult: boolean;
    lastTestDate: string;
    streakCorrect: number;
    streakWrong: number;
  };
  currentResult: boolean;
  testDate?: string;
}

/**
 * 更新单个项目的掌握数据
 */
export function updateMasteryData(
  input: UpdateMasteryInput,
  config: SamplingConfig = DEFAULT_SAMPLING_CONFIG,
): {
  totalTests: number;
  correctCount: number;
  lastResult: boolean;
  lastTestDate: string;
  streakCorrect: number;
  streakWrong: number;
  masteryRate: number;
  masteryStatus: MasteryStatus;
} {
  const { previous, currentResult } = input;
  const testDate = input.testDate || new Date().toISOString();

  const totalTests = (previous?.totalTests || 0) + 1;
  const correctCount = (previous?.correctCount || 0) + (currentResult ? 1 : 0);
  
  let streakCorrect = 0;
  let streakWrong = 0;
  
  if (currentResult) {
    streakCorrect = (previous?.streakCorrect || 0) + 1;
    streakWrong = 0;
  } else {
    streakWrong = (previous?.streakWrong || 0) + 1;
    streakCorrect = 0;
  }

  const masteryRate = totalTests > 0 ? correctCount / totalTests : 0;
  
  const masteryStatus = calculateMasteryStatus(
    totalTests,
    correctCount,
    currentResult,
    streakCorrect,
    config,
  );

  return {
    totalTests,
    correctCount,
    lastResult: currentResult,
    lastTestDate: testDate,
    streakCorrect,
    streakWrong,
    masteryRate,
    masteryStatus,
  };
}
