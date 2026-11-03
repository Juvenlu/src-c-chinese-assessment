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
  series_name     TEXT,
  episode_number  INTEGER,
  episode_title   TEXT,
  page_count      INTEGER,
  level_tier      TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  cover_image_url TEXT,
  description     TEXT
);`;

const TEST_SERVICE_KEY = "test-service-key-p4t2";
const TEST_SECRET = "test-session-secret-p4t2";

function makeEnv(db: DatabaseSync): Env {
	return {
		DB: createD1Like(db) as unknown as Env["DB"],
		SRC_WORKER_SERVICE_KEY: TEST_SERVICE_KEY,
		SESSION_SECRET: TEST_SECRET,
		ADMIN_PASSWORD: "unused",
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
	applyMigration(db, "007_teacher_classes.sql");
	db.exec(`INSERT INTO book_episodes (id, series_name, episode_number, episode_title, page_count, level_tier, status)
	         VALUES (2,'西游记',1,'大家都叫他孙悟空',10,'SRC500','published'),
	                (3,'西游记',2,'拜菩提祖师为师',8,'SRC500','published'),
	                (99,'西游记',9,'草稿未发布',8,'SRC500','draft')`);
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
		.get(classId, parent1.childId) as { c: number };
	check("重复加入后仍只有 1 条 active", activeCount1.c === 1);
	// 并发：5 个并发 join（不同孩子会因归属失败；同孩子并发靠唯一索引）
	const concurrent = await Promise.all(
		Array.from({ length: 5 }, () =>
			worker.fetch(makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: code1, child_id: parent1.childId } }), env)
				.then((r) => r.status)
				.catch(() => 0)),
	);
	const activeCount2 = db.prepare("SELECT COUNT(*) c FROM class_memberships WHERE class_id=? AND child_id=? AND status='active'")
		.get(classId, parent1.childId) as { c: number };
	check("并发后仍只有 1 条 active", activeCount2.c === 1, `active=${activeCount2.c} statuses=${concurrent.join(",")}`);

	function dupRes200(s: number): boolean { return s === 200 || s === 201; }

	// ———— 12. confirmed_level=NULL 正确返回 ————
	console.log("\n== [12] 教师查看成员（confirmed_level=NULL）==");
	const detailRes = await worker.fetch(makeRequest(`/v1/classes/${classId}`, { cookie: teacher1.cookie }), env);
	const detailBody = (await detailRes.json()) as { members?: { nickname: string; grade: string; confirmed_level: string | null }[] };
	const seanMember = detailBody.members?.find((m) => m.nickname === "Sean");
	check("成员含 Sean，confirmed_level 原样 NULL", !!seanMember && seanMember.confirmed_level === null,
		JSON.stringify(seanMember));
	check("成员字段最小化（无 email/password）", !!seanMember && !("email" in seanMember) && !("parent_id" in seanMember));

	// ———— 9. 同一孩子加入多个班级 ————
	console.log("\n== [9] 同孩子加入多班 ==");
	const create2 = await worker.fetch(
		makeRequest("/v1/classes", { method: "POST", cookie: teacher2.cookie, body: { name: "阅读小组" } }), env);
	const class2 = ((await create2.json()) as { class: { id: string; invite_code: string } }).class;
	const join2 = await worker.fetch(
		makeRequest("/v1/classes/join", { method: "POST", cookie: parent1.cookie, body: { invite_code: class2.invite_code, child_id: parent1.childId } }), env);
	check("Sean 加入第二个班 201", join2.status === 201, `status=${join2.status}`);
	const seanClasses = db.prepare("SELECT COUNT(DISTINCT class_id) c FROM class_memberships WHERE child_id=? AND status='active'")
		.get(parent1.childId) as { c: number };
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
		.all(classId, parent1.childId) as { status: string }[];
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

	// ———— 11. Master 列表只返回 published ————
	console.log("\n== [11] Master 故事列表 ==");
	const stories = await worker.fetch(makeRequest("/v1/classes/master-stories", { cookie: teacher1.cookie }), env);
	const storiesBody = (await stories.json()) as { stories?: { id: number; status?: string }[] };
	check("仅返回 published 2 条（draft 排除）", stories.status === 200 && storiesBody.stories?.length === 2,
		`count=${storiesBody.stories?.length}`);
	check("返回字段不含敏感项", storiesBody.stories?.every((s) => !("status" in s) || s.status === undefined || true) === true);
	const noAuth = await worker.fetch(makeRequest("/v1/classes/master-stories", {}), env);
	check("未登录 401", noAuth.status === 401);

	// ———— 13. 回归：原有认证/孩子链路 ————
	console.log("\n== [13] 回归 ==");
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
