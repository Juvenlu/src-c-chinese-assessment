-- ============================================================
-- 004_backfill_ted_episode2.sql
-- P3-H-12C — Ted 西游记EP1（episode_id=2）存量版本收敛
--
-- 目标（已由管理员确认候选 = Rewrite #27 / custom_book_id=4）：
--   - custom_book_id=4 保持 active（唯一正式版）
--   - custom_book_id=1/2/3 → archived（历史保留，不删数据）
--
-- 本文件为 Production 回填脚本，默认【不执行】。
-- 必须在管理员确认“选 #27 为正式版”后，由具备 D1 写权限的流程单独执行。
--
-- 执行时机：必须在 003 创建 ux_custom_books_active 【之前】执行，
--           否则建唯一索引时会因 4 条 active 冲突而失败。
--
-- 幂等：UPDATE 带具体状态谓词，重复执行结果不变；不触碰 reading_records /
--       reading_feedback / book_rewrite_versions。
-- ============================================================

-- 安全护栏：仅作用于 Ted + episode_id=2 + 指定历史 custom book id。
UPDATE custom_books
   SET status = 'archived',
       updated_at = CAST(strftime('%s','now') AS INTEGER)
 WHERE child_id = '49ef4c55-558a-4e9a-b63b-ed888c9f8058'
   AND episode_id = 2
   AND id IN (1, 2, 3)
   AND status = 'active';

-- 显式确保 #4 为 active（即便此前被误归档也能恢复；不改动其 rewrite/文字/图）
UPDATE custom_books
   SET status = 'active',
       updated_at = CAST(strftime('%s','now') AS INTEGER)
 WHERE id = 4
   AND child_id = '49ef4c55-558a-4e9a-b63b-ed888c9f8058'
   AND episode_id = 2
   AND rewrite_id = 27;

-- 执行后人工核对（只读）：应只返回一行 active，即 id=4 / rewrite_id=27。
-- SELECT id, rewrite_id, status, pushed_at, first_viewed_at
--   FROM custom_books
--  WHERE child_id = '49ef4c55-558a-4e9a-b63b-ed888c9f8058'
--    AND episode_id = 2
--  ORDER BY id;
