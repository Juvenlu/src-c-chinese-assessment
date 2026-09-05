/**
 * Page-level 审计
 *
 * 对每一页分别计算：
 * - 字符统计（中文字数、外字出现次数、外字率）
 * - Language Unit 统计（总数 + 四级分布）
 * - 峰值统计（最高外字率页、最高 High-load 页等）
 */

import type {
  PageAudit,
  PageAuditResult,
  TargetLevel,
} from './types';
import { auditCharacters } from './character-audit';
import { buildCandidateUnits, longestMatch, inferAttributes } from './language-unit';
import { classifyLevel } from './level-classification';
import type { RewritePage } from '../types';

/**
 * 对单页文本进行审计。
 */
function auditSinglePage(
  pageNumber: number,
  text: string,
  targetLevel: TargetLevel,
  candidates: Set<string>,
  customKnownChars?: Set<string>,
  customKnownWords?: Set<string>,
): PageAudit {
  const charAudit = auditCharacters(text, targetLevel);
  const matches = longestMatch(text, candidates);

  const levelCounts: Record<string, number> = {
    I: 0,
    'I+1A': 0,
    'I+1B': 0,
    'High-load': 0,
  };

  for (const m of matches) {
    const level = classifyLevel(m.unit, targetLevel, customKnownChars, customKnownWords);
    levelCounts[level]++;
  }

  const total = matches.length;

  return {
    page_number: pageNumber,
    chinese_chars: charAudit.total_characters,
    src_out_occurrences: charAudit.src_out_occurrences,
    external_char_rate: charAudit.external_char_rate,
    language_unit_occurrences: total,
    I: levelCounts.I,
    'I+1A': levelCounts['I+1A'],
    'I+1B': levelCounts['I+1B'],
    'High-load': levelCounts['High-load'],
  };
}

/**
 * 对多页文本执行 page-level 审计。
 */
export function auditPages(
  pages: RewritePage[],
  targetLevel: TargetLevel,
  customKnownChars?: Set<string>,
  customKnownWords?: Set<string>,
): PageAuditResult {
  const candidates = buildCandidateUnits(targetLevel);

  const pageAudits: PageAudit[] = pages.map((p, idx) =>
    auditSinglePage(idx + 1, p.text ?? '', targetLevel, candidates, customKnownChars, customKnownWords),
  );

  // 全局汇总（通过各页相加得到，确保与全局审计一致）
  let sumChars = 0;
  let sumOutOcc = 0;
  let sumLU = 0;
  let sumI = 0, sumI1A = 0, sumI1B = 0, sumHL = 0;

  let maxExtRatePage = 0;
  let maxExtRate = 0;
  let maxHLPage = 0;
  let maxHL = 0;

  pageAudits.forEach((p) => {
    sumChars += p.chinese_chars;
    sumOutOcc += p.src_out_occurrences;
    sumLU += p.language_unit_occurrences;
    sumI += p.I;
    sumI1A += p['I+1A'];
    sumI1B += p['I+1B'];
    sumHL += p['High-load'];

    if (p.external_char_rate > maxExtRate) {
      maxExtRate = p.external_char_rate;
      maxExtRatePage = p.page_number;
    }
    if (p['High-load'] > maxHL) {
      maxHL = p['High-load'];
      maxHLPage = p.page_number;
    }
  });

  return {
    pages: pageAudits,
    total: {
      chinese_chars: sumChars,
      src_out_occurrences: sumOutOcc,
      external_char_rate: sumChars > 0 ? sumOutOcc / sumChars : 0,
      language_unit_occurrences: sumLU,
      I: sumI,
      'I+1A': sumI1A,
      'I+1B': sumI1B,
      'High-load': sumHL,
    },
    peak: {
      max_external_rate_page: maxExtRatePage,
      max_external_rate: maxExtRate,
      max_high_load_page: maxHLPage,
      max_high_load_count: maxHL,
    },
  };
}

// 导出，便于主模块中使用
export { inferAttributes };
