/**
 * Scoring — 测试评分纯函数（Worker 版本）
 *
 * 从 Vercel src/lib/scoring.ts 移植，保持算法完全一致。
 * 纯函数，无外部依赖，可直接移植测试。
 *
 * Formal Test 权重：
 * - char 50% + vocab 50%（两部分正式测试）
 * Sampling 模式：
 * - char 30% + vocab 30% + reading 20% + comprehension 20%
 */

import type { Level } from './types';
import { LEVEL_CONFIG } from './types';

export interface TestAnswerForScoring {
	part: number; // 1=char, 2=vocab, 3=reading, 4=comprehension
	is_correct: boolean;
	reaction_time_ms?: number;
	question_content?: string;
}

export interface PartScores {
	characterScore: number;
	vocabScore: number;
	readingScore: number;
	comprehensionScore: number;
}

/** 四部分各自正确率（0-100） */
export function calculatePartScores(
	answers: TestAnswerForScoring[],
): PartScores {
	const p1 = answers.filter((a) => a.part === 1);
	const p2 = answers.filter((a) => a.part === 2);
	const p3 = answers.filter((a) => a.part === 3);
	const p4 = answers.filter((a) => a.part === 4);

	const c1 = p1.filter((a) => a.is_correct).length;
	const c2 = p2.filter((a) => a.is_correct).length;
	const c3 = p3.filter((a) => a.is_correct).length;
	const c4 = p4.filter((a) => a.is_correct).length;

	const characterScore = Math.round((c1 / Math.max(p1.length, 1)) * 100);
	const vocabScore = Math.round((c2 / Math.max(p2.length, 1)) * 100);
	const readingScore = Math.round((c3 / Math.max(p3.length, 1)) * 100);
	const comprehensionScore = Math.round((c4 / Math.max(p4.length, 1)) * 100);

	return { characterScore, vocabScore, readingScore, comprehensionScore };
}

/** Sampling 模式：四部分加权总分（0-100） */
export function calculateTotalScore(partScores: PartScores): number {
	const total =
		partScores.characterScore * 0.30 +
		partScores.vocabScore * 0.30 +
		partScores.readingScore * 0.20 +
		partScores.comprehensionScore * 0.20;
	return Math.round(total);
}

/**
 * Formal Test 模式总分（仅 char + vocab，各 50%）
 * 与 results/route.ts 行 88-91 一致
 */
export function calculateFormalTotalScore(partScores: PartScores): number {
	const charRate = partScores.characterScore / 100;
	const vocabRate = partScores.vocabScore / 100;
	return Math.round((charRate * 0.5 + vocabRate * 0.5) * 100);
}

/**
 * Formal Test 稳定识字量
 * stable_char_count = charRate * levelCharCount
 * 与 results/route.ts 行 93-96 一致
 */
export function calculateFormalStableCharCount(
	partScores: PartScores,
	level: Level,
): number {
	const charRate = partScores.characterScore / 100;
	const config = LEVEL_CONFIG[level];
	return Math.round(charRate * config.charCount);
}

/**
 * Formal Test 稳定词汇量
 * stable_vocab_count = vocabRate * levelVocabCount
 * 与 results/route.ts 行 93-96 一致
 */
export function calculateFormalStableVocabCount(
	partScores: PartScores,
	level: Level,
): number {
	const vocabRate = partScores.vocabScore / 100;
	const config = LEVEL_CONFIG[level];
	return Math.round(vocabRate * config.vocabCount);
}

/**
 * Sampling 模式：稳定识字量（含反应时间置信度加成）
 * 与 scoring.ts calculateStableCharCount 一致
 */
export function calculateStableCharCount(
	totalScore: number,
	level: Level,
	answers: TestAnswerForScoring[],
): number {
	const config = LEVEL_CONFIG[level];
	const baseRate = totalScore / 100;

	const p1Correct = answers.filter((a) => a.part === 1 && a.is_correct);
	const avgRT = p1Correct.length > 0
		? p1Correct.reduce((sum, a) => sum + (a.reaction_time_ms || 3000), 0) / p1Correct.length
		: 3000;

	let bonus = 0;
	if (avgRT < 2000) bonus = 0.05;
	else if (avgRT < 4000) bonus = 0.02;
	else if (avgRT > 8000) bonus = -0.05;

	const stableRate = Math.min(Math.max(baseRate + bonus, 0), 1);
	return Math.round(stableRate * config.charCount);
}

/** Sampling 模式：稳定词汇量 = stable_char_count * vocabMultiplier */
export function calculateStableVocabCount(
	stableCharCount: number,
	level: Level,
): number {
	const config = LEVEL_CONFIG[level];
	return Math.round(stableCharCount * config.vocabMultiplier);
}

/** 阅读星级（1-5） */
export function getReadingStars(totalScore: number): number {
	if (totalScore >= 90) return 5;
	if (totalScore >= 75) return 4;
	if (totalScore >= 60) return 3;
	if (totalScore >= 40) return 2;
	return 1;
}
