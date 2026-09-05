import { PageAuditItem, PageAuditResult, TargetLevel } from "./types";
import { getLevelData } from "./level-data";
import { auditCharacters } from "./character-audit";
import { longestMatch } from "./language-unit";
import { classifyLevel } from "./level-classification";
import type { RewritePage } from "../types";

/**
 * 单页审计
 */
export function auditSinglePage(
  page: RewritePage,
  targetLevel: TargetLevel
): PageAuditItem {
  const levelData = getLevelData(targetLevel);
  const charAudit = auditCharacters(page.text, levelData.srcChars);
  const matches = longestMatch(page.text, levelData.commonUnits);

  let iLu = 0,
    i1aLu = 0,
    i1bLu = 0,
    hlLu = 0;

  for (const m of matches) {
    const level = classifyLevel(m.unit, levelData.srcChars, levelData.srcWords, []);
    if (level === "I") iLu++;
    else if (level === "I+1A") i1aLu++;
    else if (level === "I+1B") i1bLu++;
    else if (level === "High-load") hlLu++;
  }

  return {
    page_number: page.page,
    chinese_chars: charAudit.total_chinese_chars,
    src_in_chars: charAudit.src_in_occurrences,
    src_out_chars: charAudit.src_out_occurrences,
    external_char_rate: charAudit.external_char_occurrence_rate,
    lu_total: matches.length,
    i_lu: iLu,
    i_plus_1a_lu: i1aLu,
    i_plus_1b_lu: i1bLu,
    high_load_lu: hlLu,
  };
}

/**
 * 多页审计 + 峰值/波动计算
 */
export function auditPages(
  pages: RewritePage[],
  targetLevel: TargetLevel
): PageAuditResult {
  const pageItems: PageAuditItem[] = [];
  let totalChars = 0;
  let maxExtRate = -1;
  let peakPage = 0;
  let maxHlPerPage = -1;
  let hlPeakPage = 0;

  for (const page of pages) {
    const item = auditSinglePage(page, targetLevel);
    pageItems.push(item);
    totalChars += item.chinese_chars;
    if (item.external_char_rate > maxExtRate) {
      maxExtRate = item.external_char_rate;
      peakPage = item.page_number;
    }
    if (item.high_load_lu > maxHlPerPage) {
      maxHlPerPage = item.high_load_lu;
      hlPeakPage = item.page_number;
    }
  }

  return {
    pages: pageItems,
    total_pages: pages.length,
    avg_chars_per_page: pages.length > 0 ? totalChars / pages.length : 0,
    max_external_char_rate: maxExtRate > 0 ? maxExtRate : 0,
    peak_page_number: peakPage,
    max_high_load_per_page: maxHlPerPage > 0 ? maxHlPerPage : 0,
    high_load_peak_page: hlPeakPage,
  };
}
