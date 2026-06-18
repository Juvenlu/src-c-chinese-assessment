// Type definitions for SRC-C system

export type Level = 'SRC300' | 'SRC500' | 'SRC800';
export type TestMode = 'full' | 'sampling'; // full = 逐字测试, sampling = 抽测闯关
export type LanguageEnv = 'chinese_primary' | 'bilingual' | 'english_primary' | 'other';
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';
export type TestPart = 1 | 2 | 3 | 4;

export interface Child {
  id: string;
  name: string;
  age: number;
  grade: string;
  country: string;
  language_env: LanguageEnv;
  created_at: string;
  updated_at?: string;
}

export interface CreateChildInput {
  name: string;
  age: number;
  grade: string;
  country: string;
  language_env: LanguageEnv;
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

export const LEVEL_CONFIG: Record<Level, { timeLimitSeconds: number; charCount: number; vocabMultiplier: number }> = {
  SRC300: { timeLimitSeconds: 480, charCount: 300, vocabMultiplier: 2.86 },
  SRC500: { timeLimitSeconds: 720, charCount: 500, vocabMultiplier: 2.86 },
  SRC800: { timeLimitSeconds: 900, charCount: 800, vocabMultiplier: 2.86 },
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
