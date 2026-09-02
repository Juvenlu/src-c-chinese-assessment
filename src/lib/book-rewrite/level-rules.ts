/**
 * SRC 各等级语言规则
 * 用于 LLM 改写时的风格控制
 *
 * 注意：这是语言难度规则，不是字库范围。AI 可以使用更简单的常用字。
 */
import type { Level } from '../types';

export interface LevelLanguageRule {
  level: Level;
  name: string;
  description: string;
  /** 目标阅读量（中文字符数，全书） */
  targetReadingMin: number;
  targetReadingMax: number;
  /** 语言特征 */
  features: string[];
  /** 句子平均长度（字） */
  avgSentenceLen: string;
}

export const LEVEL_LANGUAGE_RULES: Record<Level, LevelLanguageRule> = {
  SRC100: {
    level: 'SRC100',
    name: '入门级',
    description: '高频字、短句子、简单动作和关系，直接表达',
    targetReadingMin: 100,
    targetReadingMax: 180,
    features: [
      '只用最常见的高频汉字和简单词汇',
      '句子简短，一句话表达一个意思',
      '动作简单：走、跑、看、笑、吃、玩',
      '人物关系简单，直接称呼',
      '不用成语和复杂表达',
      '少用连接词（因为、所以、但是）',
    ],
    avgSentenceLen: '6-10字',
  },
  SRC300: {
    level: 'SRC300',
    name: '基础级',
    description: '简单连续叙事，基础细节，简单因果，常见连接词',
    targetReadingMin: 280,
    targetReadingMax: 380,
    features: [
      '可以有简单的连续叙事（然后、接着）',
      '加入少量细节描写（颜色、样子、声音）',
      '简单因果关系（因为...所以...）',
      '常见连接词：和、也、就、才、又、还',
      '人物有简单的心情和想法',
      '词汇比SRC100丰富，但都是常用词',
    ],
    avgSentenceLen: '10-15字',
  },
  SRC500: {
    level: 'SRC500',
    name: '进阶级',
    description: '更完整叙事，更多细节，人物状态，因果关系，简单推理',
    targetReadingMin: 500,
    targetReadingMax: 600,
    features: [
      '叙事更完整，有开头、发展、结尾',
      '人物有外貌、动作、表情、心理描写',
      '因果关系更复杂（虽然...但是...、如果...就...）',
      '适当的过渡表达（过了一会儿、就在这时）',
      '可以有简单的推理和想法',
      '词汇量增加，使用更精确的动词和形容词',
    ],
    avgSentenceLen: '12-18字',
  },
  SRC800: {
    level: 'SRC800',
    name: '高级',
    description: '丰富叙事，完整场景，人物动机，因果关系，推理，更高信息密度',
    targetReadingMin: 700,
    targetReadingMax: 900,
    features: [
      '场景描写更丰富，有画面感',
      '人物有动机和内心变化',
      '因果关系多层嵌套',
      '可以有简单的推理和判断',
      '信息密度更高，一句话包含更多信息',
      '句式更复杂但自然，有长有短',
      '使用更多成语和固定表达（常用的）',
    ],
    avgSentenceLen: '15-25字',
  },
};

/** 获取等级语言规则的 prompt 文本 */
export function getLevelRulesPrompt(level: Level): string {
  const rule = LEVEL_LANGUAGE_RULES[level];
  return `
【目标等级：${rule.level}（${rule.name}）】

语言难度要求：
${rule.description}

具体特征：
${rule.features.map((f, i) => `${i + 1}. ${f}`).join('\n')}

句子长度：约 ${rule.avgSentenceLen}

目标阅读量：全书中文字符 ${rule.targetReadingMin}-${rule.targetReadingMax} 字
  `.trim();
}
