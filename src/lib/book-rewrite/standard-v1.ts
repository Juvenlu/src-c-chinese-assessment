// ============================================================
// SRC i+1 定制绘本 V1.0 — Production Standard
// ============================================================
// 唯一权威配置来源。Generation Prompt 和 Audit Engine 都应读取此文件。
// 数字代表 V1.0 生产控制标准，不是最终教育学结论。
// 未来升级时创建新标准对象，不要覆盖 V1。
// ============================================================

import type { TargetLevel } from "./audit/types";

export type AuditStatus = "PASS" | "WARNING" | "STRONG_WARNING";

/** 单等级标准 */
export interface LevelStandard {
  /** 目标篇幅（汉字数）区间 */
  length_target_min: number;
  length_target_max: number;
  /** 技术允许上限（超过则 Warning） */
  length_allowed_max: number;
  /** 外字出现率上限（%） */
  external_char_rate_max: number;
  /** 外字率强警告上限（%） */
  external_char_rate_strong_max: number;
  /** I+1A 目标区间（%） */
  i_plus_1a_target_min: number;
  i_plus_1a_target_max: number;
  /** High-load 上限（%） */
  high_load_rate_max: number;
  /** 单页最高负荷上限（%，基于外字率） */
  page_peak_load_max: number;
  /** +1 词推荐重复次数 */
  plus_one_repeat_recommended: number;
}

/** V1.0 全等级标准 */
export const SRC_I_PLUS_ONE_STANDARD_V1: Record<TargetLevel, LevelStandard> = {
  SRC100: {
    length_target_min: 150,
    length_target_max: 220,
    length_allowed_max: 240,
    external_char_rate_max: 12,
    external_char_rate_strong_max: 15,
    i_plus_1a_target_min: 20,
    i_plus_1a_target_max: 30,
    high_load_rate_max: 12,
    page_peak_load_max: 20,
    plus_one_repeat_recommended: 2,
  },
  SRC300: {
    length_target_min: 300,
    length_target_max: 350,
    length_allowed_max: 380,
    external_char_rate_max: 12,
    external_char_rate_strong_max: 15,
    i_plus_1a_target_min: 20,
    i_plus_1a_target_max: 30,
    high_load_rate_max: 12,
    page_peak_load_max: 20,
    plus_one_repeat_recommended: 2,
  },
  SRC500: {
    length_target_min: 400,
    length_target_max: 500,
    length_allowed_max: 540,
    external_char_rate_max: 12,
    external_char_rate_strong_max: 15,
    i_plus_1a_target_min: 20,
    i_plus_1a_target_max: 30,
    high_load_rate_max: 12,
    page_peak_load_max: 20,
    plus_one_repeat_recommended: 2,
  },
  SRC800: {
    length_target_min: 550,
    length_target_max: 700,
    length_allowed_max: 750,
    external_char_rate_max: 12,
    external_char_rate_strong_max: 15,
    i_plus_1a_target_min: 20,
    i_plus_1a_target_max: 30,
    high_load_rate_max: 12,
    page_peak_load_max: 20,
    plus_one_repeat_recommended: 2,
  },
};

/** 获取指定等级的 V1.0 标准 */
export function getStandardV1(level: TargetLevel): LevelStandard {
  return SRC_I_PLUS_ONE_STANDARD_V1[level];
}
