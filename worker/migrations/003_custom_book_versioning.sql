-- ============================================================
-- 003_custom_book_versioning.sql
-- P3-H-12C 绘本正式版本管理 — Production 迁移（D1 / SQLite）
--
-- 变更：
--   1. custom_books 增加 pushed_at / first_viewed_at（Unix 秒，可空）
--   2. status 取值扩展为 active / archived / deleted
--      （custom_books 建表时 status 无 CHECK 约束，无需改约束即可写入新值）
--   3. 部分唯一索引：每个 (child_id, episode_id) 至多一条 active
--
-- 执行顺序（强制）：
--   Step A：先执行回填 004_backfill_ted_episode2.sql，把 Ted 的 4 条 active
--           收敛为唯一 active（仅保留 custom_book_id=4）。
--   Step B：再执行本文件。若存量仍存在多个 active，第 3 步建索引会失败
--           （SQLite 不允许在重复键上建 UNIQUE 索引），此时数据未被破坏，
--           处理冲突后重跑本文件即可。
--
-- 幂等 / 一次性说明：
--   - SQLite/D1 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS。
--   - 第 1、2 条 ALTER 为一次性语句：列已存在时会报
--     "duplicate column name"，可忽略——不影响后续语句。
--   - CREATE INDEX 均带 IF NOT EXISTS，可安全重复执行。
--   - 本地通过 worker/migrations/run_local.mjs 执行，runner 在加列前用
--     pragma_table_info 判断，完全幂等。
-- ============================================================

-- 1) 新增推送/首次查看时间列（一次性；重复执行报 duplicate column 可忽略）
ALTER TABLE custom_books ADD COLUMN pushed_at INTEGER;        -- 管理员推送时间，NULL=未推送
ALTER TABLE custom_books ADD COLUMN first_viewed_at INTEGER;  -- 孩子首次查看时间，NULL=未看（“新”）

-- 2) 部分唯一索引：每个孩子每集至多一条 active 正式版
--    archived / deleted 不受此约束（可保留多条历史）
CREATE UNIQUE INDEX IF NOT EXISTS ux_custom_books_active
  ON custom_books(child_id, episode_id)
  WHERE status = 'active';

-- 3) 版本管理列表/状态查询辅助索引（可重复执行）
CREATE INDEX IF NOT EXISTS idx_custom_books_child_episode
  ON custom_books(child_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_custom_books_status
  ON custom_books(status);
