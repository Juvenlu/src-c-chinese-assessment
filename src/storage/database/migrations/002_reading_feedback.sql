-- ============================================================
-- reading_feedback — 绘本阅读反馈（兴趣 + 难度）
--
-- 独立表，不修改 reading_records。
-- 每个 child_id + custom_book_id 至多一条反馈（UNIQUE）。
-- 幂等建表（IF NOT EXISTS），仅创建文件，不在本地执行。
-- 时间单位：Unix 秒（与 D1 其它表一致）。
-- ============================================================

CREATE TABLE IF NOT EXISTS reading_feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id        TEXT    NOT NULL,
  custom_book_id  INTEGER NOT NULL,

  -- like=喜欢 / neutral=一般 / dislike=不喜欢；NULL=未填
  interest        TEXT    CHECK (interest IN ('like', 'neutral', 'dislike')),
  -- easy=有点简单 / just_right=刚刚好 / hard=有点难；NULL=未填
  difficulty      TEXT    CHECK (difficulty IN ('easy', 'just_right', 'hard')),

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  FOREIGN KEY (child_id)
    REFERENCES children(id) ON DELETE CASCADE,

  FOREIGN KEY (custom_book_id)
    REFERENCES custom_books(id) ON DELETE CASCADE,

  UNIQUE(child_id, custom_book_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_feedback_child
  ON reading_feedback(child_id);

CREATE INDEX IF NOT EXISTS idx_reading_feedback_book
  ON reading_feedback(custom_book_id);
