-- P4-T7-1 教师一键推送绘本请求（第一阶段：仅请求提交与状态查询）
--
-- 边界（架构约束）：
--   本表为教师模块管理数据；提交请求 ≠ 制作/推送绘本。
--   不触碰 custom_books / reading_records / book_entitlements / 学生书架 / 测评数据。
--   管理员后续处理时实时重查班级 active 成员（本表不存学生名单快照，避免过期名单）。
--
-- 幂等与并发：
--   部分唯一索引 uq_cpr_open 保证同一班级同一时间最多一条未完成请求
--   （pending / processing）；重复提交由应用层返回既有请求（200），
--   并发竞态由本索引兜底（应用层捕获后重查返回既有记录）。

CREATE TABLE class_push_requests (
  id             TEXT PRIMARY KEY,
  class_id       TEXT NOT NULL REFERENCES classes(id),
  teacher_id     TEXT NOT NULL REFERENCES parents(id),
  -- 允许 NULL：教师一键提交时不指定故事，管理员处理阶段从已发布 Master 中指定
  episode_id     INTEGER REFERENCES book_episodes(id),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','done','failed')),
  -- 管理员处理异常记录（前向兼容，避免二次迁移）
  failure_reason TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER
);

-- 幂等核心：同一班级最多一条未完成请求（D1/SQLite 支持部分唯一索引）
CREATE UNIQUE INDEX uq_cpr_open
  ON class_push_requests(class_id)
  WHERE status IN ('pending','processing');

-- 教师端按班查询状态（时间倒序由 ORDER BY 承担）
CREATE INDEX idx_cpr_class ON class_push_requests(class_id, created_at);

-- 未来管理员待处理队列
CREATE INDEX idx_cpr_queue ON class_push_requests(status, created_at);
