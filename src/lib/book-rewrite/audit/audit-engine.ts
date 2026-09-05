import {
  AuditInput,
  AuditResult,
  AuditSummary,
  LengthAudit,
  CharacterAudit,
  LanguageUnitItem,
  LanguageUnitAudit,
  RepetitionAudit,
  PageAuditItem,
  PageAuditResult,
  FrontierAuditItem,
  FrontierAuditResult,
  ChildAuditResult,
  UnitAttribute,
  LevelClass,
  TargetLevel,
} from "./types";
import { getLevelData, STORY_CORE_PROPER_NAMES, AUDIT_ENGINE_VERSION, SRC_CHAR_LIBRARY_VERSION, SRC_VOCAB_LIBRARY_VERSION, isProperNameFragment } from "./level-data";
import { buildCandidateUnits, longestMatch } from "./language-unit";
import { classifyLevel, countExternalChars } from "./level-classification";
import { auditCharacters, isCJK } from "./character-audit";
import { auditPages } from "./page-audit";
import { getStandardV1 } from "../standard-v1";
import type { RewritePage } from "../types";

export {
  AUDIT_ENGINE_VERSION,
  SRC_CHAR_LIBRARY_VERSION,
  SRC_VOCAB_LIBRARY_VERSION,
};

export { auditCharacters, auditPages, buildCandidateUnits, longestMatch, classifyLevel, isCJK };

/**
 * Build LanguageUnitItem[] from page text arrays
 */
function buildLUItems(
  allUnits: Map<string, { level: LevelClass; attributes: UnitAttribute[] }>,
  occurrenceMap: Map<string, number>
): LanguageUnitItem[] {
  const items: LanguageUnitItem[] = [];
  for (const [unit, info] of allUnits) {
    items.push({
      unit,
      level: info.level,
      attributes: info.attributes,
      occurrence_count: occurrenceMap.get(unit) ?? 0,
    });
  }
  return items;
}

/**
 * Run full audit on a set of pages
 */
export function runAudit(input: AuditInput): AuditResult {
  const {
    pages,
    target_level,
    frontiers,
    known_characters,
    weak_char_signals,
    known_vocabulary,
    child_id,
    rewrite_id,
  } = input;

  const levelData = getLevelData(target_level);

  // 1. Full text for global stats
  const fullText = pages.map((p) => p.text).join("\n");

  // 2. Character audit (global)
  const charAudit: CharacterAudit = auditCharacters(
    fullText,
    levelData.srcChars
  );

  // 2b. Length audit (V1.0 标准)
  const std = getStandardV1(target_level);
  const lenAudit: LengthAudit = (() => {
    const actual = charAudit.total_chinese_chars;
    const inTarget = actual >= std.length_target_min && actual <= std.length_target_max;
    const inAllowed = actual >= std.length_target_min && actual <= std.length_allowed_max;
    let status: LengthAudit["status"] = "PASS";
    if (!inAllowed) status = "STRONG_WARNING";
    else if (!inTarget) status = "WARNING";
    return {
      actual,
      target_min: std.length_target_min,
      target_max: std.length_target_max,
      allowed_max: std.length_allowed_max,
      status,
      in_target_range: inTarget,
      in_allowed_range: inAllowed,
    };
  })();

  // 3. Language Unit analysis (global)
  const allMatches = longestMatch(fullText, levelData.commonUnits);
  const luMap = new Map<string, { level: LevelClass; attributes: UnitAttribute[] }>();
  const occurrenceMap = new Map<string, number>();

  for (const m of allMatches) {
    const unit = m.unit;
    if (!luMap.has(unit)) {
      const level = classifyLevel(unit, levelData.srcChars, levelData.srcWords, []);
      const attrs: UnitAttribute[] = [];
      if (levelData.srcWords.has(unit)) attrs.push("src_vocabulary");
      if (STORY_CORE_PROPER_NAMES.has(unit)) attrs.push("story_core");
      luMap.set(unit, { level, attributes: attrs });
    }
    occurrenceMap.set(unit, (occurrenceMap.get(unit) ?? 0) + 1);
  }

  const luItems = buildLUItems(luMap, occurrenceMap);

  // 4. Level counting (occurrence)
  let iOccur = 0,
    i1aOccur = 0,
    i1bOccur = 0,
    hlOccur = 0;

  for (const item of luItems) {
    const n = item.occurrence_count;
    if (item.level === "I") iOccur += n;
    else if (item.level === "I+1A") i1aOccur += n;
    else if (item.level === "I+1B") i1bOccur += n;
    else if (item.level === "High-load") hlOccur += n;
  }

  const totalLu = iOccur + i1aOccur + i1bOccur + hlOccur;
  const iRate = totalLu > 0 ? (iOccur / totalLu) * 100 : 0;
  const i1aRate = totalLu > 0 ? (i1aOccur / totalLu) * 100 : 0;
  const i1bRate = totalLu > 0 ? (i1bOccur / totalLu) * 100 : 0;
  const hlRate = totalLu > 0 ? (hlOccur / totalLu) * 100 : 0;
  const narrowPlus1Rate = totalLu > 0 ? ((i1aOccur + i1bOccur) / totalLu) * 100 : 0;

  const luAudit: LanguageUnitAudit = {
    total_occurrences: totalLu,
    unique_units: luItems.length,
    i_occurrences: iOccur,
    i_plus_1a_occurrences: i1aOccur,
    i_plus_1b_occurrences: i1bOccur,
    high_load_occurrences: hlOccur,
    i_rate: iRate,
    i_plus_1a_rate: i1aRate,
    i_plus_1b_rate: i1bRate,
    high_load_rate: hlRate,
    narrow_i_plus_1_rate: narrowPlus1Rate,
    units: luItems,
  };

  // 5. Repetition audit (+1 units only)
  const plus1Units = luItems.filter(
    (u) => u.level === "I+1A" || u.level === "I+1B"
  );
  let oneTime = 0,
    twoTime = 0,
    threeTime = 0,
    fourPlusTime = 0;
  let repeatedUnique = 0;
  let repeatedOccur = 0;

  for (const u of plus1Units) {
    const n = u.occurrence_count;
    if (n === 1) oneTime++;
    else if (n === 2) {
      twoTime++;
      repeatedUnique++;
      repeatedOccur += n;
    } else if (n === 3) {
      threeTime++;
      repeatedUnique++;
      repeatedOccur += n;
    } else {
      fourPlusTime++;
      repeatedUnique++;
      repeatedOccur += n;
    }
  }

  const repAudit: RepetitionAudit = {
    plus1_unique_total: plus1Units.length,
    plus1_total_occurrences: plus1Units.reduce((s, u) => s + u.occurrence_count, 0),
    one_time: oneTime,
    two_time: twoTime,
    three_time: threeTime,
    four_plus: fourPlusTime,
    repeated_unique: repeatedUnique,
    repeated_occurrences: repeatedOccur,
  };

  // 6. Page-level audit
  const pageAudit: PageAuditResult = auditPages(pages, target_level);

  // 7. Frontier audit
  const frontierAudit: FrontierAuditResult | null = frontiers
    ? buildFrontierAudit(frontiers, luMap, occurrenceMap, STORY_CORE_PROPER_NAMES)
    : null;

  // 8. Child-specific audit
  const childAudit: ChildAuditResult | null =
    known_characters || weak_char_signals
      ? buildChildAudit(
          luItems,
          known_characters ?? new Set(),
          weak_char_signals ?? new Set(),
          known_vocabulary ?? new Set()
        )
      : null;

  // 9. Summary
  const summary: AuditSummary = {
    total_chinese_characters: charAudit.total_chinese_chars,
    external_char_occurrence_rate: charAudit.external_char_occurrence_rate,
    total_lu_occurrences: totalLu,
    i_rate: iRate,
    i_plus_1a_rate: i1aRate,
    i_plus_1b_rate: i1bRate,
    high_load_rate: hlRate,
    plus1_total_occurrences: plus1Units.reduce((s, u) => s + u.occurrence_count, 0),
    repeated_plus1_unique: repeatedUnique,
    repeated_plus1_occurrences: repeatedOccur,
    valid_frontier_count: frontierAudit?.valid_frontier_count ?? null,
    invalid_frontier_count: frontierAudit?.invalid_frontier_count ?? null,
    max_page_external_rate: pageAudit.max_external_char_rate,
    peak_page: pageAudit.peak_page_number,
  };

  return {
    engine_version: AUDIT_ENGINE_VERSION,
    src_char_library_version: SRC_CHAR_LIBRARY_VERSION,
    src_vocab_library_version: SRC_VOCAB_LIBRARY_VERSION,
    target_level,
    rewrite_id,
    child_id,
    length_audit: lenAudit,
    character_audit: charAudit,
    language_unit_audit: luAudit,
    repetition_audit: repAudit,
    page_audit: pageAudit,
    frontier_audit: frontierAudit,
    child_audit: childAudit,
    summary,
  };
}

function buildFrontierAudit(
  frontiers: string[],
  luMap: Map<string, { level: LevelClass; attributes: UnitAttribute[] }>,
  occurrenceMap: Map<string, number>,
  properNames: Set<string>
): FrontierAuditResult {
  const items: FrontierAuditItem[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let i1aFrontier = 0;
  let i1bFrontier = 0;
  let hlFrontier = 0;

  for (const f of frontiers) {
    const unitInfo = luMap.get(f);
    const isInText = unitInfo !== undefined;
    const isProperFrag = isProperNameFragment(f, properNames);
    const isPseudoWord = f.length < 2 || !/[\u4e00-\u9fff]{2}/.test(f);
    let is_valid = true;
    let invalid_reason: string | null = null;

    if (isProperFrag) {
      is_valid = false;
      invalid_reason = "proper_name_fragment";
    } else if (isPseudoWord) {
      is_valid = false;
      invalid_reason = "pseudo_word";
    }

    if (is_valid) validCount++;
    else invalidCount++;

    const level: LevelClass = unitInfo?.level ?? "I+1A";
    if (is_valid) {
      if (level === "I+1A") i1aFrontier++;
      else if (level === "I+1B") i1bFrontier++;
      else if (level === "High-load") hlFrontier++;
    }

    items.push({
      unit: f,
      level,
      is_valid,
      invalid_reason,
      occurrence_count: occurrenceMap.get(f) ?? (isInText ? 1 : 0),
    });
  }

  return {
    total_frontier_units: frontiers.length,
    valid_frontier_count: validCount,
    invalid_frontier_count: invalidCount,
    i_plus_1a_frontier: i1aFrontier,
    i_plus_1b_frontier: i1bFrontier,
    high_load_frontier: hlFrontier,
    items,
  };
}

function buildChildAudit(
  luItems: LanguageUnitItem[],
  knownChars: Set<string>,
  weakChars: Set<string>,
  knownWords: Set<string>
): ChildAuditResult {
  const childSpecificPlus1: LanguageUnitItem[] = [];
  const childSpecificHL: LanguageUnitItem[] = [];
  const weaknessRelated: LanguageUnitItem[] = [];

  for (const u of luItems) {
    if (u.level === "I+1A" || u.level === "I+1B") {
      // Check if any char in the unit is a weak char signal
      const hasWeakChar = [...u.unit].some((c) => weakChars.has(c));
      if (hasWeakChar) {
        weaknessRelated.push(u);
      }
      childSpecificPlus1.push(u);
    } else if (u.level === "High-load") {
      const hasWeakChar = [...u.unit].some((c) => weakChars.has(c));
      if (hasWeakChar) {
        weaknessRelated.push(u);
      }
      childSpecificHL.push(u);
    }
  }

  return {
    known_character_count: knownChars.size,
    weak_char_signals_count: weakChars.size,
    known_vocabulary_count: knownWords.size,
    child_specific_plus_1: childSpecificPlus1,
    child_specific_high_load: childSpecificHL,
    weakness_related_units: weaknessRelated,
  };
}

/**
 * Helper: create audit pages from plain text array
 */
export function pagesFromTexts(texts: string[]): RewritePage[] {
  return texts.map((text, i) => ({
    page: i + 1,
    text,
    frontier: [] as string[],
    image_url: "",
    original_text: text,
  }));
}
