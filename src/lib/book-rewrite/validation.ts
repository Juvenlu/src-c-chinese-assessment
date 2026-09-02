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

/** 2. 语言难度启发式检查
 *
 * 注意：已知字集合（knownChars）是正式测试中抽样答对的字（如94个），
 * 不等于孩子完整识字量。因此：
 * - 不再基于 knownChars 计算 "unknown character rate" 并据此判失败
 * - 改为基于等级语言规则做启发式检查：句子长度、句式复杂度、生僻字密度
 * - knownChars 命中情况仅作为 info 记录，不影响 pass/fail
 */
export function validateLanguageDifficulty(
  pages: RewritePage[],
  level: Level,
  knownChars: Set<string>,
): ValidationItem {
  const fullText = pages.map((p) => p.text).join('\n');
  const totalChars = countChineseChars(fullText);

  // 句子分析
  const sentences = fullText.split(/[。！？；\n]/).filter((s) => s.trim().length > 0);
  const sentenceCount = sentences.length;
  const avgSentenceLen = sentenceCount > 0
    ? Math.round(totalChars / sentenceCount)
    : 0;

  // 超长句（按等级设阈值）
  const rule = LEVEL_LANGUAGE_RULES[level];
  const longSentenceThreshold = level === 'SRC100' ? 20
    : level === 'SRC300' ? 32
    : level === 'SRC500' ? 45
    : 55;
  const longSentences = sentences.filter((s) => countChineseChars(s) > longSentenceThreshold);

  // 极短句（1-2字的句子过多可能是碎片化）
  const veryShortSentences = sentences.filter((s) => countChineseChars(s) <= 2);

  // 生僻字启发式检测（基于Unicode CJK扩展区，简单版）
  // 常见字范围：\u4e00-\u7a00（约常用字前半段）
  const rareChars = new Set<string>();
  for (const char of fullText) {
    if (/[\u7a01-\u9fff]/.test(char)) {
      rareChars.add(char);
    }
  }
  const rareCharRate = totalChars > 0 ? rareChars.size / totalChars : 0;

  // 已知字命中（仅作 info 展示，不参与 pass/fail 判断）
  let observedKnownCount = 0;
  if (knownChars.size > 0) {
    const seen = new Set<string>();
    for (const char of fullText) {
      if (/[\u4e00-\u9fa5]/.test(char) && knownChars.has(char) && !seen.has(char)) {
        observedKnownCount++;
        seen.add(char);
      }
    }
  }

  // 通过条件：句子长度基本合理 + 没有过多长句 + 生僻字比例低
  // 这是启发式检查，阈值较宽松
  const passed = longSentences.length <= 3
    && rareCharRate < 0.05
    && avgSentenceLen > 0;

  const details: string[] = [];
  details.push(`平均句长 ${avgSentenceLen} 字（目标约 ${rule.avgSentenceLen}）`);
  details.push(`超长句 ${longSentences.length} 句（>${longSentenceThreshold}字）`);
  details.push(`生僻字 ${rareChars.size} 个（占 ${(rareCharRate * 100).toFixed(1)}%）`);
  if (knownChars.size > 0) {
    details.push(`抽样已知字命中 ${observedKnownCount}/${knownChars.size} 个（仅供参考）`);
  }

  return {
    name: '语言难度（启发式）',
    passed,
    detail: details.join('；'),
    score: Math.min(100, Math.max(0, 100 - longSentences.length * 10 - rareCharRate * 200)),
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
