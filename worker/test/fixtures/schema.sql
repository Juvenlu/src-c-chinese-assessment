-- P3-H-12C 本地测试 schema（node:sqlite :memory:）
-- 复刻与版本管理相关的最小表结构：Production pg-to-d1 schema + 003 迁移结果。

PRAGMA foreign_keys = ON;

CREATE TABLE children (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT NOT NULL,
  nickname    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE book_episodes (
  id             INTEGER PRIMARY KEY,
  series_name    TEXT,
  episode_number INTEGER,
  episode_title  TEXT,
  status         TEXT NOT NULL DEFAULT 'published'
);

CREATE TABLE book_rewrite_versions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id              INTEGER NOT NULL,
  child_id                TEXT,
  target_level            TEXT NOT NULL,
  pages_json              TEXT NOT NULL DEFAULT '[]',
  frontier_targets_json   TEXT NOT NULL DEFAULT '[]',
  status                  TEXT NOT NULL DEFAULT 'review',
  version                 INTEGER NOT NULL DEFAULT 1,
  total_chars             INTEGER NOT NULL DEFAULT 0,
  unique_chars            INTEGER NOT NULL DEFAULT 0,
  max_page_chars          INTEGER NOT NULL DEFAULT 0,
  validation_result_json  TEXT,
  generation_params_json  TEXT,
  retry_count             INTEGER NOT NULL DEFAULT 0,
  failure_reason          TEXT,
  created_at              INTEGER NOT NULL,
  finalized_at            INTEGER,
  finalized_by            TEXT,
  FOREIGN KEY (episode_id) REFERENCES book_episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id)   REFERENCES children(id) ON DELETE SET NULL,
  CHECK (status IN ('ai_draft','review','final','rejected','failed')),
  CHECK (target_level IN ('SRC100','SRC300','SRC500','SRC800'))
);

-- custom_books：Production 基表（status 无 CHECK）+ 003 新增列 + 部分唯一索引
CREATE TABLE custom_books (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id        TEXT NOT NULL,
  rewrite_id      INTEGER NOT NULL,
  episode_id      INTEGER NOT NULL,
  level_tier      TEXT NOT NULL,
  is_free         INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER,
  pushed_at       INTEGER,
  first_viewed_at INTEGER,
  FOREIGN KEY (child_id)   REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY (rewrite_id) REFERENCES book_rewrite_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES book_episodes(id) ON DELETE CASCADE,
  UNIQUE(child_id, rewrite_id)
);

CREATE UNIQUE INDEX ux_custom_books_active
  ON custom_books(child_id, episode_id) WHERE status = 'active';
CREATE INDEX idx_custom_books_child_episode ON custom_books(child_id, episode_id);
CREATE INDEX idx_custom_books_status ON custom_books(status);

CREATE TABLE reading_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id       TEXT NOT NULL,
  custom_book_id INTEGER NOT NULL,
  start_time     INTEGER NOT NULL,
  end_time       INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  pages_read     INTEGER NOT NULL DEFAULT 0,
  total_pages    INTEGER NOT NULL DEFAULT 0,
  completed      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY (custom_book_id) REFERENCES custom_books(id) ON DELETE CASCADE
);

CREATE TABLE reading_feedback (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id       TEXT NOT NULL,
  custom_book_id INTEGER NOT NULL,
  interest       TEXT CHECK (interest IN ('like','neutral','dislike')),
  difficulty     TEXT CHECK (difficulty IN ('easy','just_right','hard')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE,
  FOREIGN KEY (custom_book_id) REFERENCES custom_books(id) ON DELETE CASCADE,
  UNIQUE(child_id, custom_book_id)
);
