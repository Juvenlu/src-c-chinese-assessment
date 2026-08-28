// Type definitions for SRC-C system

export type Level = 'SRC100' | 'SRC300' | 'SRC500' | 'SRC800';
export type RJBLevel = 'RJB100' | 'RJB300' | 'RJB500' | 'RJB800';
export type TestMode = 'full' | 'sampling'; // full = 逐字测试, sampling = 抽测闯关
export type LanguageEnv = 'chinese_primary' | 'bilingual' | 'english_primary' | 'other';
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';
export type TestPart = 1 | 2 | 3 | 4;

// 字库体系
export type CharSystem = 'SRC' | 'RJB'; // SRC = 阅读高频字, RJB = 人教版

// 掌握状态
export type MasteryStatus =
  | 'untested'        // 未测试
  | 'first_test'      // 初次测试
  | 'learning'        // 掌握中
  | 'basic_mastery'   // 基本掌握
  | 'stable_mastery'  // 稳定掌握
  | 'needs_review';   // 需要复习

export interface Child {
  id: string;
  nickname: string;
  age: number;
  grade: string;
  country: string;
  home_language: LanguageEnv | null;
  home_language_other: string | null;
  created_at: string;
  updated_at?: string | null;
  status?: string;
  parent_id?: string;
}

export interface CreateChildInput {
  nickname: string;
  age: number;
  grade: string;
  country: string;
  home_language?: LanguageEnv | null;
  home_language_other?: string;
  guest_session_id?: string;
}

export interface QuestionItem {
  id: string;
  level: Level;
  character: string;
  word: string;
  sentence: string;
  meaning_question: string;
  options: string[];
  answer: string;
  story_text?: string;
  story_question?: string;
  story_options?: string[];
  story_answer?: string;
  created_at: string;
  updated_at?: string;
}

export interface TestSession {
  id: string;
  child_id: string;
  level: Level;
  status: SessionStatus;
  started_at: string;
  completed_at?: string;
  time_limit_seconds: number;
  created_at: string;
}

export interface TestAnswer {
  id: string;
  session_id: string;
  question_id: string;
  part: TestPart;
  is_recognized?: boolean;
  selected_answer?: string;
  is_correct: boolean;
  reaction_time_ms?: number;
  question_content?: string;
  created_at: string;
}

export interface TestResult {
  id: string;
  session_id: string;
  child_id: string;
  level: Level;
  character_score: number;
  vocab_score: number;
  reading_score: number;
  comprehension_score: number;
  total_score: number;
  stable_char_count: number;
  stable_vocab_count: number;
  character_mastery_rate: number;
  vocab_mastery_rate: number;
  reading_comprehension_rate: number;
  completion_time_seconds: number;
  known_characters?: string[]; // array of recognized characters (fulltest)
  test_mode?: 'sampling' | 'full'; // test mode
  created_at: string;
}

export interface CreateSessionInput {
  child_id: string;
  level: Level;
  test_mode?: 'sampling' | 'full';
}

export interface SubmitAnswerInput {
  session_id: string;
  question_id?: string;
  part: TestPart;
  is_recognized?: boolean;
  selected_answer?: string;
  is_correct: boolean;
  reaction_time_ms?: number;
  question_content?: string;
}

export const LEVEL_CONFIG: Record<Level, { timeLimitSeconds: number; charCount: number; vocabMultiplier: number; label: string; vocabCount: number; charSampleRatio: number; wordSampleRatio: number }> = {
  SRC100: { timeLimitSeconds: 300, charCount: 114, vocabMultiplier: 2.86, label: '入门级', vocabCount: 128, charSampleRatio: 1.0, wordSampleRatio: 0.6 },
  SRC300: { timeLimitSeconds: 480, charCount: 317, vocabMultiplier: 2.86, label: '基础级', vocabCount: 346, charSampleRatio: 0.3, wordSampleRatio: 0.12 },
  SRC500: { timeLimitSeconds: 720, charCount: 528, vocabMultiplier: 2.86, label: '进阶级', vocabCount: 558, charSampleRatio: 0.25, wordSampleRatio: 0.1 },
  SRC800: { timeLimitSeconds: 900, charCount: 813, vocabMultiplier: 2.86, label: '高级', vocabCount: 820, charSampleRatio: 0.2, wordSampleRatio: 0.08 },
};

// 人教版识字表配置
export const RJB_LEVEL_CONFIG: Record<RJBLevel, { charCount: number; label: string; srcMapping: Level }> = {
  RJB100: { charCount: 100, label: '一年级上册', srcMapping: 'SRC100' },
  RJB300: { charCount: 300, label: '一年级', srcMapping: 'SRC300' },
  RJB500: { charCount: 499, label: '二年级', srcMapping: 'SRC500' },
  RJB800: { charCount: 799, label: '三年级', srcMapping: 'SRC800' },
};

/**
 * 默认抽样配置（V1.0 规则）
 * 所有比例可在后台配置页面调整
 */
export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  charTestRatio: {
    SRC100: 1.00,   // 100%全测
    SRC300: 0.30,   // 约30%
    SRC500: 0.25,   // 约25%
    SRC800: 0.20,   // 约20%
  },
  wordTestRatio: {
    SRC100: 0.50,   // 约50%
    SRC300: 0.40,   // 约40%
    SRC500: 0.40,   // 约40%
    SRC800: 0.38,   // 约35-40%
  },
  reviewRatio: 0.45,        // 复测池比例
  newItemRatio: 0.45,       // 新题池比例
  retentionRatio: 0.10,   // 稳定性复测池比例
  stableMinCorrectStreak: 2,     // 稳定掌握：最近至少2次正确
  stableMinAccuracy: 0.80,        // 稳定掌握：累计正确率≥80%
  forgetThresholdDays: 90,          // 遗忘阈值：3个月
};

export const PART_WEIGHTS = {
  character: 0.30,
  vocabulary: 0.30,
  reading: 0.20,
  comprehension: 0.20,
};

export const PART_NAMES: Record<TestPart, string> = {
  1: '字形识别',
  2: '词汇识别',
  3: '句子识别',
  4: '理解测试',
};

export const PART_ICONS: Record<TestPart, string> = {
  1: 'Eye',
  2: 'BookOpen',
  3: 'MessageSquare',
  4: 'Lightbulb',
};

export const LANGUAGE_ENV_LABELS: Record<LanguageEnv, string> = {
  chinese_primary: '中文为主要语言',
  bilingual: '中英双语',
  english_primary: '英文为主',
  other: '其他',
};

// 逐字测试中每个字的测试结果
export interface CharTestResult {
  character: string;
  recognized: boolean;       // 是否认识
  reaction_time_ms: number;  // 反应时间
}

// 逐字测试中每个词组的测试结果
export interface WordTestResult {
  word: string;
  recognized: boolean;
  reaction_time_ms: number;
  reason: SamplingReason;
}

// 词组智能抽测的原因
export type SamplingReason = 
  | 'recent_char_error'    // 最近单字错误
  | 'historical_word_error' // 历史词组错误
  | 'low_mastery'           // 掌握度低
  | 'forget_check'          // 遗忘验证
  | 'random_check';         // 随机抽测

// 词组抽测项
export interface SampledWord {
  word: string;
  reason: SamplingReason;
  srcLevel: Level;
  characters: string[];
}

// 逐字测试的会话数据
export interface FullTestSession {
  childId: string;
  childName: string;
  level: Level;
  results: CharTestResult[];
  startedAt: number;
  completedAt?: number;
  currentIndex: number;
}

// ===== V1.0 新增：个人掌握度记录 =====

/**
 * 单个汉字的掌握度记录
 * 用于"个人测字历史数据库"，跟踪每个孩子对每个字的长期掌握情况
 */
export interface CharacterMastery {
  id: string;
  child_id: string;
  character: string;
  level: Level;           // 所属SRC等级
  system: CharSystem;     // 所属字库体系
  total_tests: number;    // 累计测试次数
  correct_count: number;  // 累计正确次数
  last_result: boolean;   // 最近一次测试结果
  last_test_date: string; // 最后测试日期
  streak_correct: number; // 连续正确次数
  streak_wrong: number;   // 连续错误次数
  mastery_status: MasteryStatus;
  mastery_rate: number;   // 掌握率 (0-1)
  created_at: string;
  updated_at: string;
}

/**
 * 单个词组的掌握度记录
 */
export interface VocabularyMastery {
  id: string;
  child_id: string;
  word: string;
  characters: string[];   // 组成汉字
  level: Level;
  total_tests: number;
  correct_count: number;
  last_result: boolean;
  last_test_date: string;
  streak_correct: number;
  streak_wrong: number;
  mastery_status: MasteryStatus;
  mastery_rate: number;
  created_at: string;
  updated_at: string;
}

// ===== V1.0 新增：智能抽样相关类型 =====

/**
 * 测试池类型
 */
export type ItemPoolType =
  | 'review'      // 复测池：未稳定掌握的项目
  | 'new'         // 新题池：从未测试过的项目
  | 'retention';  // 稳定性复测池：已掌握但需验证遗忘

/**
 * 抽样配置（可后台调整）
 */
export interface SamplingConfig {
  // 单字测试比例（相对于该等级总字数）
  charTestRatio: Record<Level, number>;
  // 词组测试比例（相对于本次单字测试量）
  wordTestRatio: Record<Level, number>;
  // 复测池比例
  reviewRatio: number;
  // 新题池比例
  newItemRatio: number;
  // 稳定性复测池比例
  retentionRatio: number;
  // 稳定掌握判定：最近正确次数
  stableMinCorrectStreak: number;
  // 稳定掌握判定：最低正确率
  stableMinAccuracy: number;
  // 遗忘阈值（天）
  forgetThresholdDays: number;
}

/**
 * 单个抽样项
 */
export interface SampledItem {
  content: string;        // 单字或词组
  type: 'character' | 'word';
  poolType: ItemPoolType; // 来自哪个池
  priority: number;       // 优先级（越小越先）
  level: Level;
}

// ===== V1.0 新增：成长地图类型 =====

/**
 * 成长地图数据
 *
 * 核心架构字段（语义明确，后端统一计算）：
 * - confirmed_level: 正式测试确认的级别，null = 未完成正式测试
 * - estimated_level: 快速测评预估级别，null = 未完成快速测评
 * - recommended_test_level: 推荐的正式测试级别
 * - current_level: 当前级别 = confirmed_level（正式测试为唯一参照）
 * - next_level: 下一级别（基于 confirmed_level 计算）
 * - assessment_status: not_started / estimated / confirmed
 *
 * 兼容旧字段（前端展示用，后续逐步迁移）：
 * - currentLevel / nextLevel / assessmentType / suggestedLevel
 */
export interface GrowthMapData {
  childId: string;

  // ===== 核心架构字段 =====
  confirmed_level: Level | null;
  estimated_level: Level | null;
  recommended_test_level: Level;
  current_level: Level | null;
  next_level: Level | null;
  assessment_status: 'not_started' | 'estimated' | 'confirmed';

  // ===== 兼容旧字段 =====
  currentLevel: Level;
  assessmentType: 'formal' | 'quick' | 'none';
  suggestedLevel?: Level;

  // 三维度掌握度
  srcMastery: {
    level: Level;
    mastered: number;
    learning: number;
    untested: number;
    masteryRate: number;  // 已测试中的掌握率
    total: number;       // 该级字库总量
    isFullTest: boolean; // 是否为全测（掌握率≥95%）
  };
  
  pepMastery: {
    level: RJBLevel;
    mastered: number;
    total: number;
    masteryRate: number;
    covered: number;     // 本次测试覆盖的教材字数（抽样估算）
    full_overlap: number; // SRC与教材全集交集数（字库规模对照）
    coverageRate: number; // 覆盖率（covered/total）
  };
  
  vocabMastery: {
    mastered: number;    // 掌握数（全测=答对数量，抽测=估算掌握量）
    tested: number;      // 本次测试数量
    correct: number;     // 本次答对数量
    masteryRate: number; // 掌握率 correct/tested
    isFullTest: boolean; // 是否全量测试
  };
  
  // 下一目标
  nextLevel?: Level;

  quickConfidence?: 'high' | 'medium' | 'low';
  
  // 成长趋势
  trend: {
    charMastery: { date: string; rate: number }[];
    vocabMastery: { date: string; rate: number }[];
  };
  
  // 优势与建议
  strengths: string[];
  areasToImprove: string[];
  recommendations: string[];
}

// ===== V1.0 新增：测试评估历史 =====

export interface AssessmentHistory {
  id: string;
  child_id: string;
  level: Level;
  test_date: string;
  char_mastery_rate: number;   // 单字掌握率
  vocab_mastery_rate: number;  // 词组掌握率
  rjb_char_count: number;      // 教材识字数
  src_char_count: number;      // 阅读高频识字数
  test_mode: TestMode;
  total_questions: number;
  created_at: string;
}

// ===== V1.0 新增：后台系统配置 =====

/**
 * 系统配置项（可后台调整，不写死在代码中）
 */
export interface SystemConfig {
  id: string;
  config_key: string;
  config_value: string;
  description?: string;
  updated_at: string;
}
