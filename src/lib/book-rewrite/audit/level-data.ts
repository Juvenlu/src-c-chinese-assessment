/**
 * 等级基础数据
 *
 * 从 questions.ts 中导入的 SRC 字库和词库，按等级分组。
 * Audit Engine 以此为唯一基准。
 */

import {
  SRC100_CHARS,
  SRC100_WORDS,
  SRC300_CHARS,
  SRC300_WORDS,
  SRC500_CHARS,
  SRC500_WORDS,
  SRC800_CHARS,
  SRC800_WORDS,
} from '../../questions';
import type { TargetLevel } from './types';

/** Audit Engine 版本号 */
export const AUDIT_ENGINE_VERSION = '1.0.0';

/** SRC 字库版本 */
export const SRC_CHAR_LIBRARY_VERSION = '1.2';

/** SRC 词库版本 */
export const SRC_VOCAB_LIBRARY_VERSION = '1.2';

/** 字库（Set 形式，快速查找） */
export const SRC_CHARS_BY_LEVEL: Record<TargetLevel, Set<string>> = {
  SRC100: new Set(SRC100_CHARS.filter((c: string) => c.length === 1)),
  SRC300: new Set(SRC300_CHARS.filter((c: string) => c.length === 1)),
  SRC500: new Set(SRC500_CHARS.filter((c: string) => c.length === 1)),
  SRC800: new Set(SRC800_CHARS.filter((c: string) => c.length === 1)),
};

/** 词库（Set 形式，快速查找） */
export const SRC_WORDS_BY_LEVEL: Record<TargetLevel, Set<string>> = {
  SRC100: new Set(SRC100_WORDS.filter((w: string) => w.length >= 2)),
  SRC300: new Set(SRC300_WORDS.filter((w: string) => w.length >= 2)),
  SRC500: new Set(SRC500_WORDS.filter((w: string) => w.length >= 2)),
  SRC800: new Set(SRC800_WORDS.filter((w: string) => w.length >= 2)),
};

/**
 * 故事核心专有名词集（Proper Names）。
 *
 * 这些是绝对不能拆分的专有名词：
 * - 人名（孙悟空、美猴王）
 * - 地名（花果山、水帘洞）
 * - 作品名（西游记）
 * - 核心宝物名（金箍棒、筋斗云）
 *
 * 用途：
 * 1. Generator Prompt 中告诉 LLM 不要拆分这些词
 * 2. Audit Engine 中检测专名碎片（如"孙悟"）并标记为 invalid
 * 3. Frontier 验证中排除专名碎片
 */
export const STORY_CORE_PROPER_NAMES: Set<string> = new Set([
  '孙悟空',
  '美猴王',
  '花果山',
  '水帘洞',
  '西游记',
  '金箍棒',
  '筋斗云',
  '七十二变',
]);

/**
 * 检测一个词是否是任意专名的前缀碎片（如"孙悟"是"孙悟空"的碎片）。
 * 用于 Audit Engine 过滤非法 LU 和无效 Frontier。
 *
 * 规则：长度≥2，且是某个更长专名的前缀，但本身不是完整专名。
 */
export function isProperNameFragment(word: string, properNames: Set<string> = STORY_CORE_PROPER_NAMES): boolean {
  if (word.length < 2) return false;
  if (properNames.has(word)) return false; // 完整专名不算碎片
  for (const name of properNames) {
    if (name.length > word.length && name.startsWith(word)) {
      return true;
    }
  }
  return false;
}

/**
 * 通用 Language Unit 白名单。
 *
 * 这些是不在 SRC 词库中、但符合 Language Unit v0.1-final 定义的常见自然词/固定表达。
 * 用于在 Audit 时识别"非 SRC 词库内的合格 Language Unit"。
 *
 * 注意：
 * - 不包含单字
 * - 不包含临时自由短语
 * - 不包含完整句子
 * - 随着审计范围扩大可以持续补充
 */
export const COMMON_LANGUAGE_UNITS: Set<string> = new Set([
  // 重叠词
  '看看', '听听', '说说', '走走', '跑跑', '跳跳', '慢慢', '轻轻', '悄悄', '冷冷',
  '热热', '甜甜', '好好', '高高', '大大', '小小', '多多', '少少',
  '跑一跑', '跳一跳', '看一看', '听一听', '说一说', '想一想', '尝一尝',
  '一片一片', '一个一个', '一只一只',
  // 后缀派生（-们 / -子 / -头）
  '猴子们', '孩子们', '朋友们', '人们', '我们', '你们', '他们',
  '石头', '木头', '里头', '外头', '前头', '后头',
  // 三字自然词
  '小猴子', '老猴子', '小老虎', '小兔子', '小孩子',
  // 专名 / 故事核心
  '美猴王', '孙悟空', '花果山', '水帘洞', '西游记',
  '金箍棒', '筋斗云', '七十二变',
  // 四字 / 成语 / 固定短语
  '下定决心', '越来越喜欢', '越来越高', '越来越快', '越来越多',
  '好不好', '行不行', '对不对', '是不是', '有没有', '为什么',
  // 补语结构
  '跳出来', '跑出来', '飞出来', '走出来', '拿出来', '放进去',
  '站起来', '坐下来', '走过来', '跑过去', '跳上去',
  // 其他常用词（审计中已确认属于自然 LU）
  // 注：已在 SRC300_WORDS 中的不再重复，只列词库外的
  '特别', '勇敢', '聪明', '满足', '欺负', '准备', '告诉',
  '合适', '世界', '中国', '每天', '京城', '东方',
  '好听', '一下子', '老猴',
  '什么', '兵器库', '眼睛亮了', '听说', '传来', '适合', '找到', '坐下',
  '冷冷', '悄悄',
]);

export interface LevelData {
  srcChars: Set<string>;
  srcWords: Set<string>;
  commonUnits: Set<string>;
  properNames: Set<string>;
}

const levelDataCache: Partial<Record<TargetLevel, LevelData>> = {};

export function getLevelData(level: TargetLevel): LevelData {
  if (levelDataCache[level]) return levelDataCache[level]!;
  const data: LevelData = {
    srcChars: SRC_CHARS_BY_LEVEL[level],
    srcWords: SRC_WORDS_BY_LEVEL[level],
    commonUnits: COMMON_LANGUAGE_UNITS,
    properNames: STORY_CORE_PROPER_NAMES,
  };
  levelDataCache[level] = data;
  return data;
}
