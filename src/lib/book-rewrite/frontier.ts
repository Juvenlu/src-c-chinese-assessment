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
 * @param fullText 全书文本
 * @param knownCharacters 孩子认识的汉字集合
 * @param count 目标数量（默认 4）
 */
export function selectFrontiers(
  fullText: string,
  knownCharacters: string[],
  count: number = 4,
): string[] {
  const knownSet = new Set(knownCharacters);
  const allCandidates = extractCandidateWords(fullText);

  // 候选池：由已知字组成的 2-4 字词
  const knownWordCandidates = allCandidates.filter(
    (w) => !STOP_WORDS.has(w) && isWordFromKnownChars(w, knownSet) && w.length >= 2,
  );

  // 按在全文中出现次数排序（高频优先）
  const scored = knownWordCandidates
    .map((word) => ({
      word,
      count: countWordOccurrences(fullText, word),
    }))
    .filter((w) => w.count >= 2) // 至少出现2次才有学习价值
    .sort((a, b) => b.count - a.count);

  // 多样性：优先选择不同长度的词，避免都是2字词
  const selected: string[] = [];
  const seenLengths = new Set<number>();

  // 第一轮：按长度多样性选
  for (const item of scored) {
    if (selected.length >= count) break;
    if (selected.includes(item.word)) continue;

    // 如果这个长度还没选过，优先选
    if (!seenLengths.has(item.word.length)) {
      selected.push(item.word);
      seenLengths.add(item.word.length);
    }
  }

  // 第二轮：如果不够，补高频词
  if (selected.length < count) {
    for (const item of scored) {
      if (selected.length >= count) break;
      if (!selected.includes(item.word)) {
        selected.push(item.word);
      }
    }
  }

  return selected.slice(0, count);
}
