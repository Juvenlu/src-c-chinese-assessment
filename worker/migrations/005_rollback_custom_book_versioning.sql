-- ============================================================
-- 005_rollback_custom_book_versioning.sql
-- P3-H-12C — 回滚脚本（需要时执行；默认不执行）
--
-- 回滚策略：
--   - 列（pushed_at / first_viewed_at）保留不删。SQLite 删除列支持有限，
--     且旧 Worker 不读取这两列，保留它们对旧版本完全无影响（向后兼容）。
--   - 删除新增的部分唯一索引与辅助索引，恢复“允许多个 active”的旧行为。
--   - 状态值回退：把 archived / deleted 还原为旧体系的 active。
--     注意：这会重新制造“多 active”，仅用于必须整体回退到旧 Worker 的场景；
--     阅读记录与反馈始终保留，本脚本不删除任何业务数据。
--
-- 部署顺序（正向）：先迁移 → 后部署新 Worker。
-- 回滚顺序：先回退 Worker 到旧版本 → 再按需执行本脚本。
-- ============================================================

-- 1) 删除唯一约束，恢复旧版“允许多 active”
DROP INDEX IF EXISTS ux_custom_books_active;
DROP INDEX IF EXISTS idx_custom_books_child_episode;
DROP INDEX IF EXISTS idx_custom_books_status;

-- 2) 状态回退（可选；仅当要彻底回到旧行为时执行）
--    默认注释掉，避免误操作把已归档历史全部重新上架。
-- UPDATE custom_books SET status = 'active'
--  WHERE status IN ('archived', 'deleted');

-- 3) 列保留，不做 DROP：
--    旧 Worker 的 INSERT 显式列出列名，不含 pushed_at/first_viewed_at，
--    新列均为可空，旧代码读写不受影响。
