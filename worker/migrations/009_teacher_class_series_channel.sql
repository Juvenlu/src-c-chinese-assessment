-- ============================================================
-- 009_teacher_class_series_channel.sql
-- P4-T9-1B 教师课堂绘本推送 — Schema 迁移（D1 / SQLite）
--
-- 变更：
--   1. classes.story_series_id        班级故事系列（D1-V2 #1-#4；NULL=未设置）
--   2. class_push_requests.story_series_id  申请时系列快照（历史 NULL 保持不变，不回填）
--   3. custom_books.channel           绘本渠道 home/class，默认 home，存量行自动为 home
--   4. Active 唯一约束按渠道重建：    (child_id, episode_id, channel) 至多一条 active
--      —— 先建新索引 ux_custom_books_active_v2，再删旧索引 ux_custom_books_active，
--         全程至少一个唯一约束在线，无无约束窗口（详见下）
--   5. 新表 class_push_results        逐孩子处理结果（D3；UNIQUE(request_id, child_id)）
--
-- 索引切换零窗口论证：
--   - 第 4b 步 CREATE v2 时，旧索引 ux_custom_books_active 仍在生效，双约束并存
--     （约束更严格，不是更松）：任何写入须同时满足 (child,episode) 与
--     (child,episode,channel) 唯一。
--   - 存量数据 channel 全为 'home'（第 3 步 DEFAULT），旧索引已保证
--     (child,episode) active 唯一 ⇒ (child,episode,'home') 必唯一 ⇒ CREATE v2 必成功。
--   - 第 4c 步 DROP 旧索引后，v2 独立生效，允许同集 home/class 各一 active。
--
-- 兼容性（先迁移、后部署 Worker）：
--   - 旧 Worker + 新 Schema：安全。所有存量 INSERT 为显式列清单
--     （version-store.ts buildGuardedActivation 8 列、classes.ts 申请 6 列），
--     新列均有 DEFAULT 或可空；新 Schema 下旧端点无法写出 channel='class' 的书，
--     额度计数与归档语句在无 class 书时语义与旧版完全一致。
--   - 新 Worker + 旧 Schema：不安全（引用不存在列 ⇒ 500）。必须先执行本迁移。
--
-- 幂等 / 一次性说明（遵循 003 惯例）：
--   - SQLite/D1 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS。
--   - 第 1-3 条 ALTER 为一次性语句：重复执行报 "duplicate column name" 并中止，
--     属预期；如确认列已存在，后续语句人工核对后单独补执行。
--   - CREATE INDEX / CREATE TABLE 均带 IF NOT EXISTS，可安全重复执行。
--   - 本迁移不含任何业务数据改写（无 UPDATE/DELETE），不触碰历史 pending 申请、
--     绘本正文、测评、阅读记录与孩子等级。
--
-- 执行方式（人工、分环境、需独立授权）：
--   Preview:    npx wrangler d1 execute src-preview-database --remote --env preview \
--                 --file migrations/009_teacher_class_series_channel.sql
--   Production: npx wrangler d1 execute src-primary-database --remote \
--                 --file migrations/009_teacher_class_series_channel.sql
-- ============================================================

-- 1) 班级故事系列（应用层校验取值；不建系列主表，MVP 零迁移扩展第三系列）
ALTER TABLE classes ADD COLUMN story_series_id INTEGER;

-- 2) 申请系列快照：提交时由应用层写入班级当前 story_series_id；
--    历史申请保持 NULL（管理员 claim 时显式确认，不假定当前班级系列）
ALTER TABLE class_push_requests ADD COLUMN story_series_id INTEGER;

-- 3) 绘本渠道：home（家庭）/ class（课堂）；存量行自动 'home'
--    SQLite 允许 ADD COLUMN 带 CHECK + NOT NULL DEFAULT；存量行不重新校验 CHECK
ALTER TABLE custom_books ADD COLUMN channel TEXT NOT NULL DEFAULT 'home'
  CHECK (channel IN ('home','class'));

-- 4a) （占位注释）先建后删：4b 建新、4c 删旧，杜绝无唯一约束窗口

-- 4b) 新部分唯一索引：同一孩子、同一集、同一渠道至多一条 active
CREATE UNIQUE INDEX IF NOT EXISTS ux_custom_books_active_v2
  ON custom_books(child_id, episode_id, channel)
  WHERE status = 'active';

-- 4c) 删除旧索引（此时 v2 已在线）
DROP INDEX IF EXISTS ux_custom_books_active;

-- 5) 逐孩子处理结果表：处理中/成功/跳过/失败 + 关联产物 + 失败原因
--    UNIQUE(request_id, child_id) 保证重试幂等（UPDATE 同行，不产生重复行）
CREATE TABLE IF NOT EXISTS class_push_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id     TEXT NOT NULL REFERENCES class_push_requests(id),
  child_id       TEXT NOT NULL REFERENCES children(id),
  rewrite_id     INTEGER REFERENCES book_rewrite_versions(id),
  custom_book_id INTEGER REFERENCES custom_books(id),
  status         TEXT NOT NULL CHECK (status IN ('processing','ok','skipped','failed')),
  failure_reason TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER,
  UNIQUE (request_id, child_id)
);

-- 管理员按申请查看逐孩子结果
CREATE INDEX IF NOT EXISTS idx_cpr_results_request
  ON class_push_results(request_id);
