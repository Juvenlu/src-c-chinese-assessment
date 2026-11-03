-- ============================================================
-- 007_teacher_classes.sql
-- P4-T2 教师班级 MVP — classes / class_memberships 两张新表（D1 / SQLite）
--
-- 变更：
--   新增 classes            教师班级（邀请码单码制，重新生成即旧码失效）
--   新增 class_memberships  家长授权加入记录（revoke 留痕，不物理删除）
--
-- 设计要点：
--   1. 同一孩子在同一班级最多一条 active 关联
--      → 部分唯一索引 idx_cm_active_unique (class_id, child_id) WHERE status='active'
--   2. revoked 后允许重新加入 → 新插一行 active（历史 revoked 行保留）
--   3. 一个孩子可加入多个班级 → 唯一性限定在 (class_id, child_id) 范围内
--   4. 邀请码重新生成 → UPDATE classes.invite_code（UNIQUE 约束兜底防撞码），
--      旧码立即失效；随机生成/频控/家长校验属 Worker API 层职责
--   5. 教师边界 → 应用层强制 classes.teacher_id = session.parent_id，
--      本表 teacher_id REFERENCES parents(id) 声明归属
--
-- 安全性：
--   - 纯新增两张表，不修改 parents / children / custom_books /
--     reading_records 等任何现有表。
--   - 不含邮件服务、验证码或推送记录表（Demo 推送按钮为纯前端实现）。
--
-- 兼容性 / 部署顺序：
--   - 现有代码不引用这两张表，先迁移后部署 Worker 无顺序风险；
--     反向（先部署依赖新表的 Worker 再迁移）会导致 no such table 报错，
--     因此仍强制【先迁移、后部署】。
--
-- 幂等说明：
--   - CREATE TABLE 不带 IF NOT EXISTS（与 006 同规范，显式失败即已执行过）。
--   - 重复执行将报 "table classes already exists"，数据未被破坏，无需重跑。
--   - 判断是否已迁移：
--       SELECT name FROM sqlite_master WHERE name IN ('classes','class_memberships');
-- ============================================================

CREATE TABLE classes (
  id          TEXT PRIMARY KEY,
  teacher_id  TEXT NOT NULL REFERENCES parents(id),
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 50),
  invite_code TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE class_memberships (
  id           TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id),
  child_id     TEXT NOT NULL REFERENCES children(id),
  parent_id    TEXT NOT NULL REFERENCES parents(id),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  authorized_at INTEGER NOT NULL,
  revoked_at   INTEGER,
  created_at   INTEGER NOT NULL
);

-- 同一孩子在同一班级最多一条 active（部分唯一索引；revoked 行不参与，可重新加入）
CREATE UNIQUE INDEX idx_cm_active_unique
  ON class_memberships(class_id, child_id) WHERE status = 'active';

-- 查询索引：教师看班级成员 / 家长看孩子加入了哪些班
CREATE INDEX idx_cm_class ON class_memberships(class_id, status);
CREATE INDEX idx_cm_child ON class_memberships(child_id, status);
CREATE INDEX idx_classes_teacher ON classes(teacher_id, status);
