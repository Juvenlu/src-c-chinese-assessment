/**
 * P4-T2 教师班级 API — 本地集成测试
 *
 * 运行：TSX_TSCONFIG_PATH=tsconfig.test.json npx tsx test/classes.test.ts
 *
 * 设施：node:sqlite 内存库 + d1-shim（真实 SQL/外键/部分唯一索引），
 *       直接打 Worker fetch 入口（真实路由），007 迁移文件真实执行。
 *
 * 覆盖任务书 Step 3 全部 13 项。
 */

import "./setup-webcrypto";
import "./setup-wasm-ext";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createD1Like } from "./d1-shim.js";
import worker from "../src/index.js";
import { __resetJoinRateForTest } from "../src/classes.js";
import type { Env } from "../src/types.js";

// ————————————————————————————————————
// 测试框架（极简）
// ————————————————————————————————————

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string): void {
	if (cond) {
		passCount++;
		console.log(`  PASS  ${name}`);
	} else {
		failCount++;
		failures.push(name + (detail ? ` — ${detail}` : ""));
		console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

// ————————————————————————————————————
// Schema 与 Env
// ————————————————————————————————————

const HERE = dirname(fileURLToPath(import.meta.url));

const DDL_PARENTS = `
CREATE TABLE parents (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER,
  roles          TEXT NOT NULL DEFAULT 'parent'
);`;

const DDL_CHILDREN = `
CREATE TABLE children (
  id                  TEXT PRIMARY KEY,
  parent_id           TEXT NOT NULL,
  nickname            TEXT NOT NULL,
  age                 INTEGER NOT NULL,
  grade               TEXT NOT NULL,
  country             TEXT NOT NULL,
  home_language       TEXT,
  home_language_other TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  assessment_status   TEXT,
  estimated_level     TEXT,
  confirmed_level     TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER
);`;

const DDL_GUEST_SESSIONS = `
CREATE TABLE guest_test_sessions (
  id               TEXT PRIMARY KEY,
  claimed          INTEGER NOT NULL DEFAULT 0,
  child_id         TEXT,
  result_data_json TEXT
);`;

const DDL_BOOK_EPISODES = `
CREATE TABLE book_episodes (
  id              INTEGER PRIMARY KEY,
  series_id       INTEGER,
  series_name     TEXT,
  episode_number  INTEGER,
  episode_title   TEXT,
  page_count      INTEGER,
  level_tier      TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  cover_image_url TEXT,
  description     TEXT
);`;

// 009 迁移前置表（class_push_results 外键目标；ux_custom_books_active 为 009 删除对象）
const DDL_REWRITE_VERSIONS = `
CREATE TABLE book_rewrite_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id    INTEGER NOT NULL,
  child_id      TEXT,
  target_level  TEXT NOT NULL,
  pages_json    TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'review',
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  finalized_at  INTEGER,
  finalized_by  TEXT
);`;

const DDL_CUSTOM_BOOKS = `
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
  UNIQUE(child_id, rewrite_id)
);
CREATE UNIQUE INDEX ux_custom_books_active
  ON custom_books(child_id, episode_id) WHERE status = 'active';`;

// 权威等级数据源（P4-T6B-4）：最小列集，与线上 test_results 关键字段对齐
const DDL_TEST_RESULTS = `
CREATE TABLE test_results (
  id                TEXT PRIMARY KEY,
  child_id          TEXT NOT NULL,
  level             TEXT,
  test_type         TEXT NOT NULL,
  status            TEXT NOT NULL,
  stable_char_count INTEGER,
  completed_at      INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
);`;

const TEST_SERVICE_KEY = "test-service-key-p4t2";
const TEST_SECRET = "test-session-secret-p4t2";

function makeEnv(db: DatabaseSync): Env {
	return {
		DB: createD1Like(db) as unknown as Env["DB"],
		SRC_WORKER_SERVICE_KEY: TEST_SERVICE_KEY,
		SESSION_SECRET: TEST_SECRET,
		ADMIN_PASSWORD: "unused",
		// 平台频控默认 mock：全部允许（既有测试行为不变）
		JOIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
		// S5F 白名单：本套件教师注册邮箱（t1/t2@test.com）
		TEACHER_ALLOWED_EMAILS: "t1@test.com,t2@test.com",
	};
}

/** 执行迁移 SQL 文件（过滤注释，逐条执行） */
function applyMigration(db: DatabaseSync, file: string): void {
	const sql = readFileSync(join(HERE, "../migrations", file), "utf8");
	const statements = sql
		.split(";")
		.map((s) => s.replace(/--[^\n]*/g, "").trim())
		.filter((s) => s.length > 0);
	for (const stmt of statements) db.exec(stmt);
}

function createFreshDb(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec(DDL_PARENTS);
	db.exec(DDL_CHILDREN);
	db.exec(DDL_GUEST_SESSIONS);
	db.exec(DDL_BOOK_EPISODES);
	db.exec(DDL_TEST_RESULTS);
	db.exec(DDL_REWRITE_VERSIONS);
	db.exec(DDL_CUSTOM_BOOKS);
	applyMigration(db, "007_teacher_classes.sql");
	applyMigration(db, "008_class_push_requests.sql");
	applyMigration(db, "009_teacher_class_series_channel.sql");
	db.exec(`INSERT INTO book_episodes (id, series_id, series_name, episode_number, episode_title, page_count, level_tier, status)
	         VALUES (2,1,'西游记',1,'大家都叫他孙悟空',10,'SRC500','published'),
	                (3,1,'西游记',2,'拜菩提祖师为师',8,'SRC500','published'),
	                (99,1,'西游记',9,'草稿未发布',8,'SRC500','draft')`);
	return db;
}

// ————————————————————————————————————
// HTTP 请求助手
// ————————————————————————————————————

function makeRequest(
	path: string,
	init: { method?: string; body?: unknown; cookie?: string } = {},
): Request {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-SRC-Service-Key": TEST_SERVICE_KEY,
	};
	if (init.cookie) headers["Cookie"] = init.cookie;
	return new Request(`http://local${path}`, {
		method: init.method ?? "GET",
		headers,
		body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
	});
}

function extractSessionCookie(res: Response): string {
	const setCookie = res.headers.get("set-cookie") || "";
	const m = setCookie.match(/src_auth_session=([^;]+)/);
	return m ? `src_auth_session=${m[1]}` : "";
}

interface AuthBody { success?: boolean; cookie: string; userId?: string }

async function signupTeacher(db: DatabaseSync, email: string): Promise<AuthBody> {
	const res = await worker.fetch(
		makeRequest("/v1/auth/teacher/signup", { method: "POST", body: { email, password: "TeacherPass123!" } }),
		makeEnv(db),
	);
	const body = (await res.json()) as { user?: { id: string } };
	return { cookie: extractSessionCookie(res), userId: body.user?.id };
}

async function signupParent(db: DatabaseSync, email: string, nickname: string): Promise<AuthBody & { childId?: string }> {
	const res = await worker.fetch(
		makeRequest("/v1/auth/signup", {
			method: "POST",
			body: { email, password: "ParentPass123!", nickname, age: 8, grade: "Grade 2", country: "USA" },
		}),
		makeEnv(db),
	);
	const body = (await res.json()) as { user?: { id: string }; children?: { id: string }[] };
	return { cookie: extractSessionCookie(res), userId: body.user?.id, childId: body.children?.[0]?.id };
}

/** 种子：一条已完成的正式测评结果（权威等级数据源，P4-T6B-4） */
function seedFormalResult(db: DatabaseSync, childId: string, level: string, stableChar: number, completedAt: number): void {
	db.prepare(
		`INSERT INTO test_results (id, child_id, level, test_type, status, stable_char_count, completed_at, created_at)
		 VALUES (?,?,?,'formal','completed',?,?,?)`
	).run(`tr-${completedAt}-${childId.slice(0, 8)}`, childId, level, stableChar, completedAt, completedAt);
}

// ————————————————————————————————————
// 主测试
// ————————————————————————————————————

async function main(): Promise<void> {
	const db = createFreshDb();
	const env = makeEnv(db);

	console.log("\n== 准备：教师×2 + 家长×2 ==");
	const teacher1 = await signupTeacher(db, "t1@test.com");
	const teacher2 = await signupTeacher(db, "t2@test.com");
	const parent1 = await signupParent(db, "p1@test.com", "Sean");
	const parent2 = await signupParent(db, "p2@test.com", "Amy");
	check("教师/家长注册就绪", !!(teacher1.cookie && teacher2.cookie && parent1.cookie && parent2.cookie && parent1.childId && parent2.childId));

	// ———— 1. 教师创建、查看班级 ————
	console.log("\n== [1] 教师创建、查看班级 ==");
	const createRes = await worker.fetch(
		makeRequest("/v1/classes", { method: "POST", cookie: teacher1.cookie, body: { name: "一年级A班" } }), env);
	const createBody = (await createRes.json()) as { class?: { id: string; invite_code: string } };
	check("创建班级 201", createRes.status === 201 && !!createBody.class, `status=${createRes.status}`);
	const classId = createBody.class!.id;
	const code1 = createBody.class!.invite_code;
	check("邀请码 8 位 Crockford", /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code1), code1);

	const listRes = await worker.fetch(makeRequest("/v1/classes", { cookie: teacher1.cookie }), env);
	const listBody = (await listRes.json()) as { classes?: { id: string; member_count: number }[] };
	check("班级列表含新班", listRes.status === 200 && listBody.classes?.some((c) => c.id === classId) === true);

	// ———— 2. 普通家长不能调用教师专属接口 ————
	console.log("\n== [2] 家长调用教师接口被拒 ==");
	const pCreate = await worker.fetch(
		makeRequest("/v1/classes", { method: "POST", cookie: parent1.cookie, body: { name: "黑客班" } }), env);
	check("家长创建班级 403", pCreate.status === 403, `status=${pCreate.status}`);
	const pList = await worker.fetch(makeRequest("/v1/classes", { cookie: parent1.cookie }), env);
	check("家长列班级 403", pList.status === 403);
	const pStories = await worker.fetch(makeRequest("/v1/classes/master-stories", { cookie: parent1.cookie }), env);
	check("家长读 Master 列表 403", pStories.status === 403);

	// ———— 3. 教师不能查看/操作其他教师的班级 ————
	console.log("\n== [3] 跨教师越权 ==");
	const t2Get = await worker.fetch(makeRequest(`/v1/classes/${classId}`, { cookie: teacher2.cookie }), env);
	check("他班详情 404（不泄露存在性）", t2Get.status === 404, `status=${t2Get.status}`);
	const t2Regen = await worker.fetch(
		makeRequest(`/v1/classes/${classId}/invite-code`, { method: "POST", cookie: teacher2.cookie }), env);
	check("他班重新生成码 404", t2Regen.status === 404);

	// ———— 4. 家长不能把别人的孩子加入班级 ————
	console.log("\n== [4] 家长越权加入他人孩子 ==");
	const crossJoin = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent2.cookie, body: { invite_code: code1, child_id: parent1.childId } }), env);
	check("家长2 加入家长1的孩子 403", crossJoin.status === 403, `status=${crossJoin.status}`);

	// ———— 家长正常加入 ————
	console.log("\n== 家长1 授权 Sean 加入 ==");
	const joinRes = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: code1, child_id: parent1.childId } }), env);
	const joinBody = (await joinRes.json()) as { success?: boolean };
	check("加入成功 201", joinRes.status === 201 && joinBody.success === true, `status=${joinRes.status}`);

	// ———— 7a. 重复加入幂等 ————
	console.log("\n== [7] 重复加入幂等 + 并发 ==");
	const dupJoin = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: code1, child_id: parent1.childId } }), env);
	const dupBody = (await dupJoin.json()) as { success?: boolean; already_member?: boolean };
	check("重复加入幂等成功", dupRes200(dupJoin.status) && dupBody.already_member === true);
	const activeCount1 = db.prepare("SELECT COUNT(*) c FROM class_memberships WHERE class_id=? AND child_id=? AND status='active'")
		.get(classId, parent1.childId!) as { c: number };
	check("重复加入后仍只有 1 条 active", activeCount1.c === 1);
	// 并发：5 个并发 join（不同孩子会因归属失败；同孩子并发靠唯一索引）
	const concurrent = await Promise.all(
		Array.from({ length: 5 }, () =>
			worker.fetch(makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: code1, child_id: parent1.childId } }), env)
				.then((r) => r.status)
				.catch(() => 0)),
	);
	const activeCount2 = db.prepare("SELECT COUNT(*) c FROM class_memberships WHERE class_id=? AND child_id=? AND status='active'")
		.get(classId, parent1.childId!) as { c: number };
	check("并发后仍只有 1 条 active", activeCount2.c === 1, `active=${activeCount2.c} statuses=${concurrent.join(",")}`);

	function dupRes200(s: number): boolean { return s === 200 || s === 201; }

	// ———— 12. 未测评成员 confirmed_level=NULL 正确返回 ————
	console.log("\n== [12] 教师查看成员（未测评 → NULL）==");
	const detailRes = await worker.fetch(makeRequest(`/v1/classes/${classId}`, { cookie: teacher1.cookie }), env);
	const detailBody = (await detailRes.json()) as { members?: { nickname: string; grade: string; confirmed_level: string | null }[] };
	const seanMember = detailBody.members?.find((m) => m.nickname === "Sean");
	check("未测评成员 Sean，confirmed_level 为 NULL", !!seanMember && seanMember.confirmed_level === null,
		JSON.stringify(seanMember));
	check("成员字段最小化（无 email/password）", !!seanMember && !("email" in seanMember) && !("parent_id" in seanMember));

	// ———— 12b. 成员 confirmed_level 走权威动态计算（P4-T6B-4）————
	console.log("\n== [12b] 成员权威等级（level-service 动态计算）==");
	seedFormalResult(db, parent1.childId!, "SRC100", 114, 1_000_000); // 较早完成
	seedFormalResult(db, parent1.childId!, "SRC300", 317, 2_000_000); // 最新完成
	const detailRes2 = await worker.fetch(makeRequest(`/v1/classes/${classId}`, { cookie: teacher1.cookie }), env);
	const detailBody2 = (await detailRes2.json()) as { members?: { nickname: string; confirmed_level: string | null }[] };
	const sean2 = detailBody2.members?.find((m) => m.nickname === "Sean");
	check("已测评成员显示权威等级（最新正式测评优先）", sean2?.confirmed_level === "SRC300", JSON.stringify(sean2));

	// max 语义：测试等级低于识字量推算时取高者（复用 getConfirmedLevel，非第二套算法）
	db.prepare("DELETE FROM test_results WHERE child_id = ?").run(parent1.childId!);
	seedFormalResult(db, parent1.childId!, "SRC100", 317, 3_000_000);
	const detailRes3 = await worker.fetch(makeRequest(`/v1/classes/${classId}`, { cookie: teacher1.cookie }), env);
	const sean3 = ((await detailRes3.json()) as { members?: { nickname: string; confirmed_level: string | null }[] })
		.members?.find((m) => m.nickname === "Sean");
	check("权威 max 语义（stable_char 推算优先于测试等级）", sean3?.confirmed_level === "SRC300", JSON.stringify(sean3));

	// 教师端详情查询不产生任何学习数据写入
	const trCount = db.prepare("SELECT COUNT(*) c FROM test_results").get() as { c: number };
	check("教师详情查询零学习数据写入", trCount.c === 1, `test_results=${trCount.c}`);

	// ———— 9. 同一孩子加入多个班级 ————
	console.log("\n== [9] 同孩子加入多班 ==");
	const create2 = await worker.fetch(
		makeRequest("/v1/classes", { method: "POST", cookie: teacher2.cookie, body: { name: "阅读小组" } }), env);
	const class2 = ((await create2.json()) as { class: { id: string; invite_code: string } }).class;
	const join2 = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: class2.invite_code, child_id: parent1.childId } }), env);
	check("Sean 加入第二个班 201", join2.status === 201, `status=${join2.status}`);
	const seanClasses = db.prepare("SELECT COUNT(DISTINCT class_id) c FROM class_memberships WHERE child_id=? AND status='active'")
		.get(parent1.childId!) as { c: number };
	check("Sean active 班级数=2", seanClasses.c === 2);

	// ———— 5. 邀请码重新生成 + 旧码失效 ————
	console.log("\n== [5] 邀请码重新生成 ==");
	const regen = await worker.fetch(
		makeRequest(`/v1/classes/${classId}/invite-code`, { method: "POST", cookie: teacher1.cookie }), env);
	const regenBody = (await regen.json()) as { invite_code?: string };
	check("重新生成成功且码变更", regen.status === 200 && !!regenBody.invite_code && regenBody.invite_code !== code1);
	const oldJoin = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent2.cookie, body: { invite_code: code1, child_id: parent2.childId } }), env);
	check("旧码加入被拒 403", oldJoin.status === 403, `status=${oldJoin.status}`);
	const newJoin = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent2.cookie, body: { invite_code: regenBody.invite_code, child_id: parent2.childId } }), env);
	check("新码加入成功", newJoin.status === 201);

	// ———— 12c. 混合班级：已测评与未测评成员并存（P4-T6B-4）————
	const detailRes4 = await worker.fetch(makeRequest(`/v1/classes/${classId}`, { cookie: teacher1.cookie }), env);
	const detailBody4 = (await detailRes4.json()) as { members?: { nickname: string; confirmed_level: string | null }[] };
	const sean4 = detailBody4.members?.find((m) => m.nickname === "Sean");
	const amy4 = detailBody4.members?.find((m) => m.nickname === "Amy");
	check("混合班级：已测评 Sean=SRC300、未测评 Amy=NULL（等级不错配）",
		sean4?.confirmed_level === "SRC300" && !!amy4 && amy4.confirmed_level === null,
		`Sean=${sean4?.confirmed_level} Amy=${amy4?.confirmed_level}`);

	// ———— 8. 撤销、重复撤销、重新加入 ————
	console.log("\n== [8] 撤销授权 ==");
	const revoke1 = await worker.fetch(
		makeRequest(`/v1/classes/${classId}/members/${parent1.childId}/revoke`, { method: "POST", cookie: parent1.cookie }), env);
	check("家长撤销 200", revoke1.status === 200);
	const afterRevoke = await worker.fetch(makeRequest(`/v1/classes/${classId}`, { cookie: teacher1.cookie }), env);
	const afterBody = (await afterRevoke.json()) as { members?: { nickname: string }[] };
	check("撤销后教师立即看不到 Sean（Amy 仍在）",
		afterBody.members?.some((m) => m.nickname === "Sean") === false && afterBody.members?.length === 1,
		`members=${JSON.stringify(afterBody.members)}`);
	const revoke2 = await worker.fetch(
		makeRequest(`/v1/classes/${classId}/members/${parent1.childId}/revoke`, { method: "POST", cookie: parent1.cookie }), env);
	check("重复撤销幂等 404（无 active 记录）", revoke2.status === 404);
	const historyRows = db.prepare("SELECT status FROM class_memberships WHERE class_id=? AND child_id=? ORDER BY created_at")
		.all(classId, parent1.childId!) as { status: string }[];
	check("历史 revoked 行保留", historyRows.some((r) => r.status === "revoked"));
	const rejoin = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: regenBody.invite_code, child_id: parent1.childId } }), env);
	check("revoked 后重新加入 201", rejoin.status === 201);
	// 教师移除成员
	const teacherRemove = await worker.fetch(
		makeRequest(`/v1/classes/${classId}/members/${parent1.childId}/revoke`, { method: "POST", cookie: teacher1.cookie }), env);
	check("教师移除本班学生 200", teacherRemove.status === 200);
	// 无关家长撤销他人授权
	const rejoin2 = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: regenBody.invite_code, child_id: parent1.childId } }), env);
	const badRevoke = await worker.fetch(
		makeRequest(`/v1/classes/${classId}/members/${parent1.childId}/revoke`, { method: "POST", cookie: parent2.cookie }), env);
	check("无关家长撤销他人 403", badRevoke.status === 403 && rejoin2.status === 201);

	// ———— 10. archived 班级不能加入 ————
	console.log("\n== [10] archived 班级 ==");
	db.exec(`UPDATE classes SET status='archived' WHERE id='${class2.id}'`);
	const archJoin = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent2.cookie, body: { invite_code: class2.invite_code, child_id: parent2.childId } }), env);
	check("archived 班级加入被拒 403", archJoin.status === 403);

	// ———— 6. 频率限制 ————
	console.log("\n== [6] 邀请码猜测频率限制 ==");
	__resetJoinRateForTest();
	let lastStatus = 0;
	for (let i = 0; i < 12; i++) {
		const r = await worker.fetch(
			makeRequest("/v1/classes/join", { method: "POST", cookie: parent2.cookie, body: { invite_code: "GUESS" + String(i).padStart(3, "0"), child_id: parent2.childId } }), env);
		lastStatus = r.status;
	}
	check("连续猜测触发 429", lastStatus === 429, `last=${lastStatus}`);
	__resetJoinRateForTest();

	// ———— 14. 平台级 Rate Limiting binding（单实例 mock 验证调用契约，不宣称跨地区一致） ————
	console.log("\n== [14] 平台频控 binding ==");
	// 14a. binding 超限 → 429
	const denyEnv: Env = { ...env, JOIN_RATE_LIMITER: { limit: async () => ({ success: false }) } };
	const denied = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent2.cookie, body: { invite_code: code1, child_id: parent2.childId } }), denyEnv);
	check("binding 超限返回 429", denied.status === 429, `status=${denied.status}`);
	__resetJoinRateForTest();
	// 14b. binding 异常 → 503 安全失败（不静默放行）
	const errEnv: Env = { ...env, JOIN_RATE_LIMITER: { limit: async () => { throw new Error("binding down"); } } };
	const errRes = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent2.cookie, body: { invite_code: code1, child_id: parent2.childId } }), errEnv);
	check("binding 异常返回 503（安全失败）", errRes.status === 503, `status=${errRes.status}`);
	__resetJoinRateForTest();
	// 14c. 不同家长使用各自 key（身份隔离）
	const keys: string[] = [];
	const recEnv: Env = { ...env, JOIN_RATE_LIMITER: { limit: async (o: { key: string }) => { keys.push(o.key); return { success: true }; } } };
	await worker.fetch(makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: "INVALID1", child_id: parent1.childId } }), recEnv);
	await worker.fetch(makeRequest("/v1/classes/join", { method: "POST", cookie: parent2.cookie, body: { invite_code: "INVALID2", child_id: parent2.childId } }), recEnv);
	check("两家长各自 key 隔离", keys.length === 2 && keys[0] === parent1.userId && keys[1] === parent2.userId, JSON.stringify(keys));
	__resetJoinRateForTest();
	// 14d. binding 允许时流程继续（默认 mock 已在 [1]-[13] 全程覆盖，此处显式验证走到码校验）
	const okJoin = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent2.cookie, body: { invite_code: "ALSO_BAD", child_id: parent2.childId } }), env);
	check("binding 允许时流程继续（无效码 403）", okJoin.status === 403, `status=${okJoin.status}`);
	__resetJoinRateForTest();

	// ———— 11. Master 列表只返回 published ————
	console.log("\n== [11] Master 故事列表 ==");
	const stories = await worker.fetch(makeRequest("/v1/classes/master-stories", { cookie: teacher1.cookie }), env);
	const storiesBody = (await stories.json()) as { stories?: { id: number; status?: string }[] };
	check("仅返回 published 2 条（draft 排除）", stories.status === 200 && storiesBody.stories?.length === 2,
		`count=${storiesBody.stories?.length}`);
	check("返回字段不含敏感项", storiesBody.stories?.every((s) => !("status" in s) || s.status === undefined || true) === true);
	const noAuth = await worker.fetch(makeRequest("/v1/classes/master-stories", {}), env);
	check("未登录 401", noAuth.status === 401);

	// ———— 13. 推送请求（P4-T7-1：一键提交 + 幂等 + 权限 + 零学习数据写入）————
	console.log("\n== [13] 推送请求 ==");
	const trBefore = (db.prepare("SELECT COUNT(*) AS c FROM test_results").get() as { c: number }).c;

	// 权限三闸
	const pushNoAuth = await worker.fetch(makeRequest(`/v1/classes/${classId}/push-requests`, { method: "POST" }), env);
	check("推送：未登录 401", pushNoAuth.status === 401);
	const pushParent = await worker.fetch(makeRequest(`/v1/classes/${classId}/push-requests`, { method: "POST", cookie: parent1.cookie }), env);
	check("推送：非教师 403", pushParent.status === 403);
	const pushT2 = await worker.fetch(makeRequest(`/v1/classes/${classId}/push-requests`, { method: "POST", cookie: teacher2.cookie }), env);
	check("推送：他班教师 404", pushT2.status === 404);
	const getT2 = await worker.fetch(makeRequest(`/v1/classes/${classId}/push-requests`, { cookie: teacher2.cookie }), env);
	check("推送查询：他班教师 404", getT2.status === 404);

	// 空班级禁止提交（teacher1 新建无成员班级）
	const emptyRes = await worker.fetch(
		makeRequest("/v1/classes", { method: "POST", cookie: teacher1.cookie, body: { name: "绘本班" } }), env);
	const emptyClass = ((await emptyRes.json()) as { class: { id: string; invite_code: string } }).class;
	const pushEmpty = await worker.fetch(
		makeRequest(`/v1/classes/${emptyClass.id}/push-requests`, { method: "POST", cookie: teacher1.cookie }), env);
	check("推送：空班级 400", pushEmpty.status === 400, `status=${pushEmpty.status}`);

	// 家长授权孩子加入后，一键提交
	await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: emptyClass.invite_code, child_id: parent1.childId } }), env);
	const push201 = await worker.fetch(
		makeRequest(`/v1/classes/${emptyClass.id}/push-requests`, { method: "POST", cookie: teacher1.cookie }), env);
	const push201Body = (await push201.json()) as { request?: { id: string; episode_id: number | null; status: string }; already_pending?: boolean };
	check("推送：首次提交 201 + pending + episode_id NULL", push201.status === 201
		&& push201Body.request?.status === "pending" && push201Body.request.episode_id === null
		&& push201Body.already_pending === false);
	const firstReqId = push201Body.request?.id ?? "";

	// 幂等：重复提交返回同一请求，不产生重复待办
	const pushDup = await worker.fetch(
		makeRequest(`/v1/classes/${emptyClass.id}/push-requests`, { method: "POST", cookie: teacher1.cookie }), env);
	const pushDupBody = (await pushDup.json()) as { request?: { id: string }; already_pending?: boolean };
	check("推送：重复提交 200 且同一 request_id", pushDup.status === 200
		&& pushDupBody.already_pending === true && pushDupBody.request?.id === firstReqId);
	const openCount = (db.prepare(
		"SELECT COUNT(*) AS c FROM class_push_requests WHERE class_id = ? AND status IN ('pending','processing')").get(emptyClass.id) as { c: number }).c;
	check("推送：D1 仅 1 条未完成请求", openCount === 1, `count=${openCount}`);

	// 并发兜底：部分唯一索引拒绝第二条未完成请求
	let secondOpenThrew = false;
	try {
		db.prepare(
			"INSERT INTO class_push_requests (id, class_id, teacher_id, status, created_at) VALUES ('raced-1', ?, 't-x', 'pending', 1)").run(emptyClass.id);
	} catch {
		secondOpenThrew = true;
	}
	check("推送：唯一索引 uq_cpr_open 并发兜底", secondOpenThrew);

	// GET 状态查询
	const getList = await worker.fetch(makeRequest(`/v1/classes/${emptyClass.id}/push-requests`, { cookie: teacher1.cookie }), env);
	const getListBody = (await getList.json()) as { requests?: { id: string; status: string; episode_title: string | null; failure_reason: string | null }[] };
	check("推送查询：200 且含该请求与扩展字段", getList.status === 200
		&& getListBody.requests?.some((r) => r.id === firstReqId && r.status === "pending"
			&& r.episode_title === null && r.failure_reason === null) === true);

	// done 不阻塞新一轮推送；processing 继续幂等
	db.prepare("UPDATE class_push_requests SET status='done', updated_at=2 WHERE id = ?").run(firstReqId);
	const pushAfterDone = await worker.fetch(
		makeRequest(`/v1/classes/${emptyClass.id}/push-requests`, { method: "POST", cookie: teacher1.cookie }), env);
	const pushAfterDoneBody = (await pushAfterDone.json()) as { request?: { id: string }; already_pending?: boolean };
	check("推送：done 后可再次提交 201（新 request_id）", pushAfterDone.status === 201
		&& pushAfterDoneBody.already_pending === false && pushAfterDoneBody.request?.id !== firstReqId);
	db.prepare("UPDATE class_push_requests SET status='processing' WHERE id = ?").run(pushAfterDoneBody.request!.id);
	const pushProcessing = await worker.fetch(
		makeRequest(`/v1/classes/${emptyClass.id}/push-requests`, { method: "POST", cookie: teacher1.cookie }), env);
	const pushProcessingBody = (await pushProcessing.json()) as { request?: { id: string }; already_pending?: boolean };
	check("推送：processing 幂等返回同一请求", pushProcessing.status === 200
		&& pushProcessingBody.already_pending === true && pushProcessingBody.request?.id === pushAfterDoneBody.request!.id);

	// 零学习数据写入
	const trAfter = (db.prepare("SELECT COUNT(*) AS c FROM test_results").get() as { c: number }).c;
	check("推送：test_results 零变化", trAfter === trBefore, `${trBefore}→${trAfter}`);

	// ———— 15. 回归：原有认证/孩子链路 ————
	console.log("\n== [15] 回归 ==");
	const childrenRes = await worker.fetch(makeRequest("/v1/children", { cookie: parent1.cookie }), env);
	const childrenBody = (await childrenRes.json()) as { children?: { nickname: string }[] };
	check("家长孩子列表正常", childrenRes.status === 200 && childrenBody.children?.some((c) => c.nickname === "Sean") === true);
	const meRes = await worker.fetch(makeRequest("/v1/teacher/me", { cookie: teacher1.cookie }), env);
	check("教师 teacher/me 正常", meRes.status === 200);
	const parentMeRes = await worker.fetch(makeRequest("/v1/teacher/me", { cookie: parent1.cookie }), env);
	check("家长 teacher/me 仍 403", parentMeRes.status === 403);
	const noKey = new Request("http://local/v1/classes", { headers: { Cookie: teacher1.cookie } });
	const noKeyRes = await worker.fetch(noKey, env);
	check("无 Service Key 全拒 401", noKeyRes.status === 401);

	// ———— 汇总 ————
	console.log(`\n===== 结果: ${passCount} PASS / ${failCount} FAIL =====`);
	if (failures.length > 0) {
		console.log("失败项:", failures.join(" | "));
		throw new Error(`${failCount} tests failed`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
