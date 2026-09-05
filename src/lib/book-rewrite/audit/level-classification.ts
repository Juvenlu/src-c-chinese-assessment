/**
 * I / I+1A / I+1B / High-load 四级分类
 *
 * 分类规则：
 * - I：在目标等级的 SRC 词库内
 * - I+1A：不在 SRC 词库，且所有汉字都在 SRC 字库内（0 个外字）
 * - I+1B：不在 SRC 词库，且恰好 1 个汉字在 SRC 字库外
 * - High-load：不在 SRC 词库，且 ≥2 个汉字在 SRC 字库外
 *
 * 分类优先级：I > I+1A > I+1B > High-load
 */

import { SRC_CHARS_BY_LEVEL, SRC_WORDS_BY_LEVEL } from './level-data';
import { isCJK } from './character-audit';
import type { Level, TargetLevel } from './types';

/**
 * 计算一个 Language Unit 的外字数量（不在目标等级字库中的汉字数）。
 */
export function countExternalChars(unit: string, charSet: Set<string>): number {
  let count = 0;
  for (const ch of unit) {
    if (isCJK(ch) && !charSet.has(ch)) count++;
  }
  return count;
}

/**
 * 根据字库和词库对单个 Language Unit 进行四级分类。
 *
 * @param unit Language Unit 字符串
 * @param targetLevel 目标等级
 * @param customKnownChars 可选：自定义已知字集（用于 child-specific 审计）
 * @param customKnownWords 可选：自定义已知词集（用于 child-specific 审计）
 */
export function classifyLevel(
  unit: string,
  targetLevel: TargetLevel,
  customKnownChars?: Set<string>,
  customKnownWords?: Set<string>,
): Level {
  const charSet = customKnownChars ?? SRC_CHARS_BY_LEVEL[targetLevel];
  const wordSet = customKnownWords ?? SRC_WORDS_BY_LEVEL[targetLevel];

  if (wordSet.has(unit)) {
    return 'I';
  }

  const outCount = countExternalChars(unit, charSet);

  if (outCount === 0) return 'I+1A';
  if (outCount === 1) return 'I+1B';
  return 'High-load';
}

/**
 * 计算 occurrence 占比
 */
export function calcRate(count: number, total: number): number {
  if (total === 0) return 0;
  return count / total;
}
