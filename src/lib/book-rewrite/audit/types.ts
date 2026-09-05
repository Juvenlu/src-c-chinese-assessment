// ============================================================
// SRC Audit Engine V1 - Type Definitions
// ============================================================

export type TargetLevel = "SRC100" | "SRC300" | "SRC500" | "SRC800";

// 四级分类
export type LevelClass = "I" | "I+1A" | "I+1B" | "High-load";

// Language Unit 属性
export type UnitAttribute =
  | "ordinary_word"        // 普通词
  | "reduplication"        // 叠词/叠用
  | "suffix_derivation"    // 后缀派生（～们 / ～子 / ～头）
  | "three_char_word"      // 三字词
  | "proper_name"          // 专有名词（人名/地名/作品名）
  | "idiom"                // 成语
  | "complement_structure" // 结果/趋向补语结构（～出来 / ～起来 / ～跑了）
  | "fixed_collocation"    // 固定搭配（越来越 / 一...就...）
  | "src_vocabulary"       // SRC 词库收录
  | "story_core";          // 故事核心词

import type { RewritePage } from "../types";
import type { AuditStatus } from "../standard-v1";

// ------------------------------------------------------------
// Length Audit (V1.0 标准)
// ------------------------------------------------------------

export interface LengthAudit {
  actual: number;              // 实际汉字数（不含标点）
  target_min: number;          // 目标下限
  target_max: number;          // 目标上限
  allowed_max: number;         // 允许上限
  status: AuditStatus;         // PASS / WARNING / STRONG_WARNING
  in_target_range: boolean;    // 是否在目标区间
  in_allowed_range: boolean;   // 是否在允许范围内
}

// ------------------------------------------------------------
// Character Audit
// ------------------------------------------------------------

export interface CharacterAudit {
  total_chinese_chars: number;        // 总中文字符数（occurrence）
  src_in_occurrences: number;         // SRC内字出现次数
  src_out_occurrences: number;        // SRC外字出现次数
  src_in_unique_chars: number;        // SRC内字去重数
  src_out_unique_chars: number;       // SRC外字去重数
  external_char_occurrence_rate: number; // 外字出现率 (src_out/total * 100)
  src_out_unique_char_list?: string[]; // 外字列表（可选）
}

// ------------------------------------------------------------
// Language Unit
// ------------------------------------------------------------

export interface LanguageUnitItem {
  unit: string;                   // LU 文本
  level: LevelClass;              // 四级分类
  attributes: UnitAttribute[];    // 属性标签
  occurrence_count: number;       // 出现次数
}

export interface LanguageUnitAudit {
  total_occurrences: number;      // 总 LU 出现次数
  unique_units: number;           // 去重 LU 数
  i_occurrences: number;          // I 级出现次数
  i_plus_1a_occurrences: number;  // I+1A 出现次数
  i_plus_1b_occurrences: number;  // I+1B 出现次数
  high_load_occurrences: number;  // High-load 出现次数
  i_rate: number;                 // I 率（%）
  i_plus_1a_rate: number;         // I+1A 率（%）
  i_plus_1b_rate: number;         // I+1B 率（%）
  high_load_rate: number;         // High-load 率（%）
  narrow_i_plus_1_rate: number;   // Narrow i+1 率 = I+1A + I+1B（%）
  units: LanguageUnitItem[];      // 全部 LU 明细
}

// ------------------------------------------------------------
// Repetition Audit
// ------------------------------------------------------------

export interface RepetitionAudit {
  plus1_unique_total: number;     // +1 词去重总数（I+1A + I+1B）
  plus1_total_occurrences: number;// +1 词总出现次数
  one_time: number;               // 只出现1次的 +1 词数
  two_time: number;               // 出现2次的 +1 词数
  three_time: number;             // 出现3次的 +1 词数
  four_plus: number;              // 出现4次+的 +1 词数
  repeated_unique: number;        // 重复出现（≥2次）的 +1 词去重数
  repeated_occurrences: number;   // 重复出现总次数
}

// ------------------------------------------------------------
// Page-level Audit
// ------------------------------------------------------------

export interface PageAuditItem {
  page_number: number;            // 页码
  chinese_chars: number;          // 中文字符数
  src_in_chars: number;           // SRC内字
  src_out_chars: number;          // SRC外字
  external_char_rate: number;     // 外字率（即 page load）
  lu_total: number;               // LU 总个数
  i_lu: number;                   // I 级 LU 数
  i_plus_1a_lu: number;           // I+1A LU 数
  i_plus_1b_lu: number;           // I+1B LU 数
  high_load_lu: number;           // High-load LU 数
  page_load: number;              // = external_char_rate，同义字段方便阅读
  page_load_status: AuditStatus;  // PASS / WARNING
}

export interface PageAuditResult {
  pages: PageAuditItem[];         // 每页明细
  total_pages: number;            // 总页数
  avg_chars_per_page: number;     // 平均每页字数
  max_external_char_rate: number; // 最高外字率
  peak_page_number: number;       // 外字率最高页（= peak load page）
  max_high_load_per_page: number; // 单页最高 High-load 数
  high_load_peak_page: number;    // High-load 峰值页
  max_page_load: number;          // 单页最高负荷（= max_external_char_rate）
  max_page_number: number;        // 最高负荷页码
  page_peak_status: AuditStatus;  // 峰值页状态
}

// ------------------------------------------------------------
// Frontier Audit
// ------------------------------------------------------------

export interface FrontierAuditItem {
  unit: string;                   // Frontier 词
  level: LevelClass;              // 四级分类
  is_valid: boolean;              // 是否为有效 Frontier（非碎片/非伪词）
  invalid_reason: string | null;  // 无效原因
  occurrence_count: number;       // 出现次数
}

export interface FrontierAuditResult {
  total_frontier_units: number;   // Frontier 总数
  valid_frontier_count: number;   // 有效 Frontier 数
  invalid_frontier_count: number; // 无效 Frontier 数
  i_plus_1a_frontier: number;     // 有效 I+1A Frontier 数
  i_plus_1b_frontier: number;     // 有效 I+1B Frontier 数
  high_load_frontier: number;     // 有效 High-load Frontier 数
  items: FrontierAuditItem[];     // 明细
}

// ------------------------------------------------------------
// Child-specific Audit
// ------------------------------------------------------------

export interface ChildAuditResult {
  known_character_count: number;
  weak_char_signals_count: number;
  known_vocabulary_count: number;
  child_specific_plus_1: LanguageUnitItem[];  // 针对孩子的 +1 词
  child_specific_high_load: LanguageUnitItem[]; // 针对孩子的高负荷词
  weakness_related_units: LanguageUnitItem[]; // 与弱信号相关的单位
}

// ------------------------------------------------------------
// Full Audit Result
// ------------------------------------------------------------

export interface AuditSummary {
  total_chinese_characters: number;
  external_char_occurrence_rate: number;
  total_lu_occurrences: number;
  i_rate: number;
  i_plus_1a_rate: number;
  i_plus_1b_rate: number;
  high_load_rate: number;
  plus1_total_occurrences: number;
  repeated_plus1_unique: number;
  repeated_plus1_occurrences: number;
  valid_frontier_count: number | null;
  invalid_frontier_count: number | null;
  max_page_external_rate: number;
  peak_page: number;
}

export interface AuditInput {
  pages: RewritePage[];
  target_level: TargetLevel;
  frontiers?: string[];
  known_characters?: Set<string>;
  weak_char_signals?: Set<string>;
  known_vocabulary?: Set<string>;
  child_id?: string;
  rewrite_id?: number;
}

export interface AuditResult {
  engine_version: string;
  src_char_library_version: string;
  src_vocab_library_version: string;
  target_level: TargetLevel;
  rewrite_id?: number;
  child_id?: string;
  length_audit: LengthAudit;
  character_audit: CharacterAudit;
  language_unit_audit: LanguageUnitAudit;
  repetition_audit: RepetitionAudit;
  page_audit: PageAuditResult;
  frontier_audit: FrontierAuditResult | null;
  child_audit: ChildAuditResult | null;
  summary: AuditSummary;
}

