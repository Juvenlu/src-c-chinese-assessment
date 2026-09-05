import { LevelClass, UnitAttribute } from "./types";

/**
 * 统计一个语言单位中，有多少个汉字是 SRC 外字
 */
export function countExternalChars(
  unit: string,
  srcChars: Set<string>
): number {
  let count = 0;
  for (const ch of unit) {
    if (/[\u4e00-\u9fff]/.test(ch) && !srcChars.has(ch)) {
      count++;
    }
  }
  return count;
}

/**
 * 四级分类
 *
 * I       - 属于 SRC 当前等级词汇
 * I+1A    - 全部汉字都在 SRC 字符基础内，但词不在词库内
 * I+1B    - 恰好 1 个汉字不在 SRC 字符基础内
 * High-load - ≥2 个汉字不在 SRC 字符基础内
 */
export function classifyLevel(
  unit: string,
  srcChars: Set<string>,
  srcWords: Set<string>,
  attributes: UnitAttribute[] = []
): LevelClass {
  // SRC词汇库内 → I
  if (srcWords.has(unit)) {
    return "I";
  }

  const extCount = countExternalChars(unit, srcChars);

  if (extCount === 0) return "I+1A";
  if (extCount === 1) return "I+1B";
  return "High-load";
}
