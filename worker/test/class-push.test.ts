/**
 * P4-T9-1C-S4 课堂推送核心业务 — 本地集成测试
 *
 * 运行：TSX_TSCONFIG_PATH=tsconfig.test.json npx tsx test/class-push.test.ts
 *
 * 设施：node:sqlite 内存库 + d1-shim（真实 SQL/外键/部分唯一索引），
 *       直接打 Worker fetch 入口（真实路由），007/008/009 迁移文件真实执行。
 *
 * 覆盖任务书第五节 9 项验收：
 *  2. 教师系列设置权限、申请快照及重复申请
 *  3. 管理员鉴权、队列、claim 重入、详情及关闭条件
 *  4. Master 系列匹配、published 校验
 *  5. 家庭/课堂各 2 本额度边界及跨渠道归档隔离
 *  6. Activate / Push 幂等
 *  7. 逐孩子结果唯一性、失败重试和中断恢复
 *  8. 错误孩子、错误申请、错误 rewrite、错误 channel 均被拒绝
 *  9. 历史家庭绘本行为保持不变（含 NULL 快照历史申请阻断）
 *
 * 不写 Production，不发网络请求。
 */

import "./setup-webcrypto";
import "./setup-wasm-ext";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createD1Like } from "./d1-shim.js";
import worker from "../src/index.js";
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
// Schema 与 Env（与 classes.test.ts 同基建 + 绘本域种子）
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

const DDL_READING_RECORDS = `
CREATE TABLE reading_records (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id         TEXT NOT NULL,
  custom_book_id   INTEGER NOT NULL,
  start_time       INTEGER NOT NULL,
  end_time         INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  pages_read       INTEGER NOT NULL DEFAULT 0,
  total_pages      INTEGER NOT NULL DEFAULT 0,
  completed        INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);`;

const TEST_SERVICE_KEY = "test-service-key-p4t9";
const TEST_SECRET = "test-session-secret-p4t9";
const ADMIN_PWD = "test-admin-pwd-p4t9";

function makeEnv(db: DatabaseSync): Env {
	return {
		DB: createD1Like(db) as unknown as Env["DB"],
		SRC_WORKER_SERVICE_KEY: TEST_SERVICE_KEY,
		SESSION_SECRET: TEST_SECRET,
		ADMIN_PASSWORD: ADMIN_PWD,
		JOIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	};
}

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
	db.exec(DDL_READING_RECORDS);
	applyMigration(db, "007_teacher_classes.sql");
	applyMigration(db, "008_class_push_requests.sql");
	applyMigration(db, "009_teacher_class_series_channel.sql");
	// 系列 1 西游记：EP2/EP3 published、EP99 draft；系列 2 哈利波特：EP10 published
	db.exec(`INSERT INTO book_episodes (id, series_id, series_name, episode_number, episode_title, page_count, level_tier, status)
	         VALUES (2,1,'西游记',1,'大家都叫他孙悟空',10,'SRC500','published'),
	                (3,1,'西游记',2,'拜菩提祖师为师',8,'SRC500','published'),
	                (99,1,'西游记',9,'草稿未发布',8,'SRC500','draft'),
	                (10,2,'哈利波特',1,'大难不死的男孩',9,'SRC300','published')`);
	return db;
}

// ————————————————————————————————————
// HTTP 请求助手
// ————————————————————————————————————

function makeRequest(
	path: string,
	init: { method?: string; body?: unknown; cookie?: string; admin?: boolean; badAdmin?: boolean } = {},
): Request {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-SRC-Service-Key": TEST_SERVICE_KEY,
	};
	if (init.cookie) headers["Cookie"] = init.cookie;
	if (init.admin) headers["x-admin-password"] = ADMIN_PWD;
	if (init.badAdmin) headers["x-admin-password"] = "wrong-pwd";
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

async function signupTeacher(db: DatabaseSync, email: string): Promise<{ cookie: string; userId?: string }> {
	const res = await worker.fetch(
		makeRequest("/v1/auth/teacher/signup", { method: "POST", body: { email, password: "TeacherPass123!" } }),
		makeEnv(db),
	);
	const body = (await res.json()) as { user?: { id: string } };
	return { cookie: extractSessionCookie(res), userId: body.user?.id };
}

async function signupParent(
	db: DatabaseSync,
	email: string,
	nickname: string,
): Promise<{ cookie: string; userId?: string; childId?: string }> {
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

function seedFormalResult(db: DatabaseSync, childId: string, level: string, completedAt: number): void {
	db.prepare(
		`INSERT INTO test_results (id, child_id, level, test_type, status, stable_char_count, completed_at, created_at)
		 VALUES (?,?,?,'formal','completed',300,?,?)`,
	).run(`tr-${completedAt}-${childId.slice(0, 8)}`, childId, level, completedAt, completedAt);
}

/** 种子：final 状态 rewrite，返回 rewrite id */
function seedRewrite(
	db: DatabaseSync,
	episodeId: number,
	childId: string,
	level: string,
	status = "final",
): number {
	const r = db.prepare(
		`INSERT INTO book_rewrite_versions (episode_id, child_id, target_level, pages_json, status, version, created_at, finalized_at, finalized_by)
		 VALUES (?,?,?,?,?,1,1700000000,?,?)`,
	).run(episodeId, childId, level, "[]", status, status === "final" ? 1700000100 : null, status === "final" ? "admin" : null);
	return Number(r.lastInsertRowid);
}

/** 种子：家庭（或指定渠道）custom_book，返回 id */
function seedCustomBook(
	db: DatabaseSync,
	childId: string,
	rewriteId: number,
	episodeId: number,
	opts: { channel?: string; status?: string; completed?: boolean } = {},
): number {
	const r = db.prepare(
		`INSERT INTO custom_books (child_id, rewrite_id, episode_id, level_tier, status, channel, created_at, updated_at)
		 VALUES (?,?,?,'SRC300',?,?,1700000000,1700000000)`,
	).run(childId, rewriteId, episodeId, opts.status ?? "active", opts.channel ?? "home");
	const id = Number(r.lastInsertRowid);
	if (opts.completed) {
		db.prepare(
			`INSERT INTO reading_records (child_id, custom_book_id, start_time, pages_read, total_pages, completed, created_at)
			 VALUES (?,?,1700000000,10,10,1,1700000000)`,
		).run(childId, id);
	}
	return id;
}

const getOne = <T>(db: DatabaseSync, sql: string, params: (null | number | string)[]): T | undefined =>
	db.prepare(sql).get(...params) as T | undefined;

// ————————————————————————————————————
// 主测试
// ————————————————————————————————————

async function main(): Promise<void> {
	const db = createFreshDb();
	const env = makeEnv(db);

	// 角色：教师 T1/T2、家长→孩子 K1/K2（同班）、K3（他班）
	const t1 = await signupTeacher(db, "t1@test.com");
	const t2 = await signupTeacher(db, "t2@test.com");
	const p1 = await signupParent(db, "p1@test.com", "K1");
	const p2 = await signupParent(db, "p2@test.com", "K2");
	const p3 = await signupParent(db, "p3@test.com", "K3");
	const K1 = p1.childId as string;
	const K2 = p2.childId as string;
	const K3 = p3.childId as string;
	seedFormalResult(db, K1, "SRC300", 1700000000);
	seedFormalResult(db, K2, "SRC500", 1700000000);

	// 建班 C1（T1，初始无系列）；K1/K2 入班
	const createRes = await worker.fetch(
		makeRequest("/v1/classes", { method: "POST", body: { name: "一班" }, cookie: t1.cookie }),
		env,
	);
	const createBody = (await createRes.json()) as { class: { id: string; invite_code: string; story_series_id?: number | null } };
	const C1 = createBody.class.id;
	for (const p of [p1, p2]) {
		const joinRes = await worker.fetch(
			makeRequest("/v1/classes/join", { method: "POST", body: { invite_code: createBody.class.invite_code, child_id: p.childId }, cookie: p.cookie }),
			env,
		);
		if (joinRes.status !== 200 && joinRes.status !== 201) throw new Error(`join 失败: ${joinRes.status} ${JSON.stringify(await joinRes.json())}`);
	}

	console.log("\n== [2] 教师系列设置权限与申请快照 ==");

	// 创建班级即带系列
	const createWithSeries = await worker.fetch(
		makeRequest("/v1/classes", { method: "POST", body: { name: "带系列班", story_series_id: 1 }, cookie: t1.cookie }),
		env,
	);
	const cwsBody = (await createWithSeries.json()) as { class?: { story_series_id?: number | null } };
	check("建班可带 story_series_id=1", createWithSeries.status === 201 && cwsBody.class?.story_series_id === 1, `status=${createWithSeries.status} body=${JSON.stringify(cwsBody)}`);

	// 建班带无效系列 → 400
	const createBadSeries = await worker.fetch(
		makeRequest("/v1/classes", { method: "POST", body: { name: "坏系列班", story_series_id: 777 }, cookie: t1.cookie }),
		env,
	);
	check("建班带无效系列 400", createBadSeries.status === 400);

	// PATCH：未登录 401
	const patchNoAuth = await worker.fetch(
		makeRequest(`/v1/classes/${C1}/series`, { method: "PATCH", body: { story_series_id: 1 } }),
		env,
	);
	check("PATCH 系列：未登录 401", patchNoAuth.status === 401);

	// PATCH：他班教师 404
	const patchOther = await worker.fetch(
		makeRequest(`/v1/classes/${C1}/series`, { method: "PATCH", body: { story_series_id: 1 }, cookie: t2.cookie }),
		env,
	);
	check("PATCH 系列：他班教师 404", patchOther.status === 404);

	// PATCH：所属教师 200
	const patchOk = await worker.fetch(
		makeRequest(`/v1/classes/${C1}/series`, { method: "PATCH", body: { story_series_id: 1 }, cookie: t1.cookie }),
		env,
	);
	const patchOkBody = (await patchOk.json()) as { class?: { story_series_id?: number | null } };
	check("PATCH 系列：所属教师 200 且值=1", patchOk.status === 200 && patchOkBody.class?.story_series_id === 1, `status=${patchOk.status} body=${JSON.stringify(patchOkBody)}`);

	// PATCH：无效系列 400
	const patchBad = await worker.fetch(
		makeRequest(`/v1/classes/${C1}/series`, { method: "PATCH", body: { story_series_id: 777 }, cookie: t1.cookie }),
		env,
	);
	check("PATCH 系列：无效系列 400", patchBad.status === 400);

	// PATCH：非法 body 400
	const patchBadBody = await worker.fetch(
		makeRequest(`/v1/classes/${C1}/series`, { method: "PATCH", body: { story_series_id: "abc" }, cookie: t1.cookie }),
		env,
	);
	check("PATCH 系列：非法 body 400", patchBadBody.status === 400);

	// 申请快照：当前系列 1 → 申请 R1
	const pushRes = await worker.fetch(
		makeRequest(`/v1/classes/${C1}/push-requests`, { method: "POST", cookie: t1.cookie }),
		env,
	);
	const pushBody = (await pushRes.json()) as { request: { id: string; story_series_id?: number | null } };
	const R1 = pushBody.request.id;
	check("申请保存系列快照=1", pushRes.status === 201 && pushBody.request.story_series_id === 1, `status=${pushRes.status} body=${JSON.stringify(pushBody)}`);
	const r1Row = getOne<{ story_series_id: number | null }>(db, "SELECT story_series_id FROM class_push_requests WHERE id=?", [R1]);
	check("D1 中 R1 快照=1", r1Row?.story_series_id === 1);

	// 班级改系列 2 → R1 快照保持 1（不回填不改写）
	await worker.fetch(makeRequest(`/v1/classes/${C1}/series`, { method: "PATCH", body: { story_series_id: 2 }, cookie: t1.cookie }), env);
	const r1RowAfter = getOne<{ story_series_id: number | null }>(db, "SELECT story_series_id FROM class_push_requests WHERE id=?", [R1]);
	check("改系列后 R1 快照仍=1（快照不变）", r1RowAfter?.story_series_id === 1);

	// 重复申请幂等：processing/pending 时重申请返回同一 request
	const pushAgain = await worker.fetch(
		makeRequest(`/v1/classes/${C1}/push-requests`, { method: "POST", cookie: t1.cookie }),
		env,
	);
	const pushAgainBody = (await pushAgain.json()) as { request: { id: string } };
	check("重复申请幂等返回同一 request_id", pushAgain.status === 200 && pushAgainBody.request.id === R1, JSON.stringify(pushAgainBody));
	const openCount = getOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM class_push_requests WHERE class_id=? AND status IN ('pending','processing')", [C1]);
	check("D1 仅 1 条未完成申请", openCount?.n === 1);

	console.log("\n== [3] 管理员鉴权 / 队列 / claim 重入 / 详情 / 关闭条件 ==");

	// 鉴权：无头 401、错口令 403
	const listNoAuth = await worker.fetch(makeRequest("/v1/admin/push-requests"), env);
	check("队列：无 admin 头 401", listNoAuth.status === 401);
	const listBadAuth = await worker.fetch(makeRequest("/v1/admin/push-requests", { badAdmin: true }), env);
	check("队列：错口令 401", listBadAuth.status === 401);

	// 队列含 R1（pending），字段含班级/系列
	const listOk = await worker.fetch(makeRequest("/v1/admin/push-requests", { admin: true }), env);
	const listBody = (await listOk.json()) as { requests: Array<{ id: string; status: string; story_series_id: number | null; series_name?: string }> };
	const r1InList = listBody.requests.find((r) => r.id === R1);
	check("队列 200 且含 R1(pending,系列=1)", listOk.status === 200 && r1InList?.status === "pending" && r1InList?.story_series_id === 1, JSON.stringify(r1InList));
	check("队列含系列名 西游记", r1InList?.series_name === "西游记");

	// claim：pending → processing，预建 results（K1/K2 processing）
	const claimRes = await worker.fetch(makeRequest(`/v1/admin/push-requests/${R1}/claim`, { method: "POST", admin: true }), env);
	const claimBody = (await claimRes.json()) as { request?: { status?: string }; claimed?: boolean };
	check("claim 200 → processing", claimRes.status === 200 && claimBody.request?.status === "processing" && claimBody.claimed === true, JSON.stringify(claimBody));
	const seededRows = db.prepare("SELECT child_id, status FROM class_push_results WHERE request_id=? ORDER BY child_id").all(R1) as Array<{ child_id: string; status: string }>;
	check("results 预建行=K1/K2 processing", seededRows.length === 2 && seededRows.every((r) => r.status === "processing"), JSON.stringify(seededRows));

	// claim 重入：幂等，不重复预建
	const claimAgain = await worker.fetch(makeRequest(`/v1/admin/push-requests/${R1}/claim`, { method: "POST", admin: true }), env);
	const claimAgainBody = (await claimAgain.json()) as { request?: { status?: string }; claimed?: boolean };
	const seededCount = getOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM class_push_results WHERE request_id=?", [R1]);
	check("claim 重入幂等（仍 processing，results 仍 2 条）", claimAgain.status === 200 && claimAgainBody.request?.status === "processing" && seededCount?.n === 2, JSON.stringify(claimAgainBody));

	// 详情：成员 + confirmed_level + 额度 + results + available_masters
	const detailRes = await worker.fetch(makeRequest(`/v1/admin/push-requests/${R1}`, { admin: true }), env);
	const detail = (await detailRes.json()) as {
		request: { id: string; status: string; story_series_id: number | null };
		students: Array<{ child_id: string; confirmed_level: string | null; class_unfinished_count: number; result?: { status: string } | null }>;
		available_masters: Array<{ id: number; series_id: number }>;
		series_block_reason?: string | null;
	};
	check("详情 200：申请 processing + 快照=1", detailRes.status === 200 && detail.request.status === "processing" && detail.request.story_series_id === 1);
	const stu1 = detail.students.find((s) => s.child_id === K1);
	const stu2 = detail.students.find((s) => s.child_id === K2);
	check("详情：K1 confirmed_level=SRC300", stu1?.confirmed_level === "SRC300", JSON.stringify(stu1));
	check("详情：K2 confirmed_level=SRC500", stu2?.confirmed_level === "SRC500");
	check("详情：两人课堂额度 0 且 result=processing", stu1?.class_unfinished_count === 0 && stu1?.result?.status === "processing" && stu2?.result?.status === "processing", JSON.stringify(detail.students));
	check("详情：available_masters 仅系列1 published（EP2/EP3，排除 EP99 草稿与 EP10 系列2）",
		detail.available_masters.length === 2 && detail.available_masters.every((m) => m.series_id === 1) && [2, 3].every((id) => detail.available_masters.some((m) => m.id === id)),
		JSON.stringify(detail.available_masters));
	check("详情：series_block_reason 为 null", detail.series_block_reason == null);

	// complete：仍有 processing 成员且未提供 skips → 409
	const completeEarly = await worker.fetch(makeRequest(`/v1/admin/push-requests/${R1}/complete`, { method: "POST", admin: true, body: {} }), env);
	check("complete：存在未处理成员且无 skips → 409", completeEarly.status === 409);

	console.log("\n== [4] Master 系列匹配 / published 校验 / 孩子级激活 ==");

	// K1 种子：EP3 final rewrite（课堂目标）；EP10（系列2）rewrite（系列错配）；EP99（draft）rewrite（未发布）
	const w1 = seedRewrite(db, 3, K1, "SRC300");
	const wSeries2 = seedRewrite(db, 10, K1, "SRC300");
	const wDraftEp = seedRewrite(db, 99, K1, "SRC300");
	const wNotFinal = seedRewrite(db, 3, K1, "SRC300", "review");
	const wOtherChild = seedRewrite(db, 3, K2, "SRC500");

	// 错误 rewrite 全拒
	const actSeries2 = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R1}/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: wSeries2 } }),
		env,
	);
	check("激活：rewrite 系列≠快照 409", actSeries2.status === 409);
	const actDraftEp = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R1}/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: wDraftEp } }),
		env,
	);
	check("激活：episode 未 published 409", actDraftEp.status === 409);
	const actNotFinal = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R1}/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: wNotFinal } }),
		env,
	);
	check("激活：rewrite 非 final 409", actNotFinal.status === 409);
	const actOtherChild = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R1}/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: wOtherChild } }),
		env,
	);
	check("激活：rewrite 属于他人 403", actOtherChild.status === 403, `status=${actOtherChild.status}`);

	// 错误孩子：K3 非本班
	const actK3 = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R1}/children/${K3}/activate`, { method: "POST", admin: true, body: { rewrite_id: w1 } }),
		env,
	);
	check("激活：非本班孩子 403", actK3.status === 403, `status=${actK3.status}`);

	// 错误申请：不存在的 request
	const actBadReq = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/99999/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: w1 } }),
		env,
	);
	check("激活：不存在申请 404", actBadReq.status === 404);

	console.log("\n== [5] 家庭/课堂 2+2 额度边界与跨渠道归档隔离 ==");

	// K1 家庭书：EP2 w_home1（active 未完成）、EP3 w_home2（active 未完成）→ 家庭满额
	const wHome1 = seedRewrite(db, 2, K1, "SRC300");
	const wHome2 = seedRewrite(db, 3, K1, "SRC300");
	seedCustomBook(db, K1, wHome1, 2);
	const homeBookEp3 = seedCustomBook(db, K1, wHome2, 3);
	const homeUnfinished = getOne<{ n: number }>(db,
		`SELECT COUNT(*) AS n FROM custom_books cb WHERE cb.child_id=? AND cb.status='active' AND cb.channel='home'
		 AND NOT EXISTS (SELECT 1 FROM reading_records rr WHERE rr.custom_book_id=cb.id AND rr.completed=1)`, [K1]);
	check("K1 家庭未完成=2（家庭满额）", homeUnfinished?.n === 2);

	// 家庭满额下课堂激活仍成功（额度隔离）
	const actOk = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R1}/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: w1 } }),
		env,
	);
	const actOkBody = (await actOk.json()) as { data?: { status?: string; custom_book_id?: number } };
	check("激活：家庭满额下课堂激活成功（额度隔离）", actOk.status === 200 && actOkBody.data?.status === "ok", `status=${actOk.status} body=${JSON.stringify(actOkBody)}`);
	const classBook = getOne<{ id: number; status: string; channel: string; pushed_at: number | null }>(db,
		"SELECT id, status, channel, pushed_at FROM custom_books WHERE child_id=? AND rewrite_id=?", [K1, w1]);
	check("课堂书 active + channel=class + 已推送", classBook?.status === "active" && classBook?.channel === "class" && classBook?.pushed_at != null, JSON.stringify(classBook));
	const homeBookEp3After = getOne<{ status: string }>(db, "SELECT status FROM custom_books WHERE id=?", [homeBookEp3]);
	check("跨渠道隔离：家庭 EP3 书仍 active（未被课堂归档）", homeBookEp3After?.status === "active");
	const resultOk = getOne<{ status: string; rewrite_id: number | null; custom_book_id: number | null }>(db,
		"SELECT status, rewrite_id, custom_book_id FROM class_push_results WHERE request_id=? AND child_id=?", [R1, K1]);
	check("result=ok 且记录 rewrite/custom_book", resultOk?.status === "ok" && resultOk?.rewrite_id === w1 && resultOk?.custom_book_id === classBook?.id, JSON.stringify(resultOk));

	// —— 额度/替换场景改用 K2：同一 (request,child) result=ok 后不再处理（一申请一孩一本），
	//    故 K1 的二次激活会被 already_done 短路，不能用于额度边界验证 ——
	// K2：种子课堂 2 本未完成（EP2 wK2a + EP3 wK2b）→ 课堂满额
	const wK2a = seedRewrite(db, 2, K2, "SRC500");
	const wK2b = seedRewrite(db, 3, K2, "SRC500");
	const k2BookA = seedCustomBook(db, K2, wK2a, 2, { channel: "class" });
	seedCustomBook(db, K2, wK2b, 3, { channel: "class" });
	// R1 对 K2 激活 EP2 新 rewrite（同集同渠道替换：归档 wK2a，净 0）→ 成功
	const wK2a2 = seedRewrite(db, 2, K2, "SRC500");
	const actReplace = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R1}/children/${K2}/activate`, { method: "POST", admin: true, body: { rewrite_id: wK2a2 } }),
		env,
	);
	check("课堂满额时同集替换成功（净 0）", actReplace.status === 200, `status=${actReplace.status}`);
	const k2BookAAfter = getOne<{ status: string }>(db, "SELECT status FROM custom_books WHERE id=?", [k2BookA]);
	const k2BookA2 = getOne<{ status: string; channel: string }>(db, "SELECT status, channel FROM custom_books WHERE child_id=? AND rewrite_id=?", [K2, wK2a2]);
	check("同渠道替换：旧版 wK2a 课堂书已归档，新版 active", k2BookAAfter?.status === "archived" && k2BookA2?.status === "active" && k2BookA2?.channel === "class", `old=${JSON.stringify(k2BookAAfter)} next=${JSON.stringify(k2BookA2)}`);
	const k2ClassCount = getOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM custom_books WHERE child_id=? AND channel='class' AND status='active'", [K2]);
	check("替换后课堂 active=2（额度内）", k2ClassCount?.n === 2);
	const k2ResultR1 = getOne<{ status: string }>(db, "SELECT status FROM class_push_results WHERE request_id=? AND child_id=?", [R1, K2]);
	check("K2 result(R1)=ok", k2ResultR1?.status === "ok");

	console.log("\n== [6] 幂等 / [7] 结果唯一性、失败重试与中断恢复 ==");

	// result=ok 后重复激活 → 幂等返回，不重复发布
	const pushedAtBefore = getOne<{ pushed_at: number | null }>(db, "SELECT pushed_at FROM custom_books WHERE child_id=? AND rewrite_id=?", [K1, w1])?.pushed_at;
	const actRepeat = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R1}/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: w1 } }),
		env,
	);
	const actRepeatBody = (await actRepeat.json()) as { data?: { status?: string; already_done?: boolean } };
	const pushedAtAfter = getOne<{ pushed_at: number | null }>(db, "SELECT pushed_at FROM custom_books WHERE child_id=? AND rewrite_id=?", [K1, w1])?.pushed_at;
	check("重复激活幂等返回且不重复推送（pushed_at 不变）", actRepeat.status === 200 && actRepeatBody.data?.status === "ok" && actRepeatBody.data?.already_done === true && pushedAtAfter === pushedAtBefore, JSON.stringify(actRepeatBody));

	// 结果唯一性：UNIQUE(request_id, child_id) 物理约束
	let dupInsertFailed = false;
	try {
		db.prepare("INSERT INTO class_push_results (request_id, child_id, status, created_at, updated_at) VALUES (?,?,'processing',1,1)").run(R1, K1);
	} catch {
		dupInsertFailed = true;
	}
	check("UNIQUE(request_id,child_id) 物理唯一约束", dupInsertFailed);
	const resultCount = getOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM class_push_results WHERE request_id=? AND child_id=?", [R1, K1]);
	check("K1 结果仍唯一（1 条）", resultCount?.n === 1);

	console.log("\n== [8] 错误输入全拒 + complete R1 + R2 创建 ==");

	// 非法 channel（通用 activate 端点）
	const badChannel = await worker.fetch(
		makeRequest(`/v1/admin/rewrite/${w1}/activate`, { method: "POST", admin: true, body: { child_id: K1, episode_id: 3, channel: "vip" } }),
		env,
	);
	check("通用 activate：非法 channel 400", badChannel.status === 400, `status=${badChannel.status}`);

	// complete R1（K1=ok、K2=ok）→ done
	const completeR1 = await worker.fetch(makeRequest(`/v1/admin/push-requests/${R1}/complete`, { method: "POST", admin: true, body: { skips: [] } }), env);
	const r1Final = getOne<{ status: string }>(db, "SELECT status FROM class_push_requests WHERE id=?", [R1]);
	check("complete：全 ok 后申请=done", completeR1.status === 200 && r1Final?.status === "done", `status=${completeR1.status} final=${r1Final?.status}`);

	// done 后新申请 R2（[2] 末班系列已改为 2 → 快照=2）
	const pushRes3 = await worker.fetch(
		makeRequest(`/v1/classes/${C1}/push-requests`, { method: "POST", cookie: t1.cookie }),
		env,
	);
	const R2 = ((await pushRes3.json()) as { request: { id: string } }).request.id;
	check("done 后新申请 201", pushRes3.status === 201 && R2 !== R1);
	const actPending = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R2}/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: w1 } }),
		env,
	);
	check("pending 申请直接孩子激活 409（需先 claim）", actPending.status === 409, `status=${actPending.status}`);

	console.log("\n== [5b] R2 课堂超额 409（额度上限不可破） ==");
	await worker.fetch(makeRequest(`/v1/admin/push-requests/${R2}/claim`, { method: "POST", admin: true }), env);
	// R2 快照=系列2；K2 课堂满 2 本（wK2a2 EP2 + wK2b EP3，系列1——额度按渠道计数与系列无关）→ 激活新集 EP11 → 409
	db.exec(`INSERT INTO book_episodes (id, series_id, series_name, episode_number, episode_title, page_count, level_tier, status)
	         VALUES (11,2,'哈利波特',2,'消失的密室',8,'SRC500','published')`);
	const wK2e = seedRewrite(db, 11, K2, "SRC500");
	const actOver = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R2}/children/${K2}/activate`, { method: "POST", admin: true, body: { rewrite_id: wK2e } }),
		env,
	);
	check("课堂满 2 本时第 3 本（新集）409 超额", actOver.status === 409, `status=${actOver.status}`);
	const k2ClassActive = getOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM custom_books WHERE child_id=? AND channel='class' AND status='active'", [K2]);
	check("超额拒绝后课堂 active 仍=2（无副作用）", k2ClassActive?.n === 2);
	const k2ResultOver = getOne<{ status: string; failure_reason: string | null }>(db,
		"SELECT status, failure_reason FROM class_push_results WHERE request_id=? AND child_id=?", [R2, K2]);
	check("K2 result(R2)=failed 且记录超额原因", k2ResultOver?.status === "failed" && !!k2ResultOver?.failure_reason, JSON.stringify(k2ResultOver));

	console.log("\n== [7] 失败重试与中断恢复（R2） ==");
	// 清一本课堂额度（归档 wK2b 的 EP3 课堂书）→ 重试成功
	db.prepare("UPDATE custom_books SET status='archived' WHERE child_id=? AND channel='class' AND rewrite_id=?").run(K2, wK2b);
	const actRetry = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R2}/children/${K2}/activate`, { method: "POST", admin: true, body: { rewrite_id: wK2e } }),
		env,
	);
	check("失败后重试成功（中断恢复）", actRetry.status === 200, `status=${actRetry.status}`);
	const k2ResultAfter = getOne<{ status: string }>(db, "SELECT status FROM class_push_results WHERE request_id=? AND child_id=?", [R2, K2]);
	check("重试后 result=ok", k2ResultAfter?.status === "ok");

	// 中断恢复点 2：activate 已成功但 pushed_at=NULL（模拟 push 前崩溃）→ 重试应跳过 activate 直接 push
	const wRecover = seedRewrite(db, 11, K1, "SRC300");
	db.prepare(
		`INSERT INTO custom_books (child_id, rewrite_id, episode_id, level_tier, status, channel, created_at, updated_at)
		 VALUES (?,?,11,'SRC300','active','class',1700000000,1700000000)`,
	).run(K1, wRecover);
	db.prepare("UPDATE class_push_results SET status='failed', failure_reason='push interrupted', rewrite_id=?, updated_at=1700000000 WHERE request_id=? AND child_id=?").run(wRecover, R2, K1);
	const pushedBefore = getOne<{ pushed_at: number | null }>(db, "SELECT pushed_at FROM custom_books WHERE child_id=? AND rewrite_id=?", [K1, wRecover])?.pushed_at;
	const actRecover = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R2}/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: wRecover } }),
		env,
	);
	const pushedAfterRecover = getOne<{ pushed_at: number | null; status: string }>(db, "SELECT pushed_at, status FROM custom_books WHERE child_id=? AND rewrite_id=?", [K1, wRecover]);
	check("activate 已完成的断点恢复：跳过重复 activate 直接 push 成功", actRecover.status === 200 && pushedBefore == null && pushedAfterRecover?.pushed_at != null && pushedAfterRecover?.status === "active", `status=${actRecover.status}`);

	console.log("\n== [8b] complete R2（全 ok → done） ==");
	const completeR2 = await worker.fetch(makeRequest(`/v1/admin/push-requests/${R2}/complete`, { method: "POST", admin: true, body: { skips: [] } }), env);
	const r2Final = getOne<{ status: string }>(db, "SELECT status FROM class_push_requests WHERE id=?", [R2]);
	check("complete R2 → done", completeR2.status === 200 && r2Final?.status === "done", `status=${completeR2.status} final=${r2Final?.status}`);

	console.log("\n== [9] 历史行为保持 ==");

	// NULL 快照历史申请（009 前遗留）：直接 SQL 造一条
	db.prepare(
		`INSERT INTO class_push_requests (id, class_id, teacher_id, status, story_series_id, created_at, updated_at)
		 VALUES ('legacy-null-req', ?, ?, 'pending', NULL, 1700000000, 1700000000)`,
	).run(C1, t1.userId ?? "t1");
	const R3 = "legacy-null-req";
	await worker.fetch(makeRequest(`/v1/admin/push-requests/${R3}/claim`, { method: "POST", admin: true }), env);
	const detailNull = await worker.fetch(makeRequest(`/v1/admin/push-requests/${R3}`, { admin: true }), env);
	const detailNullBody = (await detailNull.json()) as { available_masters: unknown[]; series_block_reason?: string | null };
	check("NULL 快照申请：available_masters 为空 + block_reason 提示", detailNullBody.available_masters.length === 0 && !!detailNullBody.series_block_reason, JSON.stringify(detailNullBody.series_block_reason));
	const actNull = await worker.fetch(
		makeRequest(`/v1/admin/push-requests/${R3}/children/${K1}/activate`, { method: "POST", admin: true, body: { rewrite_id: w1 } }),
		env,
	);
	check("NULL 快照申请：孩子激活 409 阻断（不自动回填）", actNull.status === 409, `status=${actNull.status}`);

	// 通用 activate 端点默认 home（向后兼容）：K3 全新孩子激活家庭书
	const wK3 = seedRewrite(db, 2, K3, "SRC300");
	const homeActivate = await worker.fetch(
		makeRequest(`/v1/admin/rewrite/${wK3}/activate`, { method: "POST", admin: true, body: { child_id: K3, episode_id: 2 } }),
		env,
	);
	const k3Book = getOne<{ channel: string; status: string }>(db, "SELECT channel, status FROM custom_books WHERE child_id=? AND rewrite_id=?", [K3, wK3]);
	check("通用 activate 无 channel 参数 → 默认 home", homeActivate.status === 200 && k3Book?.channel === "home", `status=${homeActivate.status}`);

	// 书架列表：channel/封面/进度扩展（GET /v1/books/custom?child_id=）
	db.prepare("INSERT INTO reading_records (child_id, custom_book_id, start_time, pages_read, total_pages, completed, created_at) VALUES (?,?,1700000000,3,8,0,1700000000)").run(K1, classBook!.id);
	const listBooks = await worker.fetch(makeRequest(`/v1/books/custom?child_id=${K1}`, { cookie: p1.cookie }), env);
	const booksBody = (await listBooks.json()) as { data?: Array<{ id: number; channel?: string; cover_image_url?: string | null; pages_read?: number | null; total_pages?: number | null; completed?: number | null; episodes?: { cover_image_url?: string | null } }> };
	const booksArr = booksBody.data ?? [];
	const classBookInList = booksArr.find((b) => b.id === classBook?.id);
	check("书架列表：课堂书带 channel=class", listBooks.status === 200 && classBookInList?.channel === "class", JSON.stringify(classBookInList));
	check("书架列表：含封面字段（cover_image_url/episodes.cover_image_url）", classBookInList != null && ("cover_image_url" in classBookInList || !!classBookInList.episodes), JSON.stringify(Object.keys(classBookInList ?? {})));
	check("书架列表：阅读进度（pages_read=3/completed=0）", classBookInList?.pages_read === 3 && classBookInList?.completed === 0, JSON.stringify({ pages_read: classBookInList?.pages_read, completed: classBookInList?.completed }));

	console.log(`\n===== 结果: ${passCount} PASS / ${failCount} FAIL =====`);
	if (failCount > 0) {
		console.log("失败用例：");
		for (const f of failures) console.log(`  - ${f}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
