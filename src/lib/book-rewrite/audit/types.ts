/**
 * Audit Engine V1 类型定义
 *
 * 与 Language Unit v0.1-final + 四级分类 (I / I+1A / I+1B / High-load) 对齐
 */

/** 目标等级 */
export type TargetLevel = 'SRC100' | 'SRC300' | 'SRC500' | 'SRC800';

/** 四级分类 */
export type LevelClass = 'I' | 'I+1A' | 'I+1B' | 'High-load';

/** Language Unit 属性标签 */
export type UnitAttribute =
  | 'ordinary_word'        // 普通词
  | 'reduplication'        // 重叠词（看看、慢慢、跑一跑）
  | 'suffix_derivation'    // 后缀派生（猴子们、石头、木头）
  | 'three_char_word'      // 三字自然词
  | 'proper_name'          // 专有名词（孙悟空、花果山）
  | 'idiom'                // 成语/四字固定短语
  | 'complement_structure' // 补语结构（跳出来）
  | 'fixed_collocation'    // 固定搭配（越来越喜欢）
  | 'src_vocabulary'       // SRC 词库内词
  | 'story_core';          // 故事核心专有名词（西游记）

/** 单个 Language Unit */
export interface LanguageUnit {
  /** 词/短语本身 */
  unit: string;
  /** 出现次数 */
  occurrences: number;
  /** 出现页码列表（1-based） */
  pages: number[];
  /** 四级分类 */
  level: LevelClass;
  /** SRC 外字数量 */
  external_char_count: number;
  /** 属性标签 */
  attributes: UnitAttribute[];
}

/** 字符层审计结果 */
export interface CharacterAudit {
  /** 总汉字数（occurrence） */
  total_chinese_chars: number;
  /** SRC 内字出现次数 */
  src_in_occurrences: number;
  /** SRC 外字出现次数 */
  src_out_occurrences: number;
  /** SRC 内字去重数 */
  src_in_unique: number;
  /** SRC 外字去重数 */
  src_out_unique: number;
  /** 外字出现率 = src_out_occurrences / total_chinese_chars */
  external_char_occurrence_rate: number;
  /** 外字列表（unique） */
  external_chars: string[];
}

/** 语言单位层审计结果 */
export interface LanguageUnitAudit {
  /** 唯一 Language Unit 数 */
  unique_units: number;
  /** 总出现次数 */
  total_occurrences: number;
  /** 平均长度（汉字数） */
  average_unit_length: number;
  /** LU 密度 = 总出现次数 / 总汉字数 */
  unit_density: number;
  /** 各级别出现次数 */
  occurrence_counts: Record<LevelClass, number>;
  /** 各级别出现率 */
  occurrence_rates: Record<LevelClass, number>;
  /** 各级别唯一数 */
  unique_counts: Record<LevelClass, number>;
  /** 完整 Unit 列表 */
  units: LanguageUnit[];
}

/** 重复统计结果 */
export interface RepetitionAudit {
  /** +1 词总唯一数（I+1A + I+1B + High-load） */
  total_plus_one_unique: number;
  /** +1 词总出现次数 */
  total_plus_one_occurrences: number;
  /** 出现 1 次的 +1 唯一数 */
  one_time_unique: number;
  /** 出现 2 次的 +1 唯一数 */
  two_time_unique: number;
  /** 出现 3 次的 +1 唯一数 */
  three_time_unique: number;
  /** 出现 4 次及以上的 +1 唯一数 */
  four_plus_time_unique: number;
  /** 重复 +1 唯一数（出现≥2次） */
  repeated_unique: number;
  /** 一次性 +1 唯一数（出现1次） */
  one_time_unique_count: number;
  /** 详细分布（按次数倒序） */
  distribution: { unit: string; level: LevelClass; occurrences: number }[];
}

/** 单页审计结果 */
export interface PageAuditItem {
  page_number: number;
  chinese_chars: number;
  src_out_occurrences: number;
  external_char_rate: number;
  lu_occurrences: number;
  level_counts: Record<LevelClass, number>;
  units: { unit: string; level: LevelClass }[];
}

/** 分页审计结果 */
export interface PageAudit {
  pages: PageAuditItem[];
  max_external_char_rate_page: number;
  max_external_char_rate: number;
  max_high_load_page: number;
  max_high_load_count: number;
  /** 页面外字率标准差（粗略衡量波动） */
  external_rate_std_dev: number;
}

/** Frontier 单项 */
export interface FrontierAuditItem {
  unit: string;
  page: number;
  level: LevelClass;
  valid: boolean;
  invalid_reason?: string;
}

/** Frontier 审计结果 */
export interface FrontierAudit {
  total_frontier: number;
  valid_frontier: number;
  invalid_frontier: number;
  frontier_occurrences: number;
  items: FrontierAuditItem[];
  level_breakdown: Record<LevelClass, number>;
}

/** 孩子个性化审计结果 */
export interface ChildAudit {
  child_id: string;
  weak_character_signals: string[];
  weak_word_signals: string[];
  /** 与通用基线的差异摘要 */
  delta_from_baseline: {
    /** 级别发生变化的 LU 数量 */
    diverged_units: number;
    /** I 级减少的出现次数 */
    i_decreased_occurrences: number;
    /** High-load 增加的出现次数 */
    high_load_increased_occurrences: number;
  };
}

/** Audit Engine 完整结果 */
export interface AuditResult {
  engine_version: string;
  src_char_library_version: string;
  src_vocab_library_version: string;
  target_level: TargetLevel;
  character: CharacterAudit;
  language_units: LanguageUnitAudit;
  repetition: RepetitionAudit;
  pages: PageAudit;
  frontiers: FrontierAudit;
  child: ChildAudit | null;
  summary: {
    total_pages: number;
    total_chinese_chars: number;
    external_char_rate: number;
    i_occurrence_rate: number;
    i_plus_1a_occurrence_rate: number;
    i_plus_1b_occurrence_rate: number;
    high_load_occurrence_rate: number;
    narrow_i_plus_1_rate: number; // I+1A + I+1B
    non_i_rate: number; // I+1A + I+1B + High-load
  };
}

/** runAudit 输入参数 */
export interface AuditOptions {
  /** 分页文本（RewritePage[] 或 string[] 或含 text/page 字段的对象） */
  pages: Array<{ page?: number; text: string }> | string[];
  /** 目标等级 */
  targetLevel: TargetLevel;
  /** 孩子已知字（可选，用于 child-specific audit） */
  knownCharacters?: Set<string>;
  /** 孩子已知词（可选） */
  knownWords?: Set<string>;
  /** 弱项字信号（替代 knownCharacters，用于 confirmed_level 基线 + 弱项微调） */
  weakCharacters?: string[];
  /** 弱项词信号 */
  weakWords?: string[];
  /** 系统标记的 Frontier 词 */
  frontiers?: string[];
  /** 原始 Master 页（用于对比，可选） */
  originalPages?: Array<{ page?: number; text: string }> | string[];
  /** 孩子 ID（用于持久化标识） */
  childId?: string;
}

/** 版本常量 */
export const AUDIT_ENGINE_VERSION = '1.0.0';
export const SRC_CHAR_LIBRARY_VERSION = 'v1.2';
export const SRC_VOCAB_LIBRARY_VERSION = 'v1.2';
