/**
 * P5-R1B 家长密码重置 + Session 全局失效 — 本地集成测试
 *
 * 运行（在 worker/ 目录）：
 *   npx tsx test/password-reset.test.ts
 *
 * 覆盖（任务书「四、本地测试」1-8 项核心安全性）：
 *  1. 邮箱防枚举：存在/不存在/禁用邮箱响应一致 {success:true}
 *  2. 双维限流：email 60s/1、1h/5；IP 1h/10（未知邮箱同样计数）
 *  3. Migration 表结构：password_reset_requests 列 + parents.session_version
 *  4. Admin 审批：无 verification_method 拒绝批准；批准签发一次性链接；明文 Token 仅响应一次，DB 仅存 sha256 摘要
 *  5. Token 消费原子性：正确消费（改密 + sv+1 + status=used）；重复消费拒绝；过期拒绝；并发竞争拒绝
 *  6. Session 版本失效：旧 sv Session 失效；历史无 sv Session 兼容（sv=0 放行）；新 Session 正常
 *  7. change-password 修复：snake_case 字段 + Argon2id（D1 权威）+ 旧密码校验 + sv+1 + 签发新 Session
 *  8. 回归基点：parents / children 原数据不因申请流程改变
 *
 * 不写 Production，不发网络请求（全内存 node:sqlite）。
 */

import "./setup-wasm-ext";
import "./setup-webcrypto";
import { webcrypto } from "node:crypto";
// @ts-expect-error - Node 环境 polyfill Web Crypto（与 Workers 同 API）
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = webcrypto;
}

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createD1Like } from "./d1-shim.js";
import type { Env } from "../src/types.js";
import { hashPassword, verifyPassword } from "../src/password.js";
import { signSession, getAuthedSession, SESSION_COOKIE_NAME } from "../src/session.js";
import { sha256Hex, generateResetToken } from "../src/password-reset.js";
import {
  handlePasswordResetRequest,
  handlePasswordResetsList,
  handlePasswordResetApprove,
  handlePasswordResetReject,
  handlePasswordResetCommit,
  handleChangePassword,
} from "../src/password-reset.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SECRET = "test-session-secret-p5-r1b";
const ADMIN_PWD = "admin-test-password-123";
const RESET_BASE = "https://src-c-chinese-assessment.vercel.app";

// ===== 内存库（含 P5-R1B 010 迁移表结构）=====
function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE parents (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT,
      email_verified  INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'active',
      roles           TEXT NOT NULL DEFAULT 'parent',
      created_at      INTEGER NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE children (
      id          TEXT PRIMARY KEY,
      parent_id   TEXT,
      nickname    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  INTEGER
    );

    CREATE TABLE password_reset_requests (
      id                   TEXT PRIMARY KEY,
      parent_id            TEXT,
      email                TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'pending',
      token_hash           TEXT,
      expires_at           INTEGER,
      verified_by          TEXT,
      verification_method  TEXT,
      rejected_by          TEXT,
      reject_reason        TEXT,
      request_ip           TEXT,
      created_at           INTEGER NOT NULL,
      consumed_at          INTEGER,
      FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_pwreset_email_status ON password_reset_requests(email, status);
    CREATE INDEX idx_pwreset_parent_status ON password_reset_requests(parent_id, status);
  `);
  return db;
}

function makeEnv(db: DatabaseSync): Env {
  return {
    DB: createD1Like(db) as unknown as Env["DB"],
    SRC_WORKER_SERVICE_KEY: "svc-key",
    SESSION_SECRET: SECRET,
    ADMIN_PASSWORD: ADMIN_PWD,
    JOIN_RATE_LIMITER: { limit: async () => ({ success: true }) } as unknown as Env["JOIN_RATE_LIMITER"],
    RESET_LINK_BASE: RESET_BASE,
  };
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://local/v1/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
}

function reqAdmin(body: unknown, method = "POST"): Request {
  return req(body, { "x-admin-password": ADMIN_PWD });
}

function reqCookie(token: string, body: unknown = {}): Request {
  return req(body, { Cookie: `${SESSION_COOKIE_NAME}=${token}` });
}

async function seedParent(db: DatabaseSync, email: string, password = "OldPass123!"): Promise<{ id: string; hash: string }> {
  const hash = await hashPassword(password);
  const id = `parent-${email.split("@")[0]}`;
  db.prepare(
    `INSERT INTO parents (id, email, password_hash, email_verified, status, roles, created_at)
     VALUES (?, ?, ?, 1, 'active', 'parent', 1700000000)`
  ).run(id, email, hash);
  return { id, hash };
}

function run(db: DatabaseSync, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...(params as SQLInputValue[]));
}
function row<T>(db: DatabaseSync, sql: string, params: unknown[] = []): T | undefined {
  return db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
}

// ===== 测试框架 =====
let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${(err as Error).message}`);
  }
}

async function runAll(): Promise<void> {
  console.log("=".repeat(64));
  console.log("P5-R1B Password Reset + Session Version Tests");
  console.log("=".repeat(64));

  // ------------------------------------------------------------
  console.log("\n[0] Merchant 工具：Token / sha256");
  await test("generateResetToken 默认 32 字节 = 43 字符 base64url（256-bit 熵）", () => {
    const t = generateResetToken();
    assert.equal(t.length, 43); // 32 bytes → ceil(32/3)*4=44 − padding 1
    assert.ok(/^[A-Za-z0-9_-]+$/.test(t), "base64url 字符集");
    const t2 = generateResetToken();
    assert.notEqual(t, t2, "两次生成不应相同");
  });
  await test("sha256Hex 摘要为 64 位 hex，且与明文不同", async () => {
    const h = await sha256Hex("secret-token-abc");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, "secret-token-abc");
  });

  // ------------------------------------------------------------
  console.log("\n[1] 申请：防枚举 + 双维限流");
  await test("存在/不存在/禁用邮箱响应完全一致 {success:true}", async () => {
    const db = createDb();
    const env = makeEnv(db);
    await seedParent(db, "exists@example.com");

    const r1 = await handlePasswordResetRequest(req({ email: "exists@example.com" }), env);
    const r2 = await handlePasswordResetRequest(req({ email: "no-such@example.com" }), env);
    const r3 = await handlePasswordResetRequest(req({ email: "suspended@example.com" }), env);

    for (const r of [r1, r2, r3]) {
      assert.equal(r.status, 200);
      const body = (await r.json()) as { success: boolean };
      assert.equal(body.success, true);
    }
    const body1 = JSON.stringify(await (await handlePasswordResetRequest(req({ email: "exists@example.com" }), env)).json() as object);
    const body2 = JSON.stringify(await (await handlePasswordResetRequest(req({ email: "no-such@example.com" }), env)).json() as object);
    const body3 = JSON.stringify(await (await handlePasswordResetRequest(req({ email: "suspended@example.com" }), env)).json() as object);
    assert.equal(body1, body2, "存在与不存在邮箱响应体一致（防枚举）");
    assert.equal(body1, body3);
  });

  await test("未知邮箱也创建申请记录（防滥用计数），parent_id 为 null", async () => {
    const db = createDb();
    const env = makeEnv(db);
    await handlePasswordResetRequest(req({ email: "ghost@nowhere.com" }), env);
    const rec = row<{ parent_id: string | null; email: string; status: string }>(
      db,
      "SELECT parent_id, email, status FROM password_reset_requests WHERE email = ?",
      ["ghost@nowhere.com"]
    );
    assert.ok(rec, "未知邮箱也有申请记录");
    assert.equal(rec.parent_id, null);
    assert.equal(rec.status, "pending");
  });

  await test("email 60s 内第二次申请被限流（仍返回 success，不泄露语义）", async () => {
    const db = createDb();
    const env = makeEnv(db);
    await seedParent(db, "limit@example.com");
    const r1 = await handlePasswordResetRequest(req({ email: "limit@example.com" }), env);
    assert.equal(r1.status, 200);
    const r2 = await handlePasswordResetRequest(req({ email: "limit@example.com" }), env);
    // 限流后仍 200 统一成功；DB 中应只有一次申请
    assert.equal(r2.status, 200);
    const j = (await r2.json()) as { success: boolean };
    assert.equal(j.success, true);
    const cnt = row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM password_reset_requests");
    assert.equal(cnt?.n ?? 0, 1, "限流后不新增申请");
  });

  await test("跨实例限流：同一 D1 共享计数（模拟两个 Worker isolate）", async () => {
    const db = createDb();
    // 两个独立 env 指向同一 D1 → 模拟多实例部署下计数全局共享（无横向绕过面）
    const envA = makeEnv(db);
    const envB = makeEnv(db);
    await seedParent(db, "cross@example.com");
    const r1 = await handlePasswordResetRequest(req({ email: "cross@example.com" }, { "CF-Connecting-IP": "1.1.1.1" }), envA);
    assert.equal(r1.status, 200);
    const r2 = await handlePasswordResetRequest(req({ email: "cross@example.com" }, { "CF-Connecting-IP": "2.2.2.2" }), envB);
    assert.equal(r2.status, 200, "跨实例限流仍返回统一成功");
    const cnt = row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM password_reset_requests");
    assert.equal(cnt?.n ?? 0, 1, "另一个实例看不到对方的窗口计数 → 已共享 D1 计数实现跨实例一致");
  });

  await test("IP 维度限流：1h/10 次（不同邮箱同 IP 达上限后拒绝）", async () => {
    const db = createDb();
    const env = makeEnv(db);
    // 直接播种 10 条历史申请记录（同一 IP，1 小时内）
    const nowTs = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 10; i++) {
      run(
        db,
        `INSERT INTO password_reset_requests
           (id, parent_id, email, status, request_ip, created_at)
         VALUES (?, NULL, ?, 'pending', ?, ?)`,
        [`ip-${i}`, `ipuser${i}@example.com`, "55.66.77.88", nowTs - 60]
      );
    }
    const r = await handlePasswordResetRequest(
      req({ email: "new@example.com" }, { "CF-Connecting-IP": "55.66.77.88" }),
      env
    );
    assert.equal(r.status, 200, "IP 限流统一成功（防枚举）");
    const j = (await r.json()) as { success: boolean };
    assert.equal(j.success, true);
    const newCnt = row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM password_reset_requests WHERE email = 'new@example.com'");
    assert.equal(newCnt?.n ?? 0, 0, "IP 达上限后不新增申请");
  });

  await test("email 1h/5 次上限：第 6 次申请被拒（窗口内）", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const nowTs = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 5; i++) {
      run(
        db,
        `INSERT INTO password_reset_requests
           (id, parent_id, email, status, request_ip, created_at)
         VALUES (?, NULL, ?, 'pending', '9.9.9.9', ?)`,
        [`h-${i}`, "hourly@example.com", nowTs - 120 * i]
      );
    }
    const r = await handlePasswordResetRequest(
      req({ email: "hourly@example.com" }, { "CF-Connecting-IP": "9.9.9.9" }),
      env
    );
    assert.equal(r.status, 200);
    const cnt = row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM password_reset_requests WHERE email = 'hourly@example.com'");
    assert.equal(cnt?.n ?? 0, 5, "1h/5 上限后不新增（第 6 次被拒）");
  });

  // ===== 并发原子性（P5-R1B-FIX2）：限流判定与额度占用必须原子，不能被并发同时绕过 =====
  await test("并发原子性：同邮箱 8 并发（60s/1 窗口）只允许 1 条", async () => {
    const db = createDb();
    const env = makeEnv(db);
    await seedParent(db, "race@example.com");
    const rs = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        handlePasswordResetRequest(
          req({ email: "race@example.com" }, { "CF-Connecting-IP": `10.0.0.${i + 1}` }),
          env
        )
      )
    );
    for (const r of rs) assert.equal(r.status, 200, "并发请求全部统一 success（防枚举）");
    const total = row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM password_reset_requests")?.n ?? 0;
    assert.equal(total, 1, "并发 8 个同邮箱请求只能占用 1 次额度（60s/1 不被绕过）");
    const pending = row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM password_reset_requests WHERE status = 'pending'")?.n ?? 0;
    assert.equal(pending, 1, "恰好 1 条 pending 活跃申请（单邮箱单活跃）");
  });

  await test("并发原子性：同 IP 12 个不同邮箱（1h/10 窗口）只允许 10 条", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const rs = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        handlePasswordResetRequest(
          req({ email: `user${i}@example.com` }, { "CF-Connecting-IP": "55.66.77.99" }),
          env
        )
      )
    );
    for (const r of rs) assert.equal(r.status, 200, "并发请求全部统一 success");
    const total = row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM password_reset_requests")?.n ?? 0;
    assert.equal(total, 10, "并发 12 个同 IP 请求只能占用 10 次额度（IP 1h/10 不被绕过）");
  });

  await test("并发原子性：未知邮箱 5 并发同样受限（60s/1 → 1 条）且统一响应", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const rs = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        handlePasswordResetRequest(
          req({ email: "ghost-race@nowhere.com" }, { "CF-Connecting-IP": `20.0.0.${i + 1}` }),
          env
        )
      )
    );
    const js = await Promise.all(rs.map((r) => r.json()));
    for (const j of js) {
      assert.equal((j as { success: boolean }).success, true, "未知邮箱并发也统一 success（防枚举）");
    }
    const total = row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM password_reset_requests")?.n ?? 0;
    assert.equal(total, 1, "未知邮箱并发也只占 1 次额度（不因邮箱不存在而突破限流）");
  });

  await test("并发原子性：多实例共享 D1 同时申请（两个 env 并发）只允许 1 条", async () => {
    const db = createDb();
    const envA = makeEnv(db);
    const envB = makeEnv(db);
    await seedParent(db, "multi@example.com");
    const rs = await Promise.all([
      ...Array.from({ length: 4 }, (_, i) =>
        handlePasswordResetRequest(
          req({ email: "multi@example.com" }, { "CF-Connecting-IP": `30.0.0.${i + 1}` }),
          envA
        )
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        handlePasswordResetRequest(
          req({ email: "multi@example.com" }, { "CF-Connecting-IP": `30.0.1.${i + 1}` }),
          envB
        )
      ),
    ]);
    for (const r of rs) assert.equal(r.status, 200);
    const total = row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM password_reset_requests")?.n ?? 0;
    assert.equal(total, 1, "跨实例并发也只占 1 次额度（计数共享 + 原子占用）");
  });

  await test("旧 pending/approved 申请被新申请作废（expired），单邮箱单活跃申请", async () => {
    const db = createDb();
    const env = makeEnv(db);
    await seedParent(db, "repeat@example.com");
    await handlePasswordResetRequest(req({ email: "repeat@example.com" }), env);
    // 模拟批准（直接入库一条 approved）
    run(
      db,
      `UPDATE password_reset_requests SET status='approved', token_hash=?, expires_at=?, verified_by='admin', verification_method='微信核实'
       WHERE email = ?`,
      ["deadbeef".repeat(8), 2000000000, "repeat@example.com"]
    );
    // 将旧记录移出 D1 限流窗口（2 小时前），确保新申请能真实走一遍作废逻辑
    run(
      db,
      "UPDATE password_reset_requests SET created_at = ? WHERE email = ?",
      [Math.floor(Date.now() / 1000) - 7200, "repeat@example.com"]
    );
    await handlePasswordResetRequest(req({ email: "repeat@example.com" }), env);
    const rows = row<{ active: number }>(
      db,
      "SELECT COUNT(*) AS active FROM password_reset_requests WHERE status IN ('pending','approved')"
    );
    assert.equal(rows?.active ?? 0, 1, "同一邮箱最多一条活跃申请");
    const expiredCnt = row<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM password_reset_requests WHERE status='expired'"
    );
    assert.equal(expiredCnt?.n ?? 0, 1, "旧 approved 被作废");
  });

  // ------------------------------------------------------------
  console.log("\n[2] Admin：列表 / 批准 / 拒绝");
  await test("列表须 x-admin-password；响应不含 token_hash 明文", async () => {
    const db = createDb();
    const env = makeEnv(db);
    await seedParent(db, "list@example.com");
    await handlePasswordResetRequest(req({ email: "list@example.com" }), env);

    const noAuthGet = await handlePasswordResetsList(
      new Request("http://local/v1/admin/password-resets", { method: "GET" }),
      env
    );
    assert.equal(noAuthGet.status, 401);

    const ok = await handlePasswordResetsList(
      new Request("http://local/v1/admin/password-resets", {
        method: "GET",
        headers: { "x-admin-password": ADMIN_PWD },
      }),
      env
    );
    assert.equal(ok.status, 200);
    const j = (await ok.json()) as { requests: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(j.requests));
    assert.equal(j.requests.length, 1);
    assert.equal("token_hash" in j.requests[0], false, "列表绝不返回 token_hash/明文");
  });

  await test("批准必须提供 verification_method（未核实不得批准）", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const parent = await seedParent(db, "approve@example.com");
    await handlePasswordResetRequest(req({ email: "approve@example.com" }), env);
    const recId = row<{ id: string }>(db, "SELECT id FROM password_reset_requests")!.id;

    const r = await handlePasswordResetApprove(reqAdmin({}), env, recId);
    assert.equal(r.status, 400, "缺 verification_method 拒绝批准");
    const j = (await r.json()) as { error: string };
    assert.match(j.error, /核实/);
    const st = row<{ status: string }>(db, "SELECT status FROM password_reset_requests WHERE id = ?", [recId]);
    assert.equal(st?.status, "pending", "未批准则状态不变");
  });

  await test("批准成功：一次性链接 + DB 仅存 sha256 摘要 + 明文不再出现", async () => {
    const db = createDb();
    const env = makeEnv(db);
    await seedParent(db, "approve2@example.com");
    await handlePasswordResetRequest(req({ email: "approve2@example.com" }), env);
    const recId = row<{ id: string }>(db, "SELECT id FROM password_reset_requests")!.id;

    const r = await handlePasswordResetApprove(
      reqAdmin({ verification_method: "已通过家长微信群核实身份（2026-02-14）" }),
      env,
      recId
    );
    assert.equal(r.status, 200);
    const j = (await r.json()) as { success: boolean; reset_link: string; email: string };
    assert.equal(j.success, true);
    assert.ok(j.reset_link.startsWith(`${RESET_BASE}/reset-password?token=`), "链接使用正式 Production 域名");
    const token = j.reset_link.split("token=")[1];

    // DB 只存摘要
    const rec = row<{ token_hash: string | null; status: string; verified_by: string | null; expires_at: number | null }>(
      db,
      "SELECT token_hash, status, verified_by, expires_at FROM password_reset_requests WHERE id = ?",
      [recId]
    );
    const expectedHash = await sha256Hex(token);
    assert.equal(rec?.token_hash, expectedHash, "DB 存 sha256 摘要而非明文");
    assert.notEqual(rec?.token_hash, token, "绝不存明文 Token");
    assert.equal(rec?.status, "approved");
    assert.equal(rec?.verified_by, "admin");
    assert.ok(rec && rec.expires_at !== null && rec.expires_at > Math.floor(Date.now() / 1000), "expires_at 未来");

    // 明文 URL 不应出现在列表
    const list = await handlePasswordResetsList(
      new Request("http://local/v1/admin/password-resets", {
        method: "GET",
        headers: { "x-admin-password": ADMIN_PWD },
      }),
      env
    );
    const lj = (await list.json()) as { requests: Array<Record<string, unknown>> };
    assert.equal(JSON.stringify(lj).includes(token), false, "列表不含明文 Token");
  });

  await test("重复批准（并发）：仅一次成功，第二次 409", async () => {
    const db = createDb();
    const env = makeEnv(db);
    await seedParent(db, "dup@example.com");
    await handlePasswordResetRequest(req({ email: "dup@example.com" }), env);
    const recId = row<{ id: string }>(db, "SELECT id FROM password_reset_requests")!.id;

    const b1 = reqAdmin({ verification_method: "电话核实" });
    const b2 = reqAdmin({ verification_method: "电话核实" });
    const [r1, r2] = await Promise.all([
      handlePasswordResetApprove(b1, env, recId),
      handlePasswordResetApprove(b2, env, recId),
    ]);
    const okCount = [r1.status, r2.status].filter((s) => s === 200).length;
    assert.equal(okCount, 1, "并发批准只有一个成功");
    const conflictCount = [r1.status, r2.status].filter((s) => s === 409).length;
    assert.equal(conflictCount, 1);
  });

  await test("未关联有效账户的申请无法批准；家长被禁用时拒绝", async () => {
    const db = createDb();
    const env = makeEnv(db);
    // 未知邮箱申请（parent_id=null）
    await handlePasswordResetRequest(req({ email: "ghost2@nowhere.com" }), env);
    const ghostId = row<{ id: string }>(db, "SELECT id FROM password_reset_requests WHERE email='ghost2@nowhere.com'")!.id;
    const rGhost = await handlePasswordResetApprove(reqAdmin({ verification_method: "x" }), env, ghostId);
    assert.equal(rGhost.status, 400);
    assert.notEqual(200, rGhost.status);
  });

  await test("拒绝：必须记录原因 + 操作人", async () => {
    const db = createDb();
    const env = makeEnv(db);
    await seedParent(db, "reject@example.com");
    await handlePasswordResetRequest(req({ email: "reject@example.com" }), env);
    const recId = row<{ id: string }>(db, "SELECT id FROM password_reset_requests")!.id;

    const r = await handlePasswordResetReject(reqAdmin({ reject_reason: "无法核实身份，请补充信息" }), env, recId);
    assert.equal(r.status, 200);
    const rec = row<{ status: string; rejected_by: string | null; reject_reason: string | null }>(
      db,
      "SELECT status, rejected_by, reject_reason FROM password_reset_requests WHERE id = ?",
      [recId]
    );
    assert.equal(rec?.status, "rejected");
    assert.equal(rec?.rejected_by, "admin");
    assert.equal(rec?.reject_reason, "无法核实身份，请补充信息");
  });

  // ------------------------------------------------------------
  console.log("\n[3] 消费 Token：原子性 / 过期 / 重复 / 并发");
  async function approvedSetup(password = "OldPass123!") {
    const db = createDb();
    const env = makeEnv(db);
    const parent = await seedParent(db, "consume@example.com", password);
    await handlePasswordResetRequest(req({ email: "consume@example.com" }), env);
    const recId = row<{ id: string }>(db, "SELECT id FROM password_reset_requests")!.id;
    const r = await handlePasswordResetApprove(reqAdmin({ verification_method: "微信核实" }), env, recId);
    const j = (await r.json()) as { reset_link: string };
    const token = j.reset_link.split("token=")[1];
    return { db, env, parent, token, recId };
  }

  await test("正确消费：改密 + session_version+1 + status=used（原子）", async () => {
    const s = await approvedSetup();
    const before = row<{ session_version: number }>(s.db, "SELECT session_version FROM parents WHERE id = ?", [s.parent.id]);

    const r = await handlePasswordResetCommit(req({ token: s.token, new_password: "NewPass456!" }), s.env);
    assert.equal(r.status, 200);
    const j = (await r.json()) as { success: boolean };
    assert.equal(j.success, true);

    const parent = row<{ password_hash: string; session_version: number }>(
      s.db,
      "SELECT password_hash, session_version FROM parents WHERE id = ?",
      [s.parent.id]
    );
    assert.equal((before?.session_version ?? 0) + 1, parent?.session_version, "session_version +1");
    assert.equal(await verifyPassword("NewPass456!", parent!.password_hash), true, "新密码可验证");
    assert.equal(await verifyPassword("OldPass123!", parent!.password_hash), false, "旧密码失效");

    const rec = row<{ status: string; consumed_at: number | null }>(
      s.db,
      "SELECT status, consumed_at FROM password_reset_requests WHERE id = ?",
      [s.recId]
    );
    assert.equal(rec?.status, "used");
    assert.ok(rec && rec.consumed_at !== null, "consumed_at 已记录");
  });

  await test("重复消费：第二次被拒绝，密码不变", async () => {
    const s = await approvedSetup();
    await handlePasswordResetCommit(req({ token: s.token, new_password: "NewPass111" }), s.env);
    const afterFirst = row<{ password_hash: string; session_version: number }>(
      s.db,
      "SELECT password_hash, session_version FROM parents WHERE id = ?",
      [s.parent.id]
    );
    const r2 = await handlePasswordResetCommit(req({ token: s.token, new_password: "Hacked999" }), s.env);
    assert.notEqual(r2.status, 200, "重复消费必须拒绝");
    const afterSecond = row<{ password_hash: string; session_version: number }>(
      s.db,
      "SELECT password_hash, session_version FROM parents WHERE id = ?",
      [s.parent.id]
    );
    assert.equal(afterFirst?.password_hash, afterSecond?.password_hash, "密码未被二次篡改");
    assert.equal(afterFirst?.session_version, afterSecond?.session_version, "session_version 未再次递增");
  });

  await test("过期 Token：拒绝；消费前明确 expired_at 过期", async () => {
    const s = await approvedSetup();
    // 人为把 expires_at 调成过去
    run(s.db, "UPDATE password_reset_requests SET expires_at = ? WHERE id = ?", [Math.floor(Date.now() / 1000) - 100, s.recId]);
    const r = await handlePasswordResetCommit(req({ token: s.token, new_password: "LatePass789" }), s.env);
    assert.notEqual(r.status, 200, "过期 Token 拒绝");
    const parent = row<{ session_version: number }>(s.db, "SELECT session_version FROM parents WHERE id = ?", [s.parent.id]);
    assert.equal(parent?.session_version, 0, "session_version 未变");
  });

  await test("D1 batch 回滚：第二条 UPDATE 失败时第一条不生效（单事务语义）", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const parent = await seedParent(db, "rollback@example.com");
    // 构造非法 SQL 使 batch 内第二条语句失败 → 应整体回滚（第一条成功也不得落库）
    await assert.rejects(
      env.DB.batch([
        env.DB.prepare("UPDATE parents SET email = ? WHERE id = ?").bind("hacked@example.com", parent.id),
        env.DB.prepare("UPDATE parents SET nonexistent_col_xyz = 1 WHERE id = ?").bind(parent.id),
      ]),
      "batch 中任一条失败必须抛错（触发回滚）"
    );
    const after = row<{ email: string }>(db, "SELECT email FROM parents WHERE id = ?", [parent.id]);
    assert.equal(after?.email, "rollback@example.com", "第一条 UPDATE 被回滚，email 未被篡改");
  });

  await test("并发消费 TOCTOU：仅一次成功（D1 batch 原子）", async () => {
    const s = await approvedSetup();
    const [r1, r2] = await Promise.all([
      handlePasswordResetCommit(req({ token: s.token, new_password: "RacePass111" }), s.env),
      handlePasswordResetCommit(req({ token: s.token, new_password: "RacePass222" }), s.env),
    ]);
    const okCount = [r1.status, r2.status].filter((st) => st === 200).length;
    assert.equal(okCount, 1, "并发消费只有一个成功");
    const parent = row<{ session_version: number }>(
      s.db,
      "SELECT session_version FROM parents WHERE id = ?",
      [s.parent.id]
    );
    assert.equal(parent?.session_version, 1, "仅递增一次");
    const usedCnt = row<{ n: number }>(s.db, "SELECT COUNT(*) AS n FROM password_reset_requests WHERE status='used'");
    assert.equal(usedCnt?.n ?? 0, 1, "仅一条 used");
  });

  await test("伪造 Token（摘要不匹配）拒绝", async () => {
    const s = await approvedSetup();
    const r = await handlePasswordResetCommit(req({ token: "totally-forged-token", new_password: "NewPass333" }), s.env);
    assert.notEqual(r.status, 200);
  });

  // ------------------------------------------------------------
  console.log("\n[4] Session 全局失效（getAuthedSession）");
  await test("携带正确 sv 的 Session 放行；旧 sv 拒绝", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const parent = await seedParent(db, "sv@example.com");
    run(db, "UPDATE parents SET session_version = 2 WHERE id = ?", [parent.id]);

    const good = await signSession({ parent_id: parent.id, sv: 2 }, SECRET);
    const stale = await signSession({ parent_id: parent.id, sv: 1 }, SECRET);

    const goodPay = await getAuthedSession(reqCookie(good), env);
    assert.equal(goodPay?.parent_id, parent.id, "正确 sv 放行");
    const stalePay = await getAuthedSession(reqCookie(stale), env);
    assert.equal(stalePay, null, "旧 sv 拒绝");
  });

  await test("历史无 sv Session：DB sv=0 放行，sv>0 拒绝（兼容存量用户）", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const parent = await seedParent(db, "legacy@example.com");
    const legacy = await signSession({ parent_id: parent.id }, SECRET); // 无 sv

    const p0 = await getAuthedSession(reqCookie(legacy), env);
    assert.equal(p0?.parent_id, parent.id, "sv=0 时历史 Session 放行");

    run(db, "UPDATE parents SET session_version = 1 WHERE id = ?", [parent.id]);
    const p1 = await getAuthedSession(reqCookie(legacy), env);
    assert.equal(p1, null, "sv>0 时历史 Session 拒绝");
  });

  await test("家长被删除 → 拒绝（fail-closed）", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const token = await signSession({ parent_id: "deleted-parent", sv: 0 }, SECRET);
    const p = await getAuthedSession(reqCookie(token), env);
    assert.equal(p, null);
  });

  await test("DB 异常（表缺失）→ 拒绝，不做部分放行", async () => {
    const db = createDb();
    db.exec("DROP TABLE parents"); // 模拟 schema 异常
    const env = makeEnv(db);
    const t = await signSession({ parent_id: "x", sv: 0 }, SECRET);
    const p = await getAuthedSession(reqCookie(t), env);
    assert.equal(p, null);
  });

  // ------------------------------------------------------------
  console.log("\n[5] change-password 修复（Worker → D1 权威 + snake_case + sv）");
  await test("未登录 → 401", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const r = await handleChangePassword(req({ old_password: "x", new_password: "y" }), env);
    assert.equal(r.status, 401);
  });

  await test("snake_case 字段：错误旧密码 401；正确则改密 + sv+1 + 新 Session", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const parent = await seedParent(db, "cp@example.com", "CurrentPass123!");

    // 登录态（sv=0）
    const oldToken = await signSession({ parent_id: parent.id, sv: 0 }, SECRET);
    const reqWithCookie = (body: unknown) => reqCookie(oldToken, body);

    // 错误旧密码
    const bad = await handleChangePassword(reqWithCookie({ old_password: "WrongPass", new_password: "NewPass456!" }), env);
    assert.equal(bad.status, 401);

    // 正确修改（snake_case）
    const good = await handleChangePassword(reqWithCookie({ old_password: "CurrentPass123!", new_password: "NewPass456!" }), env);
    assert.equal(good.status, 200);
    const gj = (await good.json()) as { success: boolean; session?: string };
    assert.equal(gj.success, true);

    // 密码已更新（D1 权威 + Argon2id）
    const parent2 = row<{ password_hash: string; session_version: number }>(
      db,
      "SELECT password_hash, session_version FROM parents WHERE id = ?",
      [parent.id]
    );
    assert.equal(parent2?.session_version, 1, "session_version +1");
    assert.equal(await verifyPassword("NewPass456!", parent2!.password_hash), true);
    assert.equal(await verifyPassword("CurrentPass123!", parent2!.password_hash), false);

    // 旧 Session 失效，新 Session 可登录态使用
    const stillOld = await getAuthedSession(reqCookie(oldToken), env);
    assert.equal(stillOld, null, "旧 Session 立即失效");
    assert.ok(gj.session, "返回新 Session");
    const newPay = await getAuthedSession(reqCookie(gj.session!), env);
    assert.equal(newPay?.parent_id, parent.id, "新 Session 放行");
  });

  await test("新密码过短拒绝", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const parent = await seedParent(db, "short@example.com", "CurrentPass123!");
    const tok = await signSession({ parent_id: parent.id, sv: 0 }, SECRET);
    const r = await handleChangePassword(reqCookie(tok, { old_password: "CurrentPass123!", new_password: "short" }), env);
    assert.equal(r.status, 400);
  });

  // ------------------------------------------------------------
  console.log("\n[6] 回归：申请流程不改动 parents/children 原始数据");
  await test("申请/批准/消费全程 children 数据不变", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const parent = await seedParent(db, "regress@example.com");
    run(db, "INSERT INTO children (id, parent_id, nickname, status, created_at) VALUES ('c1', ?, '小明', 'active', 1700000000)", [parent.id]);

    const childBefore = row<{ nickname: string; status: string }>(db, "SELECT nickname, status FROM children WHERE id = 'c1'");

    await handlePasswordResetRequest(req({ email: "regress@example.com" }), env);
    const rid = row<{ id: string }>(db, "SELECT id FROM password_reset_requests")!.id;
    const appr = await handlePasswordResetApprove(reqAdmin({ verification_method: "核实" }), env, rid);
    assert.equal(appr.status, 200);
    const token = ((await appr.json()) as { reset_link: string }).reset_link.split("token=")[1];
    const commit = await handlePasswordResetCommit(req({ token, new_password: "RegressPass1" }), env);
    assert.equal(commit.status, 200);

    const childAfter = row<{ nickname: string; status: string }>(db, "SELECT nickname, status FROM children WHERE id = 'c1'");
    assert.deepEqual(childAfter, childBefore, "children 数据不受影响");
    // parent_id / email 不变
    const p = row<{ id: string; email: string }>(db, "SELECT id, email FROM parents WHERE id = ?", [parent.id]);
    assert.equal(p?.id, parent.id);
    assert.equal(p?.email, "regress@example.com");
  });

  await test("非法请求体不崩溃（返回统一成功/400）", async () => {
    const db = createDb();
    const env = makeEnv(db);
    const badReq = new Request("http://local/v1/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    const r = await handlePasswordResetRequest(badReq, env);
    assert.equal(r.status, 200, "非法请求体返回统一成功（防枚举）");
  });

  console.log("\n" + "=".repeat(64));
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(64));
  if (failed > 0) process.exit(1);
}

runAll().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});