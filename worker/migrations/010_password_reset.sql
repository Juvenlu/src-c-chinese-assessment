-- ============================================================
-- 010_password_reset.sql
-- P5-R1B 家长忘记密码 → 管理员审核 → 一次性重置
--
-- 变更：
--   1. 新建 password_reset_requests 表（申请全生命周期 + 一次性 Token 摘要）
--   2. parents 增加 session_version 列（全局 Session 失效机制）
--
-- 安全设计（P5-R1A-FIX）：
--   - Token 高熵 32 字节（256-bit），数据库仅存 sha256 摘要
--   - 30 分钟有效、仅一次消费（原子 batch 保护）
--   - session_version 单调递增：重置/改密成功时 +1，旧 Session 立即失效
--   - 存量用户 session_version=0，历史 Session（无 sv）默认放行，零影响
--
-- 幂等说明（与 006 同规）：
--   SQLite/D1 不支持 IF NOT EXISTS，重复执行会报 duplicate/table exists，
--   此时说明迁移已执行过，数据未被破坏，无需重跑。
-- ============================================================

-- 1. 密码重置申请表
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending / approved / rejected / used / expired
  -- approved: 已批准待消费（token 已签发，30 分钟内有效）
  -- used:     已消费（一次性）
  -- expired:  过期或已被新申请作废
  token_hash TEXT,
  expires_at INTEGER,
  verified_by TEXT,       -- 管理员核实人标识（必须核实身份才能批准）
  verification_method TEXT, -- 核实方式（微信/邮件/电话等可信渠道）
  rejected_by TEXT,
  reject_reason TEXT,
  request_ip TEXT,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,

  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pwreset_email_status
  ON password_reset_requests(email, status);

CREATE INDEX IF NOT EXISTS idx_pwreset_parent_status
  ON password_reset_requests(parent_id, status);

CREATE INDEX IF NOT EXISTS idx_pwreset_created
  ON password_reset_requests(created_at);

-- 2. parents 全局 Session 失效版本号
ALTER TABLE parents ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;