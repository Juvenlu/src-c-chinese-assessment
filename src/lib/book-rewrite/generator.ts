/**
 * LLM 绘本改写服务
 *
 * Single Structured LLM Generation
 * 一次 LLM 调用，输入 Master Story + 等级规则 + Frontier，
 * 输出整本 8-10 页改写文本的 JSON。
 */

import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import type { Level } from '../types';
import type { RewritePage } from './types';
import { getLevelRulesPrompt } from './level-rules';

const SYSTEM_PROMPT = `你是一位专业的中文分级阅读改写专家。

你的任务不是创作新故事，而是：
把用户提供的 Master Story（原始故事）改写成适合目标 SRC 等级的中文阅读文本。

【核心原则】
1. Master Story 是最高内容权威，你只调整语言难度，不改变故事本身
2. 保持人物、事件、情节顺序、因果关系、结局完全不变
3. 保持页面对应关系：第N页的改写文仍然对应第N页的图
4. 不能换图、不能重排页数、不能增加或减少页数
5. 不可以添加原始故事没有的核心事件或人物
6. 不可以删除原始故事的核心事件

【语言改写原则】
降低语言难度，但不降低故事内容价值。
即使孩子年龄较大但中文等级较低，也不要用幼儿化语言（不要儿歌式、不要无意义叠词、不要过度卖萌）。
自然的副词（慢慢地、悄悄地、轻轻地）可以正常使用。

【Frontier 处理】
Frontier 是希望孩子在阅读中自然学到的新词或新表达。
- 把 Frontier 自然地融入故事，不要生硬堆砌
- 每个 Frontier 尽量在不同语境中至少出现 2 次
- 如果某个 Frontier 无法自然进入当前故事，宁可放弃也不要硬加
- 不要为了 Frontier 改变剧情

【输出格式】
必须输出严格的 JSON，不要有任何额外文字或 markdown 标记。
JSON 结构：
{
  "pages": [
    {
      "page": 1,
      "text": "改写后的第一页文本",
      "frontier": ["在本页出现的frontier词"]
    }
  ],
  "rewrite_notes": "简要说明改写思路（可选，最多50字）"
}

页数必须与输入完全一致。`;

/**
 * 构建用户 prompt
 */
function buildUserPrompt(
  masterPages: { page: number; text: string; image_url?: string }[],
  level: Level,
  frontiers: string[],
): string {
  const pagesText = masterPages
    .map((p) => `【第${p.page}页】\n${p.text}`)
    .join('\n\n');

  const frontierText = frontiers.length > 0
    ? frontiers.map((f, i) => `${i + 1}. ${f}`).join('\n')
    : '（无）';

  return `
${getLevelRulesPrompt(level)}

【Master Story（原始故事）】
共 ${masterPages.length} 页。

${pagesText}

【Frontier（学习目标）】
请在改写中自然融入以下 Frontier（新词/新表达）：
${frontierText}

要求：
1. 保持 ${masterPages.length} 页，每页对应原文的第N页
2. 调整语言难度到目标等级
3. 自然融入 Frontier，每个尽量出现至少 2 次
4. 保持故事内容、人物、事件顺序不变
5. 输出严格的 JSON 格式，不要 markdown 标记
`.trim();
}

/**
 * 调用 LLM 生成改写版本
 * @param masterPages 原始页面
 * @param level 目标等级
 * @param frontiers 目标 Frontier 列表
 * @param headers 请求头（用于转发追踪）
 * @returns 改写后的页面列表
 */
export async function generateRewrite(
  masterPages: { page: number; text: string; image_url?: string }[],
  level: Level,
  frontiers: string[],
  headers?: Headers,
): Promise<{ pages: RewritePage[]; rewrite_notes?: string }> {
  const config = new Config();

  const customHeaders = headers
    ? HeaderUtils.extractForwardHeaders(headers as any)
    : undefined;

  const client = new LLMClient(config, customHeaders);

  const userPrompt = buildUserPrompt(masterPages, level, frontiers);

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const response = await client.invoke(messages as any, {
    model: 'doubao-seed-2-0-pro-260215',
    temperature: 0.7,
  });

  const content = response.content.trim();

  // 尝试解析 JSON
  let parsed: any;
  try {
    // 清理可能的 markdown 代码块标记
    const cleaned = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`LLM 输出不是有效 JSON: ${(e as Error).message}\n原始输出: ${content.slice(0, 500)}`);
  }

  if (!parsed.pages || !Array.isArray(parsed.pages)) {
    throw new Error('LLM 输出缺少 pages 数组');
  }

  // 验证页数一致
  if (parsed.pages.length !== masterPages.length) {
    throw new Error(
      `页数不匹配：输入 ${masterPages.length} 页，输出 ${parsed.pages.length} 页`,
    );
  }

  // 标准化输出
  const pages: RewritePage[] = parsed.pages.map((p: any, idx: number) => ({
    page: p.page ?? idx + 1,
    text: (p.text || '').trim(),
    frontier: Array.isArray(p.frontier) ? p.frontier : [],
    image_url: masterPages[idx]?.image_url,
    original_text: masterPages[idx]?.text,
  }));

  return {
    pages,
    rewrite_notes: parsed.rewrite_notes,
  };
}
