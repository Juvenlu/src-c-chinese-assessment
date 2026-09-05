/**
 * SRC Audit Engine V1 — 主入口
 *
 * 统一入口：
 *   runAudit({ pages, targetLevel, ... }) → AuditResult
 *
 * 包含：
 * - Character Audit
 * - Language Unit Audit
 * - Level Classification (I / I+1A / I+1B / High-load)
 * - Repetition Audit
 * - Page-level Audit
 * - Frontier Audit
 * - Child-specific Audit (optional)
 *
 * 版本：1.0.0
 */

import type { RewritePage } from '../types';
import type {
  AuditInput,
  AuditResult,
  CharacterAuditResult,
  LanguageUnitAuditResult,
  RepetitionAuditResult,
  UnitInfo,
  TargetLevel,
  Level,
  FrontierAuditResult,
  ChildAuditResult,
  AuditSummary,
} from './types';

import { auditCharacters, isCJK } from './character-audit';
import { buildCandidateUnits, longestMatch, inferAttributes } from './language-unit';
import { classifyLevel, countExternalChars, calcRate } from './level-classification';
import { auditPages } from './page-audit';
import {
  SRC_CHARS_BY_LEVEL,
  SRC_WORDS_BY_LEVEL,
  SRC_CHAR_LIBRARY_VERSION,
  SRC_VOCAB_LIBRARY_VERSION,
  AUDIT_ENGINE_VERSION,
} from './level-data';

export {
  // 类型
  type AuditInput,
  type AuditResult,
  type CharacterAuditResult,
  type LanguageUnitAuditResult,
  type RepetitionAuditResult,
  type TargetLevel,
  type Level,
  type UnitInfo,
  type FrontierAuditResult,
  type ChildAuditResult,
  type AuditSummary,
  // 版本
  AUDIT_ENGINE_VERSION,
  SRC_CHAR_LIBRARY_VERSION,
  SRC_VOCAB_LIBRARY_VERSION,
  // 子模块（供外部直接调用）
  auditCharacters,
  auditPages,
  buildCandidateUnits,
  longestMatch,
  classifyLevel,
  countExternalChars,
  inferAttributes,
  isCJK,
};

/**
 * Language Unit 全量审计（字符+词汇+重复统计）
 */
function auditLUFull(
  fullText: string,
  targetLevel: TargetLevel,
  customKnownChars?: Set<string>,
  customKnownWords?: Set<string>,
): {
  charAudit: CharacterAuditResult;
  luAudit: LanguageUnitAuditResult;
  repAudit: RepetitionAuditResult;
  units: Map<string, UnitInfo>;
} {
  const candidates = buildCandidateUnits(targetLevel);
  const matches = longestMatch(fullText, candidates);
  const charAudit = auditCharacters(fullText, targetLevel);

  // 收集每个 unit 的信息
  const unitMap = new Map<string, UnitInfo>();
  let totalOccurrences = 0;

  for (const m of matches) {
    const unit = m.unit;
    totalOccurrences++;

    if (!unitMap.has(unit)) {
      const level = classifyLevel(unit, targetLevel, customKnownChars, customKnownWords);
      const outCount = countExternalChars(unit, customKnownChars ?? SRC_CHARS_BY_LEVEL[targetLevel]);
      const attributes = inferAttributes(unit, targetLevel);

      unitMap.set(unit, {
        unit,
        level,
        occurrence_count: 0,
        external_char_count: outCount,
        attributes,
        pages: [],
      });
    }

    const info = unitMap.get(unit)!;
    info.occurrence_count++;
  }

  // 统计四级（occurrence + unique）
  const occCounts: Record<Level, number> = { I: 0, 'I+1A': 0, 'I+1B': 0, 'High-load': 0 };
  const uniqCounts: Record<Level, number> = { I: 0, 'I+1A': 0, 'I+1B': 0, 'High-load': 0 };
  let avgLenSum = 0;

  for (const info of unitMap.values()) {
    occCounts[info.level] += info.occurrence_count;
    uniqCounts[info.level]++;
    avgLenSum += info.unit.length * info.occurrence_count;
  }

  const totalUnique = unitMap.size;
  const avgLength = totalOccurrences > 0 ? avgLenSum / totalOccurrences : 0;

  const luAudit: LanguageUnitAuditResult = {
    unique_units: totalUnique,
    total_occurrences: totalOccurrences,
    average_unit_length: avgLength,
    unit_density: charAudit.total_characters > 0 ? totalOccurrences / charAudit.total_characters : 0,
    I_occurrences: occCounts.I,
    I_occurrence_rate: calcRate(occCounts.I, totalOccurrences),
    I_unique: uniqCounts.I,
    I_unique_rate: calcRate(uniqCounts.I, totalUnique),
    I1A_occurrences: occCounts['I+1A'],
    I1A_occurrence_rate: calcRate(occCounts['I+1A'], totalOccurrences),
    I1A_unique: uniqCounts['I+1A'],
    I1A_unique_rate: calcRate(uniqCounts['I+1A'], totalUnique),
    I1B_occurrences: occCounts['I+1B'],
    I1B_occurrence_rate: calcRate(occCounts['I+1B'], totalOccurrences),
    I1B_unique: uniqCounts['I+1B'],
    I1B_unique_rate: calcRate(uniqCounts['I+1B'], totalUnique),
    high_load_occurrences: occCounts['High-load'],
    high_load_occurrence_rate: calcRate(occCounts['High-load'], totalOccurrences),
    high_load_unique: uniqCounts['High-load'],
    high_load_unique_rate: calcRate(uniqCounts['High-load'], totalUnique),
    narrow_i1_occurrence_rate: calcRate(occCounts['I+1A'] + occCounts['I+1B'], totalOccurrences),
    non_i_occurrence_rate: calcRate(
      occCounts['I+1A'] + occCounts['I+1B'] + occCounts['High-load'],
      totalOccurrences,
    ),
    units: Array.from(unitMap.values()),
  };

  // 重复统计（针对非 I 级的 +1）
  const plus1Units = Array.from(unitMap.values()).filter((u) => u.level !== 'I');
  const onceUnits = plus1Units.filter((u) => u.occurrence_count === 1);
  const twiceUnits = plus1Units.filter((u) => u.occurrence_count === 2);
  const thriceUnits = plus1Units.filter((u) => u.occurrence_count === 3);
  const plusUnits = plus1Units.filter((u) => u.occurrence_count >= 4);

  let repeatedOcc = 0;
  plus1Units.forEach((u) => {
    if (u.occurrence_count >= 2) repeatedOcc += u.occurrence_count;
  });

  const repAudit: RepetitionAuditResult = {
    plus1_total_unique: plus1Units.length,
    plus1_total_occurrences: plus1Units.reduce((s, u) => s + u.occurrence_count, 0),
    one_time_unique: onceUnits.length,
    one_time_occurrences: onceUnits.reduce((s, u) => s + u.occurrence_count, 0),
    two_time_unique: twiceUnits.length,
    two_time_occurrences: twiceUnits.reduce((s, u) => s + u.occurrence_count, 0),
    three_time_unique: thriceUnits.length,
    three_time_occurrences: thriceUnits.reduce((s, u) => s + u.occurrence_count, 0),
    four_plus_unique: plusUnits.length,
    four_plus_occurrences: plusUnits.reduce((s, u) => s + u.occurrence_count, 0),
    repeated_unique_count: plus1Units.filter((u) => u.occurrence_count >= 2).length,
    repeated_occurrence_count: repeatedOcc,
    repeated_unique_rate: plus1Units.length > 0
      ? plus1Units.filter((u) => u.occurrence_count >= 2).length / plus1Units.length
      : 0,
  };

  return { charAudit, luAudit, repAudit, units: unitMap };
}

/**
 * Frontier 审计
 *
 * 检查系统标记的 Frontiers：
 * - 总数
 * - 有效/无效
 * - 级别分布
 * - 重复情况
 */
function auditFrontier(
  frontiers: string[],
  targetLevel: TargetLevel,
  fullText: string,
  pages: RewritePage[],
  customKnownChars?: Set<string>,
  customKnownWords?: Set<string>,
): FrontierAuditResult {
  const charSet = customKnownChars ?? SRC_CHARS_BY_LEVEL[targetLevel];
  const wordSet = customKnownWords ?? SRC_WORDS_BY_LEVEL[targetLevel];

  const items: FrontierAuditResult['items'] = [];

  for (const frontier of frontiers) {
    const occurrences: Array<{ page: number; position: number }> = [];

    // 查找在每一页中的出现
    pages.forEach((p, idx) => {
      const text = p.text ?? '';
      let pos = 0;
      while (true) {
        const idx2 = text.indexOf(frontier, pos);
        if (idx2 === -1) break;
        occurrences.push({ page: idx + 1, position: idx2 });
        pos = idx2 + 1;
      }
    });

    const totalOccurrences = occurrences.length;
    const inVocab = wordSet.has(frontier);
    const outCount = countExternalChars(frontier, charSet);
    let level: Level;

    if (inVocab) {
      level = 'I';
    } else if (outCount === 0) {
      level = 'I+1A';
    } else if (outCount === 1) {
      level = 'I+1B';
    } else {
      level = 'High-load';
    }

    // 有效性判断
    let valid = true;
    const invalidReasons: string[] = [];

    if (inVocab) {
      valid = false;
      invalidReasons.push('已在SRC词库内，不是Frontier');
    }
    if (totalOccurrences === 0) {
      valid = false;
      invalidReasons.push('未在文本中出现');
    }
    // 检测是否为伪词（长度不足2或含非CJK）
    if (frontier.length < 2 || [...frontier].some((c) => !isCJK(c))) {
      valid = false;
      invalidReasons.push('不是合法的Language Unit');
    }

    items.push({
      frontier,
      level,
      external_char_count: outCount,
      valid,
      invalid_reasons: invalidReasons,
      occurrence_count: totalOccurrences,
      first_page: occurrences.length > 0 ? occurrences[0].page : null,
    });
  }

  const validItems = items.filter((i) => i.valid);
  const invalidItems = items.filter((i) => !i.valid);

  return {
    total_frontier: frontiers.length,
    valid_frontier: validItems.length,
    invalid_frontier: invalidItems.length,
    total_occurrences: items.reduce((s, i) => s + i.occurrence_count, 0),
    valid_occurrences: validItems.reduce((s, i) => s + i.occurrence_count, 0),
    level_distribution: {
      I: items.filter((i) => i.level === 'I').length,
      'I+1A': validItems.filter((i) => i.level === 'I+1A').length,
      'I+1B': validItems.filter((i) => i.level === 'I+1B').length,
      'High-load': validItems.filter((i) => i.level === 'High-load').length,
    },
    items,
  };
}

/**
 * 汇总统计
 */
function buildSummary(
  charAudit: CharacterAuditResult,
  luAudit: LanguageUnitAuditResult,
  repAudit: RepetitionAuditResult,
  pageAudit: ReturnType<typeof auditPages>,
  frontierAudit: FrontierAuditResult | null,
  childAudit: ChildAuditResult | null,
): AuditSummary {
  return {
    total_chinese_chars: charAudit.total_characters,
    external_char_rate: charAudit.external_char_rate,
    total_lu_occurrences: luAudit.total_occurrences,
    i_occurrence_rate: luAudit.I_occurrence_rate,
    i1a_occurrence_rate: luAudit.I1A_occurrence_rate,
    i1b_occurrence_rate: luAudit.I1B_occurrence_rate,
    high_load_occurrence_rate: luAudit.high_load_occurrence_rate,
    narrow_i1_rate: luAudit.narrow_i1_occurrence_rate,
    repeated_plus1_rate: repAudit.repeated_unique_rate,
    peak_external_rate_page: pageAudit.peak.max_external_rate_page,
    peak_external_rate: pageAudit.peak.max_external_rate,
    peak_high_load_page: pageAudit.peak.max_high_load_page,
    peak_high_load_count: pageAudit.peak.max_high_load_count,
    frontier_count: frontierAudit?.total_frontier ?? 0,
    frontier_valid_count: frontierAudit?.valid_frontier ?? 0,
    is_child_specific: childAudit !== null,
  };
}

/**
 * Audit Engine 主入口
 *
 * 对给定的绘本页面执行完整的多层级审计。
 */
export function runAudit(input: AuditInput): AuditResult {
  const {
    pages,
    targetLevel,
    knownCharacters,
    knownWords,
    frontiers,
    childId,
  } = input;

  const fullText = pages.map((p) => p.text ?? '').join('\n');

  // --- Level baseline ---
  const baseChars = SRC_CHARS_BY_LEVEL[targetLevel];
  const baseWords = SRC_WORDS_BY_LEVEL[targetLevel];

  // --- Child-specific 处理 ---
  let effectiveChars: Set<string> | undefined;
  let effectiveWords: Set<string> | undefined;
  let childAudit: ChildAuditResult | null = null;

  if (knownCharacters || knownWords) {
    // 混合策略：等级基线 + 明确的弱项信号
    // 已知字 = 等级字库 ∪ knownCharacters（测试答对的字本来就在等级里）
    // 不做"没考到 = 不认识"的推断
    effectiveChars = baseChars; // 等级基线
    effectiveWords = baseWords;

    childAudit = {
      child_id: childId ?? null,
      baseline_level: targetLevel,
      has_known_characters: !!knownCharacters,
      has_known_words: !!knownWords,
      known_char_count_provided: knownCharacters?.size ?? knownCharacters?.length ?? 0,
      known_word_count_provided: knownWords?.size ?? 0,
      strategy: 'level_baseline_plus_explicit_weakness',
      note: 'V1使用等级基线作为主依据。knownCharacters/knownWords作为已确认掌握的子集标记，不用于"未出现=不认识"的推断。',
    };
  }

  // --- Character + LU + Repetition ---
  const { charAudit, luAudit, repAudit } = auditLUFull(
    fullText,
    targetLevel,
    effectiveChars,
    effectiveWords,
  );

  // --- Page-level ---
  const pageResult = auditPages(pages, targetLevel, effectiveChars, effectiveWords);

  // --- Frontier ---
  const frontierResult = frontiers && frontiers.length > 0
    ? auditFrontier(frontiers, targetLevel, fullText, pages, effectiveChars, effectiveWords)
    : null;

  // --- Summary ---
  const summary = buildSummary(charAudit, luAudit, repAudit, pageResult, frontierResult, childAudit);

  return {
    engine_version: AUDIT_ENGINE_VERSION,
    src_char_library_version: SRC_CHAR_LIBRARY_VERSION,
    src_vocab_library_version: SRC_VOCAB_LIBRARY_VERSION,
    target_level: targetLevel,
    child_id: childId ?? null,
    character_audit: charAudit,
    language_unit_audit: luAudit,
    repetition_audit: repAudit,
    page_audit: pageResult,
    frontier_audit: frontierResult,
    child_audit: childAudit,
    summary,
  };
}

/**
 * 便捷函数：从字符串数组（纯文本数组）创建 RewritePage[] 供 audit 调用
 */
export function pagesFromTexts(texts: string[]): RewritePage[] {
  return texts.map((text, i) => ({
    page: i + 1,
    text,
    frontier: null,
    image_url: '',
    original_text: text,
  }));
}
