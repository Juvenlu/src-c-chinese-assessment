/**
 * Level Mapping Service —— SRC 等级映射唯一来源
 *
 * ⚠️  重要：所有 Level 相关业务计算必须通过本 Service 完成。
 * 前端不得自行计算 Level 顺序、next_level、recommended_test_level 等。
 *
 * 本文件是 Level 业务规则的 Single Source of Truth。
 */

import type { Level, RJBLevel } from './types';

/**
 * SRC 等级顺序（从低到高）
 */
export const LEVEL_SEQUENCE: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];

/**
 * 人教版等级顺序（从低到高）
 */
export const RJB_LEVEL_SEQUENCE: RJBLevel[] = ['RJB100', 'RJB300', 'RJB500', 'RJB800'];

/**
 * SRC ↔ 人教版 映射
 */
export const SRC_TO_RJB: Record<Level, RJBLevel> = {
  SRC100: 'RJB100',
  SRC300: 'RJB300',
  SRC500: 'RJB500',
  SRC800: 'RJB800',
};

export const RJB_TO_SRC: Record<RJBLevel, Level> = {
  RJB100: 'SRC100',
  RJB300: 'SRC300',
  RJB500: 'SRC500',
  RJB800: 'SRC800',
};

/**
 * 获取等级在序列中的索引（0-based）
 */
export function getLevelIndex(level: Level): number {
  return LEVEL_SEQUENCE.indexOf(level);
}

/**
 * 比较两个等级：a < b → -1, a == b → 0, a > b → 1
 */
export function compareLevels(a: Level, b: Level): -1 | 0 | 1 {
  const ia = getLevelIndex(a);
  const ib = getLevelIndex(b);
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

/**
 * 取下一级别
 * @returns 下一级别；若已是最高级，返回 null
 */
export function getNextLevel(current: Level): Level | null {
  const idx = getLevelIndex(current);
  if (idx < 0 || idx >= LEVEL_SEQUENCE.length - 1) return null;
  return LEVEL_SEQUENCE[idx + 1];
}

/**
 * 取上一级别
 * @returns 上一级别；若已是最低级，返回 null
 */
export function getPrevLevel(current: Level): Level | null {
  const idx = getLevelIndex(current);
  if (idx <= 0) return null;
  return LEVEL_SEQUENCE[idx - 1];
}

/**
 * 是否为合法的 SRC Level
 */
export function isValidLevel(level: string | null | undefined): level is Level {
  if (!level) return false;
  return LEVEL_SEQUENCE.includes(level as Level);
}

/**
 * 将数字（识字量）映射到 SRC 等级
 * 规则：≥ 800 → SRC800, ≥ 500 → SRC500, ≥ 300 → SRC300, 其余 → SRC100
 */
export function numToLevel(num: number): Level {
  if (num >= 800) return 'SRC800';
  if (num >= 500) return 'SRC500';
  if (num >= 300) return 'SRC300';
  return 'SRC100';
}

/**
 * 计算推荐的正式测试级别（基于快速测评结果）
 *
 * 规则：
 * - 使用 reading_base 作为主要依据
 * - reading_base 向下取最近一级作为推荐级别（让孩子从略低于自身水平的级别开始，建立信心）
 * - 最低为 SRC100
 */
export function getRecommendedTestLevel(opts: {
  reading_base?: number;
  character_level_u?: number;
  word_level_u?: number;
}): Level {
  const base = opts.reading_base
    ?? opts.character_level_u
    ?? opts.word_level_u
    ?? 100;
  return numToLevel(base);
}

/**
 * 计算当前级别进度百分比（0 ~ 100）
 * 用于进度条展示
 *
 * 规则：取当前级与下一级之间的相对位置
 * 例如：num=400，介于 SRC300（0%）和 SRC500（100%）之间 → 50%
 */
export function getLevelProgress(num: number): number {
  if (num <= 100) return 0;
  if (num >= 800) return 100;

  const level = numToLevel(num);
  const idx = getLevelIndex(level);

  // 当前级别的"起始字数量"和"下一级起始字数量"
  const levelNums = [100, 300, 500, 800];
  const currentStart = levelNums[idx];
  const nextStart = levelNums[idx + 1] ?? 800;

  if (nextStart === currentStart) return 100;
  const pct = ((num - currentStart) / (nextStart - currentStart)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * 测评状态
 * - not_started: 尚未完成任何测试
 * - estimated: 已完成直接测试，但尚未完成正式测试
 * - confirmed: 已完成正式测试
 */
export type AssessmentStatus = 'not_started' | 'estimated' | 'confirmed';

/**
 * 根据正式测试和快速测评结果，派生测评状态
 */
export function deriveAssessmentStatus(opts: {
  hasFormalTest: boolean;
  hasQuickResult: boolean;
}): AssessmentStatus {
  if (opts.hasFormalTest) return 'confirmed';
  if (opts.hasQuickResult) return 'estimated';
  return 'not_started';
}

/**
 * 获取当前正式级别（confirmed_level）
 * 有正式测试返回正式级别；否则返回 null
 */
export function getConfirmedLevel(latestFormal: { level: string } | null | undefined): Level | null {
  if (!latestFormal) return null;
  if (isValidLevel(latestFormal.level)) return latestFormal.level;
  return null;
}

/**
 * 获取预估级别（estimated_level）
 * 优先依据 character_level（Quick Assessment 主估算等级）
 * 次选 character_level_u（区间上限，向后兼容没有 character_level 的旧数据）
 * 最后 fallback 到 reading_base
 * 与 getRecommendedTestLevel 不同：推荐测试级别更保守（用 reading_base），
 * 而 estimated_level 反映 Quick Assessment 的综合估算主水位
 */
export function getEstimatedLevel(opts: {
  reading_base?: number;
  character_level_u?: number;
  character_level?: number;
}): Level | null {
  if (opts.character_level) {
    const lvl = numToLevel(opts.character_level);
    if (lvl) return lvl;
  }
  if (opts.character_level_u) {
    const lvl = numToLevel(opts.character_level_u);
    if (lvl) return lvl;
  }
  if (opts.reading_base) {
    const lvl = numToLevel(opts.reading_base);
    if (lvl) return lvl;
  }
  return null;
}

/**
 * 获取当前展示用级别
 * 优先 confirmed_level，其次 estimated_level，最低 SRC100
 * 注意：仅用于展示，不得作为正式级别使用
 */
export function getDisplayLevel(opts: {
  confirmedLevel: Level | null;
  estimatedLevel: Level | null;
}): Level {
  return opts.confirmedLevel ?? opts.estimatedLevel ?? 'SRC100';
}
