/**
 * Language Unit 识别与最长匹配
 *
 * 基于 Language Unit v0.1-final 定义：
 * - ≥2 个汉字
 * - 自然中文词或固定词汇单位
 * - 语义完整
 * - 纯中文字符
 * - 执行顺序：候选构造 → 资格过滤 → 最长匹配 → 分类
 * - 不重叠、不嵌套
 */

import { COMMON_LANGUAGE_UNITS, SRC_WORDS_BY_LEVEL } from './level-data';
import { isCJK } from './character-audit';
import type { TargetLevel, UnitAttribute } from './types';

export interface MatchedUnit {
  unit: string;
  start: number;
  end: number;
}

/**
 * 构造所有候选 Language Unit（字面值 + 规则生成）
 *
 * 当前实现基于白名单（SRC词库 + 通用LU集）。
 * 白名单模式的优势：确定性、可重复、不会产生伪词。
 * 白名单模式的局限：覆盖范围取决于白名单完整性。
 *
 * 未来如需扩展到非白名单模式（如基于词库 + 重叠/后缀规则动态生成），
 * 在此函数内扩展即可，接口不变。
 */
export function buildCandidateUnits(targetLevel: TargetLevel): Set<string> {
  const srcWords = SRC_WORDS_BY_LEVEL[targetLevel];
  const result = new Set<string>();

  for (const w of srcWords) {
    if (w.length >= 2 && [...w].every(isCJK)) {
      result.add(w);
    }
  }
  for (const w of COMMON_LANGUAGE_UNITS) {
    if (w.length >= 2 && [...w].every(isCJK)) {
      result.add(w);
    }
  }

  return result;
}

/**
 * 判断字符串是否具有 Language Unit 资格。
 *
 * 排除规则：
 * - 单字 → 排除
 * - 含非 CJK 字符 → 排除
 * - 跨标点 → 外部 longest match 天然不跨标点（标点打断 CJK 串）
 * - 完整句子 → 白名单中本身没有句子，不额外判断
 * - 临时自由短语 → 白名单模式天然排除
 *
 * 在白名单模式下，候选本身已经过筛选，此函数主要做最终合规校验。
 */
export function isEligibleLU(text: string): boolean {
  if (text.length < 2) return false;
  for (const ch of text) {
    if (!isCJK(ch)) return false;
  }
  return true;
}

/**
 * 对单段文本执行最长匹配，返回匹配到的 Language Unit 列表。
 *
 * 规则：
 * 1. 从左到右扫描
 * 2. 在每个位置找最长的匹配候选
 * 3. 匹配成功后跳过整个匹配长度（不重叠、不嵌套）
 * 4. 未匹配位置跳过（单字等）
 *
 * @param text 纯文本（含标点等也可以，会自动跳过）
 * @param candidates 候选 LU 集合
 * @returns 按出现顺序排列的匹配项列表
 */
export function longestMatch(text: string, candidates: Set<string>): MatchedUnit[] {
  // 预计算候选词的最大长度，加速匹配
  let maxLen = 0;
  for (const w of candidates) {
    if (w.length > maxLen) maxLen = w.length;
  }

  const result: MatchedUnit[] = [];
  const used = new Set<number>();
  let i = 0;

  while (i < text.length) {
    // 非 CJK 或已使用 → 跳过
    if (!isCJK(text[i]) || used.has(i)) {
      i++;
      continue;
    }

    let matched: string | null = null;
    const probeLen = Math.min(maxLen, text.length - i);

    // 从最长到最短尝试匹配
    for (let len = probeLen; len >= 2; len--) {
      const substr = text.substring(i, i + len);
      // 子串必须全是 CJK
      let allCJK = true;
      for (let k = 0; k < len; k++) {
        if (!isCJK(substr[k])) {
          allCJK = false;
          break;
        }
      }
      if (!allCJK) continue;
      if (candidates.has(substr)) {
        matched = substr;
        break;
      }
    }

    if (matched) {
      result.push({ unit: matched, start: i, end: i + matched.length });
      for (let k = 0; k < matched.length; k++) {
        used.add(i + k);
      }
      i += matched.length;
    } else {
      i++;
    }
  }

  return result;
}

/**
 * 推断 Language Unit 的属性标签。
 *
 * 基于启发式规则，不追求 100% 语言学精确，
 * 只用于审计报告中的分类标记和过滤。
 */
export function inferAttributes(
  unit: string,
  targetLevel: TargetLevel,
  storyCoreNames: Set<string> = new Set(['西游记', '孙悟空', '美猴王', '花果山', '水帘洞', '金箍棒', '筋斗云']),
): UnitAttribute[] {
  const attrs: UnitAttribute[] = [];
  const srcWords = SRC_WORDS_BY_LEVEL[targetLevel];

  if (srcWords.has(unit)) {
    attrs.push('src_vocabulary');
  }

  // 故事核心专有名词
  if (storyCoreNames.has(unit)) {
    attrs.push('story_core');
    attrs.push('proper_name');
    return attrs;
  }

  // 专名：人名/地名（启发式，常见姓氏开头 + 长度2-3）
  if (/^[孙李王张赵刘陈杨周吴徐朱马胡郭何林罗高梁郑].{1,2}$/.test(unit) && unit.length <= 3) {
    // 避免误判普通词，仅对明确的故事人名生效
    if (['孙悟空', '美猴王'].includes(unit)) {
      attrs.push('proper_name');
    }
  }

  // 重叠词 AA / V一V / ABAB / AABB
  if (unit.length === 2 && unit[0] === unit[1]) {
    attrs.push('reduplication');
  } else if (unit.length === 3 && unit[0] === unit[2] && unit[1] === '一') {
    attrs.push('reduplication');
  } else if (unit.length === 4 && unit[0] === unit[1] && unit[2] === unit[3]) {
    attrs.push('reduplication');
  } else if (unit.length === 4 && unit[0] === unit[2] && unit[1] === unit[3]) {
    attrs.push('reduplication');
  }

  // 后缀派生
  if (unit.endsWith('们') && unit.length >= 2) {
    attrs.push('suffix_derivation');
  }
  if (unit.endsWith('子') && unit.length >= 2 && unit[0] !== '子') {
    attrs.push('suffix_derivation');
  }
  if (unit.endsWith('头') && unit.length >= 2 && unit[0] !== '头') {
    attrs.push('suffix_derivation');
  }

  // 三字词
  if (unit.length === 3 && !attrs.includes('reduplication') && !attrs.includes('suffix_derivation')) {
    attrs.push('three_char_word');
  }

  // 补语结构（"出来""上去""下来""过来""过去"等结尾）
  if ((unit.endsWith('出来') || unit.endsWith('上去') || unit.endsWith('下来') ||
       unit.endsWith('过来') || unit.endsWith('过去') || unit.endsWith('起来') ||
       unit.endsWith('进去') || unit.endsWith('出去')) && unit.length >= 3) {
    attrs.push('complement_structure');
  }

  // 固定搭配（越来越...、一...就... 等）
  if (unit.startsWith('越来越') && unit.length >= 4) {
    attrs.push('fixed_collocation');
  }
  if (unit.endsWith('好不好') || unit.endsWith('行不行') || unit.endsWith('对不对') ||
      unit.endsWith('是不是') || unit.endsWith('有没有')) {
    attrs.push('fixed_collocation');
  }

  // 成语 / 四字固定短语（启发式：4字且不是其他类型）
  if (unit.length === 4 &&
      !attrs.includes('reduplication') &&
      !attrs.includes('fixed_collocation') &&
      !attrs.includes('complement_structure')) {
    attrs.push('idiom');
  }

  // 兜底：普通词
  if (attrs.length === 0 || (attrs.length === 1 && attrs[0] === 'src_vocabulary')) {
    attrs.push('ordinary_word');
  }

  return attrs;
}
