/**
 * 轻量 Frontier 选择服务
 *
 * 第一本 POC 只做简单版本：
 * 1. 从 known_characters 获取孩子认识的字
 * 2. 从 Master Story 文本中提取高频词
 * 3. 筛选"孩子认识的字组成的新词"和"故事相关常用词"
 * 4. 选出 3-5 个作为 Frontier
 *
 * 注意：Frontier 优先是"已知字组成的新词"，而不是"新字"。
 * 重点验证 i+1：语言大部分已知 + 少量新表达。
 */

/** 从文本中提取候选词（2-4字词组） */
export function extractCandidateWords(text: string): string[] {
  // 简单提取所有 2-4 字的连续汉字序列
  const candidates = new Set<string>();
  const chars = text.match(/[\u4e00-\u9fa5]/g) || [];

  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= chars.length - len; i++) {
      const word = chars.slice(i, i + len).join('');
      candidates.add(word);
    }
  }

  return Array.from(candidates);
}

/** 常见中文停用词（Frontier 不选这些） */
const STOP_WORDS = new Set([
  '我们', '你们', '他们', '它们', '自己', '一个', '一下', '一样',
  '什么', '怎么', '为什么', '因为', '所以', '但是', '可是', '然后',
  '于是', '还是', '或者', '如果', '就是', '不是', '没有', '可以',
  '这个', '那个', '这些', '那些', '这里', '那里', '现在', '时候',
  '今天', '明天', '昨天', '大家', '一起', '出来', '进去', '上来',
  '下去', '起来', '过来', '过去', '知道', '觉得', '想到', '看到',
  '听到', '非常', '特别', '十分', '马上', '立刻', '突然', '慢慢',
  '悄悄', '轻轻', '好好', '高高', '大大', '小小', '很多', '很少',
]);

/** 常见词尾/后缀（不单独作为有意义的 frontier） */
const BAD_SUFFIX_CHARS = new Set(['们', '子', '的', '了', '着', '过', '啊', '吧', '呢', '吗']);

/** 判断词是否是有意义的学习单位（过滤掉明显的词片段/语法后缀） */
function isMeaningfulWord(word: string): boolean {
  if (word.length < 2) return false;
  // 2字词：排除纯后缀组合
  if (word.length === 2) {
    if (BAD_SUFFIX_CHARS.has(word[0]) && BAD_SUFFIX_CHARS.has(word[1])) return false;
  }
  // 3字词：排除"XX们"、"XX的"这种纯添加后缀的形式
  if (word.length === 3 && BAD_SUFFIX_CHARS.has(word[word.length - 1])) {
    return false;
  }
  return true;
}

/** 从所有候选词中移除"被更长词包含的子串" */
function removeSubstringCandidates(candidates: string[]): string[] {
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  const result: string[] = [];
  for (const word of sorted) {
    const isSub = result.some((longer) => longer.includes(word));
    if (!isSub) {
      result.push(word);
    }
  }
  return result;
}

/** 判断词是否由已知汉字组成 */
export function isWordFromKnownChars(word: string, knownChars: Set<string>): boolean {
  for (const char of word) {
    if (!knownChars.has(char)) return false;
  }
  return true;
}

/** 计算词在文本中的出现次数 */
export function countWordOccurrences(text: string, word: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(word, idx)) !== -1) {
    count++;
    idx += word.length;
  }
  return count;
}

/**
 * 选择 Frontie r
 *
 * 三级选择策略（优先级从高到低）：
 * P1：已知字组成的新词（孩子认识每个字，但组合成的词是新学习单位）
 * P2：故事高频词（在全文中出现 ≥3 次的常用双字词）
 * P3：故事核心词（人物名、地名等与故事强相关的词）
 *
 * 如果 P1 不足，依次用 P2、P3 补充。总量保持精简（默认 3-5 个）。
 *
 * @param fullText 全书文本
 * @param knownCharacters 孩子认识的汉字集合（抽样观测集，可能不完整）
 * @param count 目标数量（默认 4）
 */
export function selectFrontiers(
  fullText: string,
  knownCharacters: string[],
  count: number = 4,
): string[] {
  const knownSet = new Set(knownCharacters);
  const allCandidates = extractCandidateWords(fullText);

  // ===== P1：已知字组成的新词 =====
  const p1Candidates = allCandidates
    .filter(
      (w) => !STOP_WORDS.has(w)
        && isWordFromKnownChars(w, knownSet)
        && w.length >= 2
        && isMeaningfulWord(w),
    )
    .map((word) => ({ word, count: countWordOccurrences(fullText, word) }))
    .filter((w) => w.count >= 2)
    .sort((a, b) => b.count - a.count);

  // ===== P2：故事高频常用词（2字词，出现≥3次，非停用词，有意义）=====
  const p2Candidates = allCandidates
    .filter((w) => w.length === 2 && !STOP_WORDS.has(w) && isMeaningfulWord(w))
    .map((word) => ({ word, count: countWordOccurrences(fullText, word) }))
    .filter((w) => w.count >= 3)
    .sort((a, b) => b.count - a.count);

  // ===== P3：故事核心词（人物/地点等专有名词，启发式）=====
  // 从文本中找高频且不是停用词的多字词，按频率排序（用于补充）
  const p3Candidates = allCandidates
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && isMeaningfulWord(w))
    .map((word) => ({ word, count: countWordOccurrences(fullText, word) }))
    .filter((w) => w.count >= 2)
    .sort((a, b) => b.count - a.count);

  const selected: string[] = [];
  const selectedSet = new Set<string>();

  function pickFrom(list: { word: string; count: number }[], max: number, diversity: boolean = false) {
    const seenLengths = new Set<number>();
    let picked = 0;
    for (const item of list) {
      if (picked >= max) break;
      if (selectedSet.has(item.word)) continue;
      if (diversity && seenLengths.has(item.word.length)) continue;
      selected.push(item.word);
      selectedSet.add(item.word);
      seenLengths.add(item.word.length);
      picked++;
    }
  }

  // 从 P1 选（优先长度多样性）
  const p1Target = Math.min(count, p1Candidates.length);
  pickFrom(p1Candidates, p1Target, true);

  // 如果 P1 不够，从 P2 补充（高频常用词）
  if (selected.length < count) {
    const remain = count - selected.length;
    pickFrom(p2Candidates, remain, true);
  }

  // 如果还不够，从 P3 补充（故事高频词）
  if (selected.length < count) {
    const remain = count - selected.length;
    pickFrom(p3Candidates, remain, true);
  }

  // 最后移除"是更长词的子串"的候选（如"孙悟空"存在则去掉"孙悟""悟空"）
  const filtered = removeSubstringCandidates(selected);

  return filtered.slice(0, count);
}
