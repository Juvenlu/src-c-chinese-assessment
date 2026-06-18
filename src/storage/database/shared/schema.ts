import { pgTable, serial, varchar, integer, boolean, text, timestamp, jsonb, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// System table - do not delete
export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// Children profiles
export const children = pgTable(
  "children",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 128 }).notNull(),
    age: integer("age").notNull(),
    grade: varchar("grade", { length: 32 }).notNull(),
    country: varchar("country", { length: 64 }).notNull(),
    language_env: varchar("language_env", { length: 32 }).notNull(), // chinese_primary, bilingual, english_primary, other
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("children_created_at_idx").on(table.created_at),
  ]
);

// Question bank
export const questionBank = pgTable(
  "question_bank",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    level: varchar("level", { length: 16 }).notNull(), // SRC300, SRC500, SRC800
    character: varchar("character", { length: 16 }).notNull(),
    word: varchar("word", { length: 64 }).notNull(),
    sentence: text("sentence").notNull(),
    meaning_question: varchar("meaning_question", { length: 256 }).notNull(),
    options: jsonb("options").notNull().$type<string[]>(),
    answer: varchar("answer", { length: 64 }).notNull(),
    story_text: text("story_text"), // for comprehension part
    story_question: varchar("story_question", { length: 256 }),
    story_options: jsonb("story_options").$type<string[]>(),
    story_answer: varchar("story_answer", { length: 64 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("question_bank_level_idx").on(table.level),
  ]
);

// Test sessions
export const testSessions = pgTable(
  "test_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    child_id: varchar("child_id", { length: 36 }).notNull().references(() => children.id),
    level: varchar("level", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("in_progress"), // in_progress, completed, abandoned
    test_mode: varchar("test_mode", { length: 16 }).notNull().default("sampling"), // sampling, full
    started_at: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    time_limit_seconds: integer("time_limit_seconds").notNull(), // 480, 720, 900
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("test_sessions_child_id_idx").on(table.child_id),
    index("test_sessions_status_idx").on(table.status),
    index("test_sessions_created_at_idx").on(table.created_at),
  ]
);

// Test answers for each question
export const testAnswers = pgTable(
  "test_answers",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    session_id: varchar("session_id", { length: 36 }).notNull().references(() => testSessions.id),
    question_id: varchar("question_id", { length: 36 }).references(() => questionBank.id), // nullable for fulltest mode
    part: integer("part").notNull(), // 1=character, 2=vocabulary, 3=sentence, 4=comprehension
    is_recognized: boolean("is_recognized"), // for part 1: true=recognized, false=not recognized
    selected_answer: varchar("selected_answer", { length: 64 }),
    is_correct: boolean("is_correct").notNull(),
    reaction_time_ms: integer("reaction_time_ms"), // milliseconds
    question_content: varchar("question_content", { length: 128 }), // character or word shown (for fulltest)
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("test_answers_session_id_idx").on(table.session_id),
    index("test_answers_question_id_idx").on(table.question_id),
  ]
);

// Test results - computed after test completion
export const testResults = pgTable(
  "test_results",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    session_id: varchar("session_id", { length: 36 }).notNull().references(() => testSessions.id).unique(),
    child_id: varchar("child_id", { length: 36 }).notNull().references(() => children.id),
    level: varchar("level", { length: 16 }).notNull(),
    character_score: integer("character_score").notNull(), // 0-100
    vocab_score: integer("vocab_score").notNull(), // 0-100
    reading_score: integer("reading_score").notNull(), // 0-100
    comprehension_score: integer("comprehension_score").notNull(), // 0-100
    total_score: integer("total_score").notNull(), // 0-100
    stable_char_count: integer("stable_char_count").notNull(), // e.g. 482
    stable_vocab_count: integer("stable_vocab_count").notNull(), // e.g. 1376
    character_mastery_rate: integer("character_mastery_rate").notNull(), // 0-100
    vocab_mastery_rate: integer("vocab_mastery_rate").notNull(), // 0-100
    reading_comprehension_rate: integer("reading_comprehension_rate").notNull(), // 0-100
    completion_time_seconds: integer("completion_time_seconds").notNull(),
    known_characters: jsonb("known_characters").$type<string[]>(), // array of recognized characters (fulltest)
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("test_results_child_id_idx").on(table.child_id),
    index("test_results_level_idx").on(table.level),
    index("test_results_created_at_idx").on(table.created_at),
  ]
);
