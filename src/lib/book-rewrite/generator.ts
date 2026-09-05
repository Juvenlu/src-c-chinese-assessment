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
import { LEVEL_LANGUAGE_RULES } from './level-rules';
import { getStandardV1 } from './standard-v1';
import type { TargetLevel } from './audit/types';

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

【专有名词保护规则】
以下专有名词必须作为完整词使用，绝对不能拆分、不能截断：
- 人名：孙悟空、美猴王
- 地名：花果山、水帘洞
- 作品名：西游记
- 宝物/法术：金箍棒、筋斗云、七十二变
例如：可以写"孙悟空会飞"，但绝对不能写"孙悟会飞"或"悟空会飞"（除非"悟空"本身就是完整称谓）。

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

/** 孩子详细阅读画像（用于个性化改写） */
export interface ChildReadingProfile {
  /** 观测到的已知汉字数量（正式测试中答对的字） */
  observed_known_chars: number;
  /** 稳定识字量估算 */
  stable_char_count: number;
  /** 稳定词汇量估算 */
  stable_vocab_count: number;
  /** 单字掌握率 (%) */
  character_mastery_rate: number;
  /** 词汇掌握率 (%) */
  vocab_mastery_rate: number;
  /** 已掌握的汉字列表（抽样测试结果，可能不全） */
  known_characters?: string[];
  /** 已掌握的词汇列表（抽样测试结果，可能不全） */
  known_vocabulary?: string[];
  /** 弱字信号（正式测试中答错或不稳的字） */
  weak_char_signals?: string[];
  /** 弱词信号（正式测试中答错或不稳的词） */
  weak_word_signals?: string[];
  /** 孩子昵称，用于日志追踪 */
  child_nickname?: string;
  /** 生成模式标识 */
  generation_mode?: 'generic' | 'child_specific' | 'experimental';
  /** 实验性 Profile 标记（非真实儿童数据） */
  experimental_profile?: boolean;
  /** 实验 Profile 标签（如 "exp-A", "exp-B"） */
  experimental_label?: string;
}

/**
 * 构建用户 prompt
 */
function buildUserPrompt(
  masterPages: { page: number; text: string; image_url?: string }[],
  level: Level,
  frontiers: string[],
  childProfile?: ChildReadingProfile,
): string {
  const pagesText = masterPages
    .map((p) => `【第${p.page}页】\n${p.text}`)
    .join('\n\n');

  const frontierText = frontiers.length > 0
    ? frontiers.map((f, i) => `${i + 1}. ${f}`).join('\n')
    : '（无）';

  let childSection = '';
  if (childProfile) {
    const knownCharsSample = (childProfile.known_characters || []).slice(0, 60).join('、');
    const weakChars = (childProfile.weak_char_signals || []).slice(0, 30).join('、');
    const weakWords = (childProfile.weak_word_signals || []).slice(0, 20).join('、');
    const nickname = childProfile.child_nickname ? `（${childProfile.child_nickname}）` : '';

    const charListNote = childProfile.known_characters && childProfile.known_characters.length > 0
      ? `\n- 孩子已掌握的汉字（抽样实测，约${childProfile.known_characters.length}字，例如：${knownCharsSample}）`
      : '';

    const weakCharNote = childProfile.weak_char_signals && childProfile.weak_char_signals.length > 0
      ? `\n- 需要降低负荷的汉字（掌握不稳或答错，共${childProfile.weak_char_signals.length}个：${weakChars}）`
      : '';

    const weakWordNote = childProfile.weak_word_signals && childProfile.weak_word_signals.length > 0
      ? `\n- 需要降低负荷的词汇（掌握不稳，共${childProfile.weak_word_signals.length}个：${weakWords}）`
      : '';

    childSection = `
【孩子阅读画像（个性化参考）】${nickname}
以下是这个孩子的实测数据，用于实现 i+1 个性化：
- 已确认等级：${level}
- 稳定识字量估算：约 ${childProfile.stable_char_count} 字
- 稳定词汇量估算：约 ${childProfile.stable_vocab_count} 词
- 抽样观测已知汉字：${childProfile.observed_known_chars} 个（正式测试中实际答对的字）
- 单字掌握率：${childProfile.character_mastery_rate}%
- 词汇掌握率：${childProfile.vocab_mastery_rate}%${charListNote}${weakCharNote}${weakWordNote}

个性化改写要求：
1. 以 ${level} 等级作为主要难度锚点，确保大部分语言在孩子可理解范围内
2. 在自然的前提下，优先使用孩子已经见过/认识的字和表达
3. 对于"需要降低负荷"的字和词，可以用更简单的同义表达替代，或减少出现频次
4. Frontier 是 i+1 的重点，通过上下文帮助孩子理解新词
5. 不要因为孩子抽样已知字较少就过度简化，保持故事的完整性和语言的自然度
6. 整体难度以目标等级为准，个人数据用于微调用词偏好和负荷分布
7. 不要为了制造差异而强行修改自然语言表达
`;
  }

  return `
${getLevelRulesPrompt(level)}
${childSection}
${getV1GuidancePrompt(level as TargetLevel)}
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
 * V1.0 生产标准生成指引（给 AI 的目标提示）
 * 这些是 Generation Guidance，不要求 AI 精确计算。
 * 最终统计由 Audit Engine 完成。
 */
function getV1GuidancePrompt(level: TargetLevel): string {
  const std = getStandardV1(level);
  return `
【V1.0 生成目标指引（供参考，不必精确计算）】
参考目标（最终由审计系统统计）：
- 目标中文字符数：${std.length_target_min}–${std.length_target_max}字（允许 ${std.length_allowed_max} 字以内）
- 目标等级以外的汉字（外字）出现比例：≤${std.external_char_rate_max}%
- I+1A 新词（用已知字组成的新自然词）比例：${std.i_plus_1a_target_min}–${std.i_plus_1a_target_max}%
- 高负荷词（含≥2个外字的词）比例：≤${std.high_load_rate_max}%
- 单页最高外字率：≤${std.page_peak_load_max}%
- 核心新词最好在故事中自然重复${std.plus_one_repeat_recommended}次以上

注意：
1. 这些是参考目标，不要为了凑数字而机械增减
2. 故事完整性和语言自然度优先
3. 不要改变原始故事的内容和事件顺序
4. 最终是否合格由人工审核决定
`;
}

/** 阅读量验证结果 */
export interface VolumeValidation {
  target_min: number;
  target_max: number;
  actual_count: number;
  volume_status: 'pass' | 'fail_under_limit' | 'fail_over_limit';
}

/** 生成改写结果（含验证信息） */
export interface GenerateResult {
  pages: RewritePage[];
  rewrite_notes?: string;
  volume_validation: VolumeValidation;
  profile_snapshot?: ChildReadingProfile;
  generation_mode: 'generic' | 'child_specific' | 'experimental';
}

/** 统计中文汉字数量 */
function countChinese(text: string): number {
  const m = text.match(/[\u4e00-\u9fa5]/g);
  return m ? m.length : 0;
}

/**
 * 调用 LLM 生成改写版本
 * @param masterPages 原始页面
 * @param level 目标等级
 * @param frontiers 目标 Frontier 列表
 * @param childProfile 孩子阅读画像（可选，用于 i+1 个性化）
 * @param headers 请求头（用于转发追踪）
 * @returns 改写后的页面 + 验证信息
 */
export async function generateRewrite(
  masterPages: { page: number; text: string; image_url?: string }[],
  level: Level,
  frontiers: string[],
  childProfile?: ChildReadingProfile,
  headers?: Headers,
): Promise<GenerateResult> {
  const config = new Config();

  const customHeaders = headers
    ? HeaderUtils.extractForwardHeaders(headers as any)
    : undefined;

  const client = new LLMClient(config, customHeaders);

  const userPrompt = buildUserPrompt(masterPages, level, frontiers, childProfile);

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

  // 阅读量确定性验证
  const rule = LEVEL_LANGUAGE_RULES[level];
  const totalChars = pages.reduce((s, p) => s + countChinese(p.text), 0);
  let volume_status: VolumeValidation['volume_status'] = 'pass';
  if (totalChars < rule.targetReadingMin) volume_status = 'fail_under_limit';
  else if (totalChars > rule.targetReadingMax) volume_status = 'fail_over_limit';

  const generationMode: 'generic' | 'child_specific' | 'experimental' =
    childProfile?.generation_mode === 'generic' ? 'generic'
    : childProfile?.generation_mode === 'experimental' ? 'experimental'
    : 'child_specific';

  return {
    pages,
    rewrite_notes: parsed.rewrite_notes,
    volume_validation: {
      target_min: rule.targetReadingMin,
      target_max: rule.targetReadingMax,
      actual_count: totalChars,
      volume_status,
    },
    profile_snapshot: childProfile,
    generation_mode: generationMode,
  };
}
