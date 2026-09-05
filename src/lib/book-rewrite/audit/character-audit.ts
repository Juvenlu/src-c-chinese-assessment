/**
 * 字符层审计
 *
 * 精确统计文本中的 CJK 汉字及其在 SRC 字库中的内外分布。
 */

import { SRC_CHARS_BY_LEVEL } from './level-data';
import type { CharacterAudit, TargetLevel } from './types';

const CJK_RE = /^[\u4e00-\u9fff\u3400-\u4dbf]$/;

export function isCJK(ch: string): boolean {
  return CJK_RE.test(ch);
}

/**
 * 统计文本中的所有 CJK 汉字
 */
export function extractChineseChars(text: string): string[] {
  const chars: string[] = [];
  for (const ch of text) {
    if (isCJK(ch)) chars.push(ch);
  }
  return chars;
}

/**
 * 执行字符层审计
 * @param text 全文或单页文本
 * @param targetLevel 目标等级
 */
export function auditCharacters(text: string, targetLevel: TargetLevel): CharacterAudit {
  const charSet = SRC_CHARS_BY_LEVEL[targetLevel];
  const allChars = extractChineseChars(text);
  const total = allChars.length;

  let srcInOcc = 0;
  let srcOutOcc = 0;
  const srcInUnique = new Set<string>();
  const srcOutUnique = new Set<string>();

  for (const ch of allChars) {
    if (charSet.has(ch)) {
      srcInOcc++;
      srcInUnique.add(ch);
    } else {
      srcOutOcc++;
      srcOutUnique.add(ch);
    }
  }

  return {
    total_chinese_chars: total,
    src_in_occurrences: srcInOcc,
    src_out_occurrences: srcOutOcc,
    src_in_unique: srcInUnique.size,
    src_out_unique: srcOutUnique.size,
    external_char_occurrence_rate: total === 0 ? 0 : srcOutOcc / total,
    external_chars: [...srcOutUnique].sort(),
  };
}
