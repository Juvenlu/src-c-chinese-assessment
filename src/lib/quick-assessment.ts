/**
 * 快速体验测评 - 核心算法
 * 
 * 功能：
 * 1. 分层抽题（SRC100/300/500/800四级难度梯度）
 * 2. 自适应难度调整
 * 3. SRC级别估算（最高稳定掌握等级）
 * 
 * 设计原则：
 * - 3-5分钟完成，约30题（20单字 + 10词组）
 * - 难度梯度：基础→中等→进阶→高级
 * - 正向反馈，无考试压力
 */

import { Level, LEVEL_CONFIG, SampledItem } from './types';
import { getCharList, getWordList } from './questions';

/** 测试部分类型 */
export type QAItem = {
  id: string;
  type: 'character' | 'vocabulary';
  content: string;
  level: Level;
  difficulty: number; // 1-5
  options?: string[];
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

/** 级别估算结果 */
export type LevelEstimate = {
  estimatedLevel: Level;
  confidence: 'low' | 'medium' | 'high';
  levelBreakdown: Record<Level, { tested: number; correct: number; rate: number }>;
  overallCharRate: number;
  overallVocabRate: number;
  charTested: number;
  charCorrect: number;
  vocabTested: number;
  vocabCorrect: number;
};

/** 快速测评配置 */
export const QUICK_TEST_CONFIG = {
  /** 单字题数 */
  charQuestionCount: 20,
  /** 词组题数 */
  vocabQuestionCount: 10,
  /** 每级基础题数 */
  questionsPerLevel: {
    SRC100: 5,
    SRC300: 5,
    SRC500: 5,
    SRC800: 5,
  },
  /** 稳定通过阈值（判断某级已掌握的正确率） */
  masteryThreshold: {
    SRC100: 0.85,
    SRC300: 0.75,
    SRC500: 0.65,
    SRC800: 0.5,
  },
};

/**
 * 生成快速测评单字题目
 * 四级难度各抽5题，共20题，难度递增排列
 */
export function generateQuickCharQuestions(
  excludeIds: string[] = [],
): QAItem[] {
  const levels: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  const allQuestions: QAItem[] = [];
  const excludeSet = new Set(excludeIds);

  levels.forEach((level, levelIdx) => {
    const chars = getCharList(level);
    // 过滤掉已排除的
    const available = chars.filter(c => !excludeSet.has(`char-${level}-${c}`));
    // 随机抽5题
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, QUICK_TEST_CONFIG.questionsPerLevel[level]);
    
    selected.forEach((char, idx) => {
      allQuestions.push({
        id: `char-${level}-${char}`,
        type: 'character',
        content: char,
        level,
        difficulty: levelIdx + 1,
      });
    });
  });

  // 按难度从易到难排列
  return allQuestions.sort((a, b) => a.difficulty - b.difficulty);
}

/**
 * 生成快速测评词组词目
 * 从已通过等级的词组中抽取，确保词组中的字孩子应该认识
 */
export function generateQuickVocabQuestions(
  charResults: QAResult[],
  excludeIds: string[] = [],
): QAItem[] {
  // 先估算单字掌握的最高稳定等级
  const breakdown = calcLevelBreakdown(charResults);
  const maxPassedLevel = getMaxPassedLevel(breakdown);
  
  const levels: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  const maxIdx = levels.indexOf(maxPassedLevel);
  // 词组测试范围：从SRC100到maxPassedLevel的下一级（各抽2-3题）
  const testLevels = levels.slice(0, Math.min(maxIdx + 2, levels.length));
  
  const allQuestions: QAItem[] = [];
  const excludeSet = new Set(excludeIds);
  const totalCount = QUICK_TEST_CONFIG.vocabQuestionCount;
  const perLevel = Math.ceil(totalCount / testLevels.length);

  testLevels.forEach((level, levelIdx) => {
    const words = getWordList(level);
    const available = words.filter(w => {
      const id = `vocab-${level}-${w}`;
      return !excludeSet.has(id);
    });
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, perLevel);
    
    selected.forEach(word => {
      allQuestions.push({
        id: `vocab-${level}-${word}`,
        type: 'vocabulary',
        content: word,
        level,
        difficulty: levelIdx + 1,
      });
    });
  });

  // 按难度排序
  return allQuestions
    .sort((a, b) => a.difficulty - b.difficulty)
    .slice(0, totalCount);
}

/**
 * 计算每级的正确率分布
 */
function calcLevelBreakdown(results: QAResult[]): Record<Level, { tested: number; correct: number; rate: number }> {
  const levels: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  const breakdown = {} as Record<Level, { tested: number; correct: number; rate: number }>;
  
  levels.forEach(level => {
    const levelResults = results.filter(r => r.level === level);
    const tested = levelResults.length;
    const correct = levelResults.filter(r => r.isCorrect).length;
    breakdown[level] = {
      tested,
      correct,
      rate: tested > 0 ? correct / tested : 0,
    };
  });
  
  return breakdown;
}

/**
 * 获取最高通过等级
 */
function getMaxPassedLevel(breakdown: Record<Level, { tested: number; correct: number; rate: number }>): Level {
  const levels: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  let maxLevel: Level = 'SRC100';
  
  for (const level of levels) {
    const { tested, rate } = breakdown[level];
    if (tested >= 3 && rate >= QUICK_TEST_CONFIG.masteryThreshold[level]) {
      maxLevel = level;
    }
  }
  
  return maxLevel;
}

/**
 * 估算SRC级别
 * 
 * 算法：
 * 1. 计算每级正确率
 * 2. 从低到高检查，找到最高的"稳定通过"等级
 * 3. 结合下一级的部分正确率，给出精细估算
 * 4. 置信度：题数越多、结果越稳定 → 置信度越高
 */
export function estimateSRCLevel(
  charResults: QAResult[],
  vocabResults: QAResult[],
): LevelEstimate {
  const charBreakdown = calcLevelBreakdown(charResults);
  const levels: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  
  // 找出最高稳定掌握等级
  let maxStableLevel: Level = 'SRC100';
  for (const level of levels) {
    const { tested, rate } = charBreakdown[level];
    if (tested >= 4 && rate >= QUICK_TEST_CONFIG.masteryThreshold[level]) {
      maxStableLevel = level;
    }
  }
  
  // 综合正确率
  const charTested = charResults.length;
  const charCorrect = charResults.filter(r => r.isCorrect).length;
  const vocabTested = vocabResults.length;
  const vocabCorrect = vocabResults.filter(r => r.isCorrect).length;
  const overallCharRate = charTested > 0 ? charCorrect / charTested : 0;
  const overallVocabRate = vocabTested > 0 ? vocabCorrect / vocabTested : 0;
  
  // 检查下一级的表现（如果有的话）
  const maxIdx = levels.indexOf(maxStableLevel);
  const nextLevel = levels[maxIdx + 1];
  if (nextLevel && charBreakdown[nextLevel].tested >= 3) {
    const nextRate = charBreakdown[nextLevel].rate;
    const threshold = QUICK_TEST_CONFIG.masteryThreshold[nextLevel];
    // 如果下一级达到阈值的50%以上，估算为"接近下一级"
    if (nextRate >= threshold * 0.6 && nextRate < threshold) {
      // 仍返回当前级别，但置信度会影响描述
    }
  }
  
  // 置信度
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  const totalTested = charTested + vocabTested;
  if (totalTested < 15) {
    confidence = 'low';
  } else if (totalTested >= 25 && overallCharRate > 0.7) {
    confidence = 'high';
  }
  
  // 词组也计算每级分布（用于展示）
  const vocabBreakdown = calcLevelBreakdown(vocabResults);
  // 合并单字和词组的层级分布（显示用）
  const combinedBreakdown = {} as Record<Level, { tested: number; correct: number; rate: number }>;
  levels.forEach(level => {
    const c = charBreakdown[level];
    const v = vocabBreakdown[level];
    const tested = c.tested + v.tested;
    const correct = c.correct + v.correct;
    combinedBreakdown[level] = {
      tested,
      correct,
      rate: tested > 0 ? correct / tested : 0,
    };
  });
  
  return {
    estimatedLevel: maxStableLevel,
    confidence,
    levelBreakdown: combinedBreakdown,
    overallCharRate,
    overallVocabRate,
    charTested,
    charCorrect,
    vocabTested,
    vocabCorrect,
  };
}

/**
 * 生成年龄段对应的起始难度建议
 * 仅供参考，不强制
 */
export function getStartLevelByAge(ageGroup: string): Level {
  switch (ageGroup) {
    case '5-7': return 'SRC100';
    case '8-10': return 'SRC300';
    case '11-13': return 'SRC500';
    case '14+': return 'SRC500';
    default: return 'SRC300';
  }
}

/**
 * 根据估算结果生成阅读建议
 */
export function getReadingRecommendation(estimate: LevelEstimate): {
  level: string;
  title: string;
  description: string;
  tips: string[];
} {
  const { estimatedLevel, confidence, overallCharRate } = estimate;
  const levelNames: Record<Level, string> = {
    SRC100: 'SRC100',
    SRC300: 'SRC300',
    SRC500: 'SRC500',
    SRC800: 'SRC800',
  };
  
  const levelDesc: Record<Level, string> = {
    SRC100: '入门级阅读基础',
    SRC300: '初级阅读基础',
    SRC500: '中级阅读基础',
    SRC800: '高级阅读基础',
  };
  
  let tips: string[] = [];
  
  if (estimatedLevel === 'SRC100') {
    tips = [
      '每天10分钟亲子共读中文绘本',
      '从简单的图画故事开始，培养阅读兴趣',
      '多听中文儿歌和故事音频',
    ];
    if (overallCharRate >= 0.85) {
      tips.push('可以尝试进入SRC300阶段的绘本和练习');
    }
  } else if (estimatedLevel === 'SRC300') {
    tips = [
      '每天15分钟独立阅读简单中文绘本',
      '增加生活类词汇的听说练习',
      '尝试用中文复述简单的故事情节',
    ];
    if (overallCharRate >= 0.85) {
      tips.push('可以挑战SRC500级别的分级读物');
    }
  } else if (estimatedLevel === 'SRC500') {
    tips = [
      '每天20分钟中文阅读，逐步增加阅读量',
      '开始阅读章节书的简易版本',
      '通过主题词汇扩展词汇量',
    ];
    if (overallCharRate >= 0.8) {
      tips.push('可以进入SRC800阶段，扩大阅读范围');
    }
  } else {
    tips = [
      '广泛阅读中文儿童文学和科普读物',
      '尝试不同文体和主题的中文书籍',
      '通过写作和表达加深对词汇的理解',
    ];
  }
  
  const confText = confidence === 'high' ? '较稳定的' : confidence === 'medium' ? '初步的' : '快速的';
  
  return {
    level: levelNames[estimatedLevel],
    title: levelDesc[estimatedLevel],
    description: `根据本次${confText}测评，孩子的中文阅读字词基础大约在${levelNames[estimatedLevel]}阶段。这只是初步估测，完整测评可以获得更准确的结果。`,
    tips,
  };
}

/**
 * 从localStorage读取历史测试题ID（用于去重）
 */
export function getExcludedQuestionIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem('src_quick_test_history');
    if (data) {
      const parsed = JSON.parse(data);
      return parsed.questionIds || [];
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * 保存测试历史到localStorage
 */
export function saveTestHistory(questionIds: string[], result: LevelEstimate): void {
  if (typeof window === 'undefined') return;
  try {
    const data = {
      questionIds,
      result: {
        estimatedLevel: result.estimatedLevel,
        overallCharRate: result.overallCharRate,
        overallVocabRate: result.overallVocabRate,
      },
      timestamp: Date.now(),
    };
    localStorage.setItem('src_quick_test_history', JSON.stringify(data));
  } catch {
    // ignore
  }
}

/**
 * 将QA结果转换为SampledItem格式（复用现有组件）
 */
export function qaToSampledItems(items: QAItem[]): SampledItem[] {
  return items.map(item => ({
    content: item.content,
    type: item.type === 'character' ? 'character' : 'word',
    poolType: item.type === 'character' ? 'review' : 'new',
    priority: item.difficulty,
    level: item.level,
  }));
}
