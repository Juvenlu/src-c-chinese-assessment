import { Level, TestAnswer, LEVEL_CONFIG, PART_WEIGHTS } from '@/lib/types';

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
