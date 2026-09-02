/**
 * 五类 Validation 模块
 *
 * 1. 阅读量（Reading Volume）
 * 2. 语言难度启发式（Language Difficulty）
 * 3. Frontier 存在性（Frontier Presence）
 * 4. Master Story 保持（Master Story Preservation）
 * 5. 图文一致性启发式（Image/Text Consistency）
 *
 * 注意：第 2、4、5 项只能做启发式检查，最终以人工审核为准。
 */

import type { Level } from '../types';
import type { RewritePage, ValidationResult, ValidationItem } from './types';
import { LEVEL_LANGUAGE_RULES } from './level-rules';

/** 统计中文汉字数量 */
export function countChineseChars(text: string): number {
  const matches = text.match(/[\u4e00-\u9fa5]/g);
  return matches ? matches.length : 0;
}

/** 1. 阅读量检查 */
export function validateReadingVolume(
  pages: RewritePage[],
  level: Level,
): ValidationItem {
  const totalChars = pages.reduce((sum, p) => sum + countChineseChars(p.text), 0);
  const rule = LEVEL_LANGUAGE_RULES[level];
  const passed = totalChars >= rule.targetReadingMin && totalChars <= rule.targetReadingMax;

  let detail = `全书 ${totalChars} 汉字，目标 ${rule.targetReadingMin}-${rule.targetReadingMax} 字`;
  if (totalChars < rule.targetReadingMin) {
    detail += `（偏少 ${rule.targetReadingMin - totalChars} 字）`;
  } else if (totalChars > rule.targetReadingMax) {
    detail += `（偏多 ${totalChars - rule.targetReadingMax} 字）`;
  }

  return {
    name: '阅读量',
    passed,
    detail,
    score: totalChars,
  };
}

/** 2. 语言难度启发式检查 */
export function validateLanguageDifficulty(
  pages: RewritePage[],
  level: Level,
  knownChars: Set<string>,
): ValidationItem {
  const fullText = pages.map((p) => p.text).join('\n');
  const totalChars = countChineseChars(fullText);

  // 找生僻字（不在已知字集合中，且不常见的字）
  const unknownChars = new Set<string>();
  for (const char of fullText) {
    if (/[\u4e00-\u9fa5]/.test(char) && !knownChars.has(char)) {
      unknownChars.add(char);
    }
  }

  const unknownRate = totalChars > 0 ? unknownChars.size / totalChars : 0;

  // 检查超长句（超过 40 字的句子）
  const sentences = fullText.split(/[。！？；\n]/).filter((s) => s.trim().length > 0);
  const longSentences = sentences.filter((s) => countChineseChars(s) > 40);

  const passed = unknownRate < 0.15 && longSentences.length <= 2; // 15% 以下未知字，长句不超过2句

  const detail = `未知字 ${unknownChars.size} 个（占比 ${(unknownRate * 100).toFixed(1)}%），超长句 ${longSentences.length} 句`;

  return {
    name: '语言难度（启发式）',
    passed,
    detail,
    score: Math.round((1 - unknownRate) * 100),
  };
}

/** 3. Frontier 存在性检查 */
export function validateFrontierPresence(
  pages: RewritePage[],
  frontiers: string[],
): ValidationItem {
  const fullText = pages.map((p) => p.text).join('\n');
  const results: string[] = [];
  let allPassed = true;

  for (const frontier of frontiers) {
    // 检查出现次数
    let count = 0;
    let idx = 0;
    while ((idx = fullText.indexOf(frontier, idx)) !== -1) {
      count++;
      idx += frontier.length;
    }

    const passed = count >= 2; // 目标：至少出现2次
    if (!passed) allPassed = false;
    results.push(`"${frontier}": 出现 ${count} 次${passed ? ' ✓' : ' ✗（不足2次）'}`);
  }

  return {
    name: 'Frontier 存在性',
    passed: allPassed,
    detail: results.join('；'),
  };
}

/** 4. Master Story 保持检查 */
export function validateMasterStoryPreservation(
  pages: RewritePage[],
  originalPages: { page: number; text: string }[],
): ValidationItem {
  // 检查核心人物和事件关键词是否保留
  const keyEntities = ['孙悟空', '美猴王', '花果山', '猴子'];

  const rewriteText = pages.map((p) => p.text).join('\n');
  const originalText = originalPages.map((p) => p.text).join('\n');

  const missingEntities: string[] = [];
  for (const entity of keyEntities) {
    if (originalText.includes(entity) && !rewriteText.includes(entity)) {
      missingEntities.push(entity);
    }
  }

  // 检查页数是否一致
  const pageCountMatch = pages.length === originalPages.length;

  // 检查每页内容是否非空且有意义
  const emptyPages = pages.filter((p) => countChineseChars(p.text) < 5).length;

  const passed = missingEntities.length === 0 && pageCountMatch && emptyPages === 0;

  const details: string[] = [];
  if (missingEntities.length > 0) details.push(`缺失核心人物/事物：${missingEntities.join('、')}`);
  if (!pageCountMatch) details.push(`页数不匹配（原文${originalPages.length}页，改写${pages.length}页）`);
  if (emptyPages > 0) details.push(`${emptyPages}页内容过短`);

  return {
    name: 'Master Story 保持',
    passed,
    detail: details.length > 0 ? details.join('；') : '核心人物保留，页数一致',
  };
}

/** 5. 图文一致性（文本级启发式） */
export function validateImageTextConsistency(
  pages: RewritePage[],
): ValidationItem {
  // 纯文本层面无法真正验证图文一致
  // 只做基本检查：每页都有图片且文本非空
  const noImagePages = pages.filter((p) => !p.image_url).length;
  const shortPages = pages.filter((p) => countChineseChars(p.text) < 8).length;

  const passed = noImagePages === 0 && shortPages === 0;

  const details: string[] = [];
  if (noImagePages > 0) details.push(`${noImagePages}页缺少图片`);
  if (shortPages > 0) details.push(`${shortPages}页文本过短`);

  return {
    name: '图文一致性（启发式）',
    passed,
    detail: details.length > 0
      ? details.join('；') + '（注：最终图文一致需人工确认）'
      : '页数完整（注：最终图文一致需人工确认）',
  };
}

/** 运行全部五项 Validation */
export function runAllValidations(
  pages: RewritePage[],
  level: Level,
  knownChars: string[],
  originalPages: { page: number; text: string }[],
  frontiers: string[],
): ValidationResult {
  const knownSet = new Set(knownChars);

  const items: ValidationItem[] = [
    validateReadingVolume(pages, level),
    validateLanguageDifficulty(pages, level, knownSet),
    validateFrontierPresence(pages, frontiers),
    validateMasterStoryPreservation(pages, originalPages),
    validateImageTextConsistency(pages),
  ];

  const totalChars = pages.reduce((sum, p) => sum + countChineseChars(p.text), 0);
  const passedCount = items.filter((i) => i.passed).length;
  const overallPass = passedCount >= 4; // 5项中至少4项通过（允许1项启发式不通过）

  return {
    overall_pass: overallPass,
    total_chars: totalChars,
    items,
    summary: `${passedCount}/5 项通过（${items.filter(i => i.passed).map(i => i.name).join('、')}）`,
  };
}
