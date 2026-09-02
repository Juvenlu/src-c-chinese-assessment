/**
 * 绘本改写相关类型定义
 *
 * 旁路模块：不侵入 SRC 核心测字架构，只读取 confirmed_level 和 known_characters
 */
import type { Level } from '../types';

/** 改写版本状态 */
export type RewriteStatus =
  | 'ai_draft'       // AI 生成的草稿
  | 'review'         // 审核中
  | 'final'          // 已确认发布
  | 'rejected'       // 被驳回
  | 'failed';        // 生成失败

/** 单页改写结果 */
export interface RewritePage {
  page: number;
  text: string;
  frontier: string[];
  image_url?: string;
  original_text?: string;
}

/** Validation 单项结果 */
export interface ValidationItem {
  name: string;
  passed: boolean;
  detail: string;
  score?: number;
}

/** Validation 汇总 */
export interface ValidationResult {
  overall_pass: boolean;
  total_chars: number;
  items: ValidationItem[];
  summary: string;
}

/** 生成参数 */
export interface GenerationParams {
  model: string;
  temperature: number;
  level_rules: string;
  target_reading_min: number;
  target_reading_max: number;
  prompt_version: string;
}

/** 绘本改写版本 */
export interface BookRewriteVersion {
  id: number;
  episode_id: number;
  target_level: Level;
  pages_json: RewritePage[];
  frontier_targets: string[];
  status: RewriteStatus;
  generation_params: GenerationParams | null;
  validation_result: ValidationResult | null;
  version: number;
  retry_count: number;
  failure_reason: string | null;
  child_id: string | null;
  created_at: string;
  finalized_at: string | null;
  finalized_by: string | null;
}
