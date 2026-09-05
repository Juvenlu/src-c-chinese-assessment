import type { CharacterAudit } from "./types";

/**
 * 判断一个字符是否为CJK汉字
 */
export function isCJK(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf)
  );
}

/**
 * 字符层审计
 *
 * 精确统计：
 * - 总中文字符数 (occurrence)
 * - SRC内字出现次数
 * - SRC外字出现次数
 * - SRC内字去重数
 * - SRC外字去重数
 * - 外字出现率 (%)
 */
export function auditCharacters(
  text: string,
  srcCharSet: Set<string>
): CharacterAudit {
  let totalChars = 0;
  let srcInCount = 0;
  let srcOutCount = 0;
  const srcInUnique = new Set<string>();
  const srcOutUnique = new Set<string>();

  for (const ch of text) {
    if (!isCJK(ch)) continue;
    totalChars++;
    if (srcCharSet.has(ch)) {
      srcInCount++;
      srcInUnique.add(ch);
    } else {
      srcOutCount++;
      srcOutUnique.add(ch);
    }
  }

  const externalRate = totalChars > 0 ? (srcOutCount / totalChars) * 100 : 0;

  return {
    total_chinese_chars: totalChars,
    src_in_occurrences: srcInCount,
    src_out_occurrences: srcOutCount,
    src_in_unique_chars: srcInUnique.size,
    src_out_unique_chars: srcOutUnique.size,
    external_char_occurrence_rate: Number(externalRate.toFixed(2)),
    src_out_unique_char_list: Array.from(srcOutUnique).sort(),
  };
}
