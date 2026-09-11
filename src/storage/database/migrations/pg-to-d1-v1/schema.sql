-- ============================================================
-- SRC Primary Database
-- D1 Schema V2.1 — FINAL / Schema Freeze
-- Source: assets/# SRC Primary Database.txt
-- Generated: P0-8.5A (read-only extraction)
-- ============================================================
-- 16 tables / 208 columns / 16 PK / 8 UNIQUE / 19 FK
-- 17 CHECK / 38 INDEX / 6 AUTOINCREMENT
-- ============================================================

-- ============================================================
-- 1. parents
-- ============================================================
CREATE TABLE parents (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  CHECK (status IN ('active', 'suspended', 'deleted'))
);

CREATE INDEX idx_parents_email ON parents(email);
CREATE INDEX idx_parents_status ON parents(status);

-- ============================================================
-- 2. children
-- ============================================================
CREATE TABLE children (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  age INTEGER NOT NULL,
  grade TEXT NOT NULL,
  country TEXT NOT NULL,
  home_language TEXT,
  home_language_other TEXT,
  status TEXT NOT NULL DEFAULT 'active',

  estimated_level TEXT,
  confirmed_level TEXT,
  assessment_status TEXT NOT NULL DEFAULT 'not_started',

  created_at INTEGER NOT NULL,
  updated_at INTEGER,

  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE,

  CHECK (
    assessment_status IN (
      'not_started',
      'quick_done',
      'formal_in_progress',
      'formal_done'
    )
  ),

  CHECK (
    estimated_level IS NULL OR
    estimated_level IN ('SRC100', 'SRC300', 'SRC500', 'SRC800')
  ),

  CHECK (
    confirmed_level IS NULL OR
    confirmed_level IN ('SRC100', 'SRC300', 'SRC500', 'SRC800')
  )
);

CREATE INDEX idx_children_parent_id ON children(parent_id);
CREATE INDEX idx_children_confirmed_level ON children(confirmed_level);
CREATE INDEX idx_children_status ON children(status);

-- ============================================================
-- 3. question_bank
-- ============================================================
CREATE TABLE question_bank (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  char_system TEXT NOT NULL DEFAULT 'SRC',
  difficulty INTEGER NOT NULL DEFAULT 2,

  character TEXT NOT NULL,
  word TEXT NOT NULL,
  sentence TEXT NOT NULL,

  meaning_question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  answer TEXT NOT NULL,

  story_text TEXT,
  story_question TEXT,
  story_options_json TEXT,
  story_answer TEXT,

  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX idx_question_level ON question_bank(level);
CREATE INDEX idx_question_character ON question_bank(character);
CREATE INDEX idx_question_word ON question_bank(word);

-- ============================================================
-- 4. test_sessions
-- ============================================================
CREATE TABLE test_sessions (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  level TEXT,
  test_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',

  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  time_limit_seconds INTEGER,
  total_questions INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,

  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE,

  CHECK (test_type IN ('quick', 'sampling', 'formal')),

  CHECK (
    (test_type = 'quick') OR
    (
      test_type IN ('sampling', 'formal')
      AND level IN ('SRC100', 'SRC300', 'SRC500', 'SRC800')
    )
  ),

  CHECK (status IN ('in_progress', 'completed', 'abandoned'))
);

CREATE INDEX idx_sessions_child_id ON test_sessions(child_id);
CREATE INDEX idx_sessions_type ON test_sessions(test_type);
CREATE INDEX idx_sessions_status ON test_sessions(status);
CREATE INDEX idx_sessions_child_status
  ON test_sessions(child_id, test_type, status);

-- ============================================================
-- 5. test_answers
-- ============================================================
CREATE TABLE test_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question_id TEXT,
  part INTEGER NOT NULL,

  question_content TEXT,
  selected_answer TEXT,
  is_correct INTEGER NOT NULL,
  reaction_time_ms INTEGER,

  created_at INTEGER NOT NULL,

  FOREIGN KEY (session_id)
    REFERENCES test_sessions(id) ON DELETE CASCADE,

  FOREIGN KEY (question_id)
    REFERENCES question_bank(id) ON DELETE SET NULL,

  CHECK (part IN (1, 2, 3, 4))
);

CREATE INDEX idx_answers_session_id ON test_answers(session_id);
CREATE INDEX idx_answers_question_id ON test_answers(question_id);
CREATE INDEX idx_answers_session_part
  ON test_answers(session_id, part);

-- ============================================================
-- 6. test_results
-- ============================================================
CREATE TABLE test_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  child_id TEXT NOT NULL,

  level TEXT NOT NULL,
  test_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',

  character_score INTEGER NOT NULL,
  vocab_score INTEGER NOT NULL,
  reading_score INTEGER NOT NULL,
  comprehension_score INTEGER NOT NULL,
  total_score INTEGER NOT NULL,

  stable_char_count INTEGER NOT NULL,
  stable_vocab_count INTEGER NOT NULL,

  completion_time_seconds INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,

  known_characters_json TEXT,
  weak_characters_json TEXT,
  part_breakdown_json TEXT,

  completed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,

  FOREIGN KEY (session_id)
    REFERENCES test_sessions(id) ON DELETE CASCADE,

  FOREIGN KEY (child_id)
    REFERENCES children(id) ON DELETE CASCADE,

  CHECK (test_type IN ('sampling', 'formal')),

  CHECK (status IN ('completed', 'invalid')),

  CHECK (
    level IN ('SRC100', 'SRC300', 'SRC500', 'SRC800')
  )
);

CREATE INDEX idx_results_child_id
  ON test_results(child_id);

CREATE INDEX idx_results_level
  ON test_results(level);

CREATE INDEX idx_results_child_type
  ON test_results(child_id, test_type, status);

CREATE INDEX idx_results_completed_at
  ON test_results(completed_at DESC);

-- ============================================================
-- 7. quick_assessment_results
-- ============================================================
CREATE TABLE quick_assessment_results (
  id TEXT PRIMARY KEY,
  session_id TEXT UNIQUE,
  child_id TEXT,
  guest_session_id TEXT,

  character_level_l INTEGER,
  character_level_u INTEGER,
  word_level_l INTEGER,
  word_level_u INTEGER,
  reading_base INTEGER,

  confidence TEXT NOT NULL,
  recommended_level TEXT NOT NULL,

  total_questions INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,

  raw_result_json TEXT,

  completed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,

  FOREIGN KEY (session_id)
    REFERENCES test_sessions(id) ON DELETE SET NULL,

  FOREIGN KEY (child_id)
    REFERENCES children(id) ON DELETE SET NULL,

  CHECK (confidence IN ('high', 'medium', 'low')),

  CHECK (
    recommended_level IN ('SRC100', 'SRC300', 'SRC500', 'SRC800')
  )
);

CREATE INDEX idx_quick_child_id
  ON quick_assessment_results(child_id);

CREATE INDEX idx_quick_confidence
  ON quick_assessment_results(confidence);

-- ============================================================
-- 8. book_episodes
-- ============================================================
CREATE TABLE book_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_name TEXT NOT NULL,
  series_id INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  episode_title TEXT NOT NULL,

  page_count INTEGER NOT NULL,
  level_tier TEXT NOT NULL DEFAULT 'SRC500',
  status TEXT NOT NULL DEFAULT 'draft',

  cover_image_url TEXT,
  description TEXT,
  total_words INTEGER,

  created_at INTEGER NOT NULL,
  updated_at INTEGER,

  UNIQUE(series_id, episode_number)
);

CREATE INDEX idx_episodes_series
  ON book_episodes(series_id);

CREATE INDEX idx_episodes_status
  ON book_episodes(status);

-- ============================================================
-- 9. book_episode_pages
-- ============================================================
CREATE TABLE book_episode_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  page_number INTEGER NOT NULL,

  image_url TEXT NOT NULL,
  original_text TEXT NOT NULL,

  new_chars_json TEXT NOT NULL DEFAULT '[]',
  total_chars INTEGER NOT NULL DEFAULT 0,
  unique_chars INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL,

  FOREIGN KEY (episode_id)
    REFERENCES book_episodes(id) ON DELETE CASCADE,

  UNIQUE(episode_id, page_number)
);

CREATE INDEX idx_pages_episode_id
  ON book_episode_pages(episode_id);

-- ============================================================
-- 10. book_rewrite_versions
-- ============================================================
CREATE TABLE book_rewrite_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  child_id TEXT,
  target_level TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'ai_draft',
  version INTEGER NOT NULL DEFAULT 1,

  pages_json TEXT NOT NULL,
  frontier_targets_json TEXT NOT NULL DEFAULT '[]',

  total_chars INTEGER NOT NULL DEFAULT 0,
  unique_chars INTEGER NOT NULL DEFAULT 0,
  max_page_chars INTEGER NOT NULL DEFAULT 0,

  validation_result_json TEXT,
  audit_result_json TEXT,
  audit_passed INTEGER NOT NULL DEFAULT 0,

  generation_params_json TEXT,
  generator_version TEXT,

  retry_count INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,

  created_at INTEGER NOT NULL,
  finalized_at INTEGER,
  finalized_by TEXT,

  FOREIGN KEY (episode_id)
    REFERENCES book_episodes(id) ON DELETE CASCADE,

  FOREIGN KEY (child_id)
    REFERENCES children(id) ON DELETE SET NULL,

  CHECK (
    status IN (
      'ai_draft',
      'review',
      'final',
      'rejected',
      'failed'
    )
  ),

  CHECK (
    target_level IN ('SRC100', 'SRC300', 'SRC500', 'SRC800')
  )
);

CREATE INDEX idx_rewrites_episode_level
  ON book_rewrite_versions(
    episode_id,
    target_level,
    status
  );

CREATE INDEX idx_rewrites_child_id
  ON book_rewrite_versions(child_id);

CREATE INDEX idx_rewrites_status
  ON book_rewrite_versions(status);

-- ============================================================
-- 11. custom_books
-- ============================================================
CREATE TABLE custom_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id TEXT NOT NULL,
  rewrite_id INTEGER NOT NULL,
  episode_id INTEGER NOT NULL,

  level_tier TEXT NOT NULL,

  is_free INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',

  created_at INTEGER NOT NULL,
  updated_at INTEGER,

  FOREIGN KEY (child_id)
    REFERENCES children(id) ON DELETE CASCADE,

  FOREIGN KEY (rewrite_id)
    REFERENCES book_rewrite_versions(id) ON DELETE CASCADE,

  FOREIGN KEY (episode_id)
    REFERENCES book_episodes(id) ON DELETE CASCADE,

  UNIQUE(child_id, rewrite_id)
);

CREATE INDEX idx_custom_books_child_id
  ON custom_books(child_id);

CREATE INDEX idx_custom_books_level
  ON custom_books(level_tier);

-- ============================================================
-- 12. reading_records
-- ============================================================
CREATE TABLE reading_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id TEXT NOT NULL,
  custom_book_id INTEGER NOT NULL,

  start_time INTEGER NOT NULL,
  end_time INTEGER,

  duration_seconds INTEGER NOT NULL DEFAULT 0,
  pages_read INTEGER NOT NULL DEFAULT 0,
  total_pages INTEGER NOT NULL DEFAULT 0,

  completed INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL,

  FOREIGN KEY (child_id)
    REFERENCES children(id) ON DELETE CASCADE,

  FOREIGN KEY (custom_book_id)
    REFERENCES custom_books(id) ON DELETE CASCADE
);

CREATE INDEX idx_reading_child_id
  ON reading_records(child_id);

CREATE INDEX idx_reading_book_id
  ON reading_records(custom_book_id);

CREATE INDEX idx_reading_created_at
  ON reading_records(created_at);

-- ============================================================
-- 13. subscriptions
-- ============================================================
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL UNIQUE,

  plan_type TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',

  provider TEXT,
  provider_subscription_id TEXT,

  started_at INTEGER,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER DEFAULT 0,

  created_at INTEGER NOT NULL,
  updated_at INTEGER,

  FOREIGN KEY (parent_id)
    REFERENCES parents(id) ON DELETE CASCADE,

  CHECK (
    plan_type IN ('free', 'basic', 'premium')
  ),

  CHECK (
    status IN (
      'active',
      'cancelled',
      'expired',
      'past_due'
    )
  )
);

CREATE INDEX idx_subscriptions_parent_id
  ON subscriptions(parent_id);

CREATE INDEX idx_subscriptions_status
  ON subscriptions(status);

-- ============================================================
-- 14. book_entitlements
-- ============================================================
CREATE TABLE book_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id TEXT NOT NULL UNIQUE,

  plan_type TEXT NOT NULL DEFAULT 'free',

  total_books_allocated INTEGER NOT NULL DEFAULT 10,
  total_books_used INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL,
  updated_at INTEGER,

  FOREIGN KEY (parent_id)
    REFERENCES parents(id) ON DELETE CASCADE
);

CREATE INDEX idx_entitlements_parent_id
  ON book_entitlements(parent_id);

-- ============================================================
-- 15. guest_test_sessions
-- ============================================================
CREATE TABLE guest_test_sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT,

  test_type TEXT NOT NULL DEFAULT 'quick',
  status TEXT NOT NULL DEFAULT 'in_progress',

  result_data_json TEXT,

  claimed INTEGER NOT NULL DEFAULT 0,
  child_id TEXT,

  created_at INTEGER NOT NULL,
  completed_at INTEGER,

  FOREIGN KEY (child_id)
    REFERENCES children(id) ON DELETE SET NULL
);

CREATE INDEX idx_guest_device_id
  ON guest_test_sessions(device_id);

CREATE INDEX idx_guest_claimed
  ON guest_test_sessions(claimed);

-- ============================================================
-- 16. otp_codes
-- ============================================================
CREATE TABLE otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,

  purpose TEXT NOT NULL DEFAULT 'login',

  expires_at INTEGER NOT NULL,
  attempts_remaining INTEGER NOT NULL DEFAULT 5,

  used INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL
);

CREATE INDEX idx_otp_email_expires
  ON otp_codes(email, expires_at);

-- ============================================================
-- END OF SCHEMA
-- 16 tables / 38 indexes
-- ============================================================
