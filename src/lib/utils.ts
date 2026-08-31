import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { TestMode } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 归一化测试模式
 * - 'formal' / 'full' → 'formal'（正式逐字测试）
 * - 'sampling' → 'sampling'（抽测闯关）
 * - 其他值 → 默认 'sampling'（安全回退，但调用方应尽量传合法值）
 *
 * 目的：历史上 URL 和部分代码使用 'full' 表示正式测试，数据库标准字段为 'formal'。
 * 对外入口可以兼容 'full'，但进入业务逻辑后统一为 'formal'。
 */
export function normalizeTestMode(rawMode: string | null | undefined): TestMode {
  if (!rawMode) return 'sampling';
  const lower = rawMode.toLowerCase();
  if (lower === 'formal' || lower === 'full') return 'formal';
  if (lower === 'sampling') return 'sampling';
  return 'sampling'; // 非法值安全回退到抽测
}
