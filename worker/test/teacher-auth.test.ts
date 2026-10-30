/**
 * P4-T1 教师注册与登录 — 本地集成测试
 *
 * 运行：TSX_TSCONFIG_PATH=tsconfig.test.json npx tsx test/teacher-auth.test.ts
 *
 * 设施：
 *   - tsconfig.test.json paths 映射 .wasm → test/wasm-mock/*（真实 wasm 二进制编译）
 *   - setup-webcrypto.ts 补齐 crypto.subtle.timingSafeEqual（Workers 扩展）
 *   - node:sqlite 内存库 + d1-shim（真实 SQL），直接打 Worker fetch 入口（真实路由）
 *
 * 覆盖任务书必验项：
 *   1. 新教师注册成功，不创建孩子
 *   2. 教师登录、Session、teacher/me 放行
 *   3. 家长不能越权进入教师中心（403）
 *   4. 教师不能通过家长 API 越权访问孩子数据（空结果隔离）
 *   5. 家长注册/登录/Session/孩子管理回归
 *   6. 旧 Session 仍可验证（payload 结构未变）
 *   7. 同邮箱重复注册正确提示（409）
 *   8. 角色字段默认值及解析正确（006 迁移 + parseRoles）
 *   10. Service Key 保护
 */

import "./setup-webcrypto";
import "./setup-wasm-ext";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createD1Like } from "./d1-shim.js";
import worker from "../src/index.js";
import { signSession } from "../src/session.js";
import { parseRoles, hasRole, formatRoles } from "../src/roles.js";
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

/** 生产 parents 表（P4-T1 前，无 roles 列） */
const DDL_PARENTS_LEGACY = `
CREATE TABLE parents (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     INTEGER NOT NULL
);`;

/** 家长 signup INSERT 所需的最小 children 表（列与生产一致） */
const DDL_CHILDREN = `
CREATE TABLE children (
  id                    TEXT PRIMARY KEY,
  parent_id             TEXT NOT NULL,
  nickname              TEXT NOT NULL,
  age                   INTEGER NOT NULL,
  grade                 TEXT NOT NULL,
  country               TEXT NOT NULL,
  home_language         TEXT,
  home_language_other   TEXT,
  status                TEXT NOT NULL DEFAULT 'active',
  assessment_status     TEXT,
  estimated_level       TEXT,
  confirmed_level       TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER
);`;

const DDL_GUEST_SESSIONS = `
CREATE TABLE guest_test_sessions (
  id               TEXT PRIMARY KEY,
  claimed          INTEGER NOT NULL DEFAULT 0,
  child_id         TEXT,
  result_data_json TEXT
);`;

const TEST_SERVICE_KEY = "test-service-key-p4t1";
const TEST_SECRET = "test-session-secret-p4t1";

function makeEnv(db: DatabaseSync): Env {
	return {
		DB: createD1Like(db) as unknown as Env["DB"],
		SRC_WORKER_SERVICE_KEY: TEST_SERVICE_KEY,
		SESSION_SECRET: TEST_SECRET,
		ADMIN_PASSWORD: "unused-in-this-suite",
	};
}

/** 006 迁移后的全新库 */
function createFreshDb(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec(DDL_PARENTS_LEGACY);
	db.exec(DDL_CHILDREN);
	db.exec(DDL_GUEST_SESSIONS);
	applyMigration006(db);
	return db;
}

/** 执行 006 迁移 SQL 文件（过滤注释与空行，逐条执行） */
function applyMigration006(db: DatabaseSync): void {
	const sql = readFileSync(join(HERE, "../migrations/006_parents_roles.sql"), "utf8");
	const statements = sql
		.split(";")
		.map((s) => s.replace(/--[^\n]*/g, "").trim())
		.filter((s) => s.length > 0);
	for (const stmt of statements) {
		db.exec(stmt);
	}
}

// ————————————————————————————————————
// HTTP 请求助手
// ————————————————————————————————————

function makeRequest(
	path: string,
	init: { method?: string; body?: unknown; cookie?: string; session?: string; noServiceKey?: boolean } = {},
): Request {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (!init.noServiceKey) {
		headers["X-SRC-Service-Key"] = TEST_SERVICE_KEY;
	}
	if (init.cookie) {
		headers["Cookie"] = init.cookie;
	}
	if (init.session) {
		headers["x-session"] = init.session;
	}
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

interface SignupResponseBody {
	success?: boolean;
	session?: string;
	user?: { id: string; email: string; roles?: string[] };
	children?: unknown[];
	error?: string;
}

async function signupParent(
	db: DatabaseSync,
	email: string,
	password = "ParentPass123!",
): Promise<{ status: number; body: SignupResponseBody; cookie: string }> {
	const res = await worker.fetch(
		makeRequest("/v1/auth/signup", {
			method: "POST",
			body: {
				email,
				password,
				nickname: "测试孩子",
				age: 8,
				grade: "Grade 2",
				country: "USA",
			},
		}),
		makeEnv(db),
	);
	return { status: res.status, body: await res.json() as SignupResponseBody, cookie: extractSessionCookie(res) };
}

async function signupTeacher(
	db: DatabaseSync,
	email: string,
	password = "TeacherPass123!",
): Promise<{ status: number; body: SignupResponseBody; cookie: string }> {
	const res = await worker.fetch(
		makeRequest("/v1/auth/teacher/signup", { method: "POST", body: { email, password } }),
		makeEnv(db),
	);
	return { status: res.status, body: await res.json() as SignupResponseBody, cookie: extractSessionCookie(res) };
}

async function login(
	db: DatabaseSync,
	email: string,
	password: string,
): Promise<{ status: number; body: SignupResponseBody; cookie: string }> {
	const res = await worker.fetch(
		makeRequest("/v1/auth/login", { method: "POST", body: { email, password } }),
		makeEnv(db),
	);
	return { status: res.status, body: await res.json() as SignupResponseBody, cookie: extractSessionCookie(res) };
}

// ————————————————————————————————————
// 测试套件
// ————————————————————————————————————

const main = async () => {
	// ===== A. roles 模块单元测试 =====
	console.log("\n[A] roles 解析模块");
	check("A1 'parent' → ['parent']", JSON.stringify(parseRoles("parent")) === '["parent"]');
	check("A2 'teacher' → ['teacher']", JSON.stringify(parseRoles("teacher")) === '["teacher"]');
	check(
		"A3 'parent,teacher' → ['parent','teacher']",
		JSON.stringify(parseRoles("parent,teacher")) === '["parent","teacher"]',
	);
	check(
		"A4 'teacher,parent' 稳定顺序 → ['parent','teacher']",
		JSON.stringify(parseRoles("teacher,parent")) === '["parent","teacher"]',
	);
	check("A5 null → ['parent']", JSON.stringify(parseRoles(null)) === '["parent"]');
	check("A6 undefined → ['parent']", JSON.stringify(parseRoles(undefined)) === '["parent"]');
	check("A7 空串 → ['parent']", JSON.stringify(parseRoles("")) === '["parent"]');
	check(
		"A8 脏数据 'noteacher' 不得误判为教师 → ['parent']",
		JSON.stringify(parseRoles("noteacher")) === '["parent"]' && !hasRole(parseRoles("noteacher"), "teacher"),
	);
	check("A9 去重 'teacher,teacher' → ['teacher']", JSON.stringify(parseRoles("teacher,teacher")) === '["teacher"]');
	check(
		"A10 formatRoles 往返一致",
		formatRoles(["teacher", "parent"]) === "parent,teacher" &&
			formatRoles(parseRoles(formatRoles(["teacher"]))) === "teacher",
	);

	// ===== B. 006 迁移测试 =====
	console.log("\n[B] 006 迁移（parents.roles）");
	{
		const db = new DatabaseSync(":memory:");
		db.exec(DDL_PARENTS_LEGACY);
		db.exec(
			`INSERT INTO parents (id, email, password_hash, email_verified, status, created_at)
			 VALUES ('p-legacy', 'legacy@example.com', 'x', 1, 'active', 1700000000)`,
		);
		// 迁移前：无 roles 列
		const colsBefore = db.prepare("PRAGMA table_info(parents)").all() as { name: string }[];
		check("B1 迁移前无 roles 列", !colsBefore.some((c) => c.name === "roles"));

		applyMigration006(db);
		const colsAfter = db.prepare("PRAGMA table_info(parents)").all() as { name: string }[];
		check("B2 迁移后 roles 列存在", colsAfter.some((c) => c.name === "roles"));

		const row = db.prepare("SELECT roles FROM parents WHERE id = 'p-legacy'").get() as { roles: string };
		check("B3 存量账号默认 roles='parent'", row.roles === "parent");
		check("B4 parseRoles 解析默认值", JSON.stringify(parseRoles(row.roles)) === '["parent"]');

		// 幂等检测逻辑（run_local.mjs 模式）：列已存在则跳过
		const hasCol = (db.prepare("PRAGMA table_info(parents)").all() as { name: string }[])
			.some((c) => c.name === "roles");
		check("B5 PRAGMA 幂等检测可判定已迁移", hasCol);
		db.close();
	}

	// ===== C. 教师注册 =====
	console.log("\n[C] 教师注册（POST /v1/auth/teacher/signup）");
	const db1 = createFreshDb();
	{
		const { status, body, cookie } = await signupTeacher(db1, "teacher1@school.com");
		check("C1 教师注册 200", status === 200, `status=${status} err=${body.error ?? ""}`);
		check("C2 返回 success + session", body.success === true && typeof body.session === "string" && body.session.length > 0);
		check("C3 user.roles=['teacher']", JSON.stringify(body.user?.roles) === '["teacher"]');
		check("C4 children 为空数组", Array.isArray(body.children) && body.children.length === 0);
		check("C5 Set-Cookie 已签发", cookie.startsWith("src_auth_session="));

		// DB 层核验：roles='teacher' 且无 children 行
		const parentRow = db1.prepare("SELECT roles FROM parents WHERE email = 'teacher1@school.com'").get() as { roles: string };
		check("C6 DB roles='teacher'", parentRow.roles === "teacher");
		const childRows = db1.prepare(
			"SELECT id FROM children WHERE parent_id = (SELECT id FROM parents WHERE email = 'teacher1@school.com')",
		).all();
		check("C7 注册不创建 children", childRows.length === 0);
	}

	// C-校验失败分支
	{
		const bad1 = await signupTeacher(db1, "not-an-email");
		check("C8 无效邮箱 400", bad1.status === 400);
		const bad2 = await signupTeacher(db1, "teacher2@school.com", "short");
		check("C9 弱密码(<8) 400", bad2.status === 400);
		const bad3 = await worker.fetch(
			makeRequest("/v1/auth/teacher/signup", { method: "POST", body: { email: "t3@school.com", password: "TeacherPass123!" }, noServiceKey: true }),
			makeEnv(db1),
		);
		check("C10 无 Service Key → 401", bad3.status === 401);
	}

	// ===== D. 邮箱全局唯一（家长/教师互斥） =====
	console.log("\n[D] 邮箱全局唯一");
	{
		const parent = await signupParent(db1, "shared@example.com");
		check("D1 家长先注册成功", parent.status === 200, `status=${parent.status} err=${parent.body.error ?? ""}`);
		const dup = await signupTeacher(db1, "shared@example.com");
		check("D2 同邮箱教师注册 409", dup.status === 409);
		check(
			"D3 409 提示含友好引导",
			typeof dup.body.error === "string" && dup.body.error.includes("已经注册") && dup.body.error.includes("教师身份"),
		);
		const dup2 = await signupTeacher(db1, "teacher1@school.com");
		check("D4 重复教师邮箱 409", dup2.status === 409);
		// 教师邮箱注册家长同样互斥
		const dup3 = await signupParent(db1, "teacher1@school.com");
		check("D5 教师邮箱注册家长 409", dup3.status === 409);
	}

	// ===== E. 登录与角色返回 =====
	console.log("\n[E] 登录返回规范化角色");
	{
		const t = await login(db1, "teacher1@school.com", "TeacherPass123!");
		check("E1 教师登录 200", t.status === 200);
		check("E2 教师登录返回 roles=['teacher']", JSON.stringify(t.body.user?.roles) === '["teacher"]');

		const p = await login(db1, "shared@example.com", "ParentPass123!");
		check("E3 家长登录 200", p.status === 200);
		check("E4 家长登录返回 roles=['parent']", JSON.stringify(p.body.user?.roles) === '["parent"]');

		const bad = await login(db1, "teacher1@school.com", "WrongPass999");
		check("E5 错误密码 401 统一提示", bad.status === 401 && bad.body.error === "Email或密码不正确");
	}

	// ===== F. /v1/auth/me 角色 + 旧 Session 兼容 =====
	console.log("\n[F] /v1/auth/me 与旧 Session 兼容");
	{
		const t = await login(db1, "teacher1@school.com", "TeacherPass123!");
		const meRes = await worker.fetch(
			makeRequest("/v1/auth/me", { cookie: t.cookie }),
			makeEnv(db1),
		);
		const meBody = await meRes.json() as { user?: { roles?: string[]; email?: string } };
		check("F1 me 返回教师 roles", meRes.status === 200 && JSON.stringify(meBody.user?.roles) === '["teacher"]');

		// 既有行为确认：Worker 端仅 Cookie 通道（getSessionFromRequest 只读 Cookie），
		// x-session header 单独发送时不被 Worker 识别 → 401（P4-T1 不改变此行为）
		const meRes2 = await worker.fetch(
			makeRequest("/v1/auth/me", { session: t.body.session }),
			makeEnv(db1),
		);
		check("F2 Worker 仅 Cookie 通道（x-session 单独无效，既有行为）", meRes2.status === 401);

		// 旧 Session 兼容：payload 结构未变（仅 parent_id/iat/exp），
		// 用同一 signSession 手工签发 token 经 Cookie 通道验证
		const parentRow = db1.prepare("SELECT id FROM parents WHERE email = 'teacher1@school.com'").get() as { id: string };
		const legacyToken = await signSession({ parent_id: parentRow.id }, TEST_SECRET);
		const meRes3 = await worker.fetch(
			makeRequest("/v1/auth/me", { cookie: `src_auth_session=${legacyToken}` }),
			makeEnv(db1),
		);
		const meBody3 = await meRes3.json() as { user?: { roles?: string[] } };
		check(
			"F3 旧格式 Session 经 Cookie 通道仍可验证",
			meRes3.status === 200 && JSON.stringify(meBody3.user?.roles) === '["teacher"]',
		);
	}

	// ===== G. /v1/teacher/me 服务端角色校验 =====
	console.log("\n[G] /v1/teacher/me 服务端角色校验");
	{
		const t = await login(db1, "teacher1@school.com", "TeacherPass123!");
		const okRes = await worker.fetch(
			makeRequest("/v1/teacher/me", { cookie: t.cookie }),
			makeEnv(db1),
		);
		const okBody = await okRes.json() as { user?: { roles?: string[]; email?: string } };
		check("G1 教师 200", okRes.status === 200);
		check("G2 返回教师账号信息", okBody.user?.email === "teacher1@school.com" && JSON.stringify(okBody.user?.roles) === '["teacher"]');

		const p = await login(db1, "shared@example.com", "ParentPass123!");
		const denyRes = await worker.fetch(
			makeRequest("/v1/teacher/me", { cookie: p.cookie }),
			makeEnv(db1),
		);
		check("G3 家长 403（不能仅靠 URL 进入教师中心）", denyRes.status === 403);

		const anonRes = await worker.fetch(
			makeRequest("/v1/teacher/me", {}),
			makeEnv(db1),
		);
		check("G4 无 Session 401", anonRes.status === 401);
	}

	// ===== H. 越权隔离：教师访问家长 API =====
	console.log("\n[H] 越权隔离");
	{
		const t = await login(db1, "teacher1@school.com", "TeacherPass123!");
		const res = await worker.fetch(
			makeRequest("/v1/children", { cookie: t.cookie }),
			makeEnv(db1),
		);
		const body = await res.json() as { children?: unknown[] };
		check(
			"H1 教师调 /v1/children 仅见自己名下（空）",
			res.status === 200 && Array.isArray(body.children) && body.children.length === 0,
			`status=${res.status} body=${JSON.stringify(body)}`,
		);
		// 家长能看到自己的孩子（对照组）
		const p = await login(db1, "shared@example.com", "ParentPass123!");
		const res2 = await worker.fetch(
			makeRequest("/v1/children", { cookie: p.cookie }),
			makeEnv(db1),
		);
		const body2 = await res2.json() as { children?: unknown[] };
		check("H2 家长可见自己孩子（回归对照）", res2.status === 200 && Array.isArray(body2.children) && body2.children.length === 1);
	}

	// ===== I. 家长注册登录回归 =====
	console.log("\n[I] 家长流程回归");
	{
		const db2 = createFreshDb();
		const p = await signupParent(db2, "parent@example.com");
		check("I1 家长注册 200", p.status === 200, `err=${p.body.error ?? ""}`);
		check("I2 家长注册返回 roles=['parent']", JSON.stringify(p.body.user?.roles) === '["parent"]');
		check("I3 家长注册创建 1 个孩子", Array.isArray(p.body.children) && p.body.children.length === 1);
		const rolesRow = db2.prepare("SELECT roles FROM parents WHERE email = 'parent@example.com'").get() as { roles: string };
		check("I4 DB 默认 roles='parent'", rolesRow.roles === "parent");

		// 家长不能进教师中心
		const deny = await worker.fetch(
			makeRequest("/v1/teacher/me", { cookie: p.cookie }),
			makeEnv(db2),
		);
		check("I5 新注册家长 teacher/me 403", deny.status === 403);
	}

	// ===== 汇总 =====
	console.log(`\n===== 结果：${passCount} PASS / ${failCount} FAIL =====`);
	if (failures.length > 0) {
		console.log("失败用例：");
		for (const f of failures) console.log(`  - ${f}`);
		process.exit(1);
	}
};

main().catch((e) => {
	console.error("测试执行异常：", e);
	process.exit(1);
});
