/**
 * SRC-ADMIN-BUG-02 — Admin Data 只读端点本地集成测试
 *
 * 覆盖：
 *  - GET /v1/admin/results：排序 DESC、known_characters_json 解析、test_mode 映射、空库兜底
 *  - GET /v1/admin/users：全量孩子（含未测评）、parent_email 注入、敏感字段不外泄
 *  - 鉴权：未授权/错误口令 → 401
 *
 * 设施：node:sqlite 内存库 + d1-shim，直接打 Worker fetch 入口（真实路由）。
 */

import "./setup-webcrypto";
import "./setup-wasm-ext";
import { DatabaseSync } from "node:sqlite";
import { createD1Like } from "./d1-shim.js";
import worker from "../src/index.js";
import type { Env } from "../src/types.js";

// ————————————————————————————————————
// 极简测试框架
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
// Schema 与 Env（对齐 Production D1 DDL）
// ————————————————————————————————————

const DDL_PARENTS = `
CREATE TABLE parents (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER,
  roles          TEXT NOT NULL DEFAULT 'parent',
  CHECK (status IN ('active', 'suspended', 'deleted'))
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
  estimated_level     TEXT,
  confirmed_level     TEXT,
  assessment_status   TEXT NOT NULL DEFAULT 'not_started',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER,
  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE
);`;

const DDL_TEST_RESULTS = `
CREATE TABLE test_results (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL UNIQUE,
  child_id          TEXT NOT NULL,
  level             TEXT NOT NULL,
  test_type         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'completed',
  character_score   INTEGER NOT NULL,
  vocab_score       INTEGER NOT NULL,
  reading_score     INTEGER NOT NULL,
  comprehension_score INTEGER NOT NULL,
  total_score       INTEGER NOT NULL,
  stable_char_count INTEGER NOT NULL,
  stable_vocab_count INTEGER NOT NULL,
  completion_time_seconds INTEGER NOT NULL,
  total_questions   INTEGER NOT NULL,
  correct_count     INTEGER NOT NULL,
  known_characters_json TEXT,
  weak_characters_json  TEXT,
  part_breakdown_json   TEXT,
  completed_at      INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
);`;

const TEST_SERVICE_KEY = "test-service-key-admin02";
const TEST_ADMIN_PASSWORD = "test-admin-pwd-02";

function makeEnv(db: DatabaseSync): Env {
	return {
		DB: createD1Like(db) as unknown as Env["DB"],
		SRC_WORKER_SERVICE_KEY: TEST_SERVICE_KEY,
		SESSION_SECRET: "test-session-secret-admin02",
		ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
		JOIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	};
}

function createFreshDb(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec(DDL_PARENTS);
	db.exec(DDL_CHILDREN);
	db.exec(DDL_TEST_RESULTS);
	return db;
}

/** 请求助手：支持附加 header（x-admin-password 等） */
function makeRequest(
	path: string,
	init: { method?: string; headers?: Record<string, string> } = {},
): Request {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-SRC-Service-Key": TEST_SERVICE_KEY,
		...(init.headers ?? {}),
	};
	return new Request(`http://local${path}`, {
		method: init.method ?? "GET",
		headers,
	});
}

// ————————————————————————————————————
// 种子（模拟 Bailee 及之后孩子 + 测评，含未测评孩子）
// ————————————————————————————————————

function seed(db: DatabaseSync): void {
	// 家长（时间正序；users 返回按 created_at DESC → 最新家长在前）
	db.exec(
		`INSERT INTO parents (id, email, password_hash, email_verified, status, created_at, roles) VALUES
		 ('p1', 'parent.a@example.com', 'HASH-SECRET-1', 1, 'active', 100, 'parent'),
		 ('p2', 'parent.b@example.com', 'HASH-SECRET-2', 0, 'active', 110, 'parent')`,
	);
	// 孩子（时间正序：Bailee → 嘻嘻 → 饭饭 → 依依）
	db.exec(
		`INSERT INTO children (id, parent_id, nickname, age, grade, country, home_language, status, assessment_status, created_at) VALUES
		 ('c_bailee', 'p1', 'Bailee', 8, 'Grade 2', 'USA', 'bilingual', 'active', 'formal_done', 200),
		 ('c_xixi',   'p1', '嘻嘻',   7, 'Grade 1', 'Canada', 'chinese_primary', 'active', 'not_started', 210),
		 ('c_fanfan', 'p2', '饭饭',   6, 'Kindergarten', 'Australia', 'english_primary', 'active', 'not_started', 220),
		 ('c_yiyi',   'p2', '依依',   9, 'Grade 3', 'USA', 'chinese_primary', 'active', 'formal_done', 230)`,
	);
	// 测评（completed_at 倒序应返回：依依 formal → 依依 sampling → Bailee）
	db.exec(
		`INSERT INTO test_results
		 (id, session_id, child_id, level, test_type, status, character_score, vocab_score, reading_score, comprehension_score, total_score, stable_char_count, stable_vocab_count, completion_time_seconds, total_questions, correct_count, known_characters_json, weak_characters_json, part_breakdown_json, completed_at, created_at) VALUES
		 ('tr_yiyi_formal',  's_yiyi_f', 'c_yiyi',   'SRC300', 'formal',   'completed', 80, 70, 75, 72, 74, 182, 520, 420, 40, 10,  '["我","你","他","好","的","中","文","学","习"]', '["难"]', '{"char":1,"vocab":2}', 1000, 1000),
		 ('tr_yiyi_sampling','s_yiyi_s', 'c_yiyi',   'SRC100', 'sampling', 'completed', 60, 55, 58, 60, 58, 95,  272, 180, 30, 8,  '["花","开","水"]', null, null, 900, 900),
		 ('tr_bailee',       's_bailee', 'c_bailee', 'SRC100', 'formal',   'completed', 70, 68, 65, 66, 67, 66, 189, 200, 32, 9,  '["山","石","田","土"]', '["问"]', null, 800, 800)`,
	);
}

// ————————————————————————————————————
// 测试主体
// ————————————————————————————————————

async function main(): Promise<void> {
	console.log("[admin-data.test.ts] SRC-ADMIN-BUG-02 Admin Data 端点测试");

	// —— 鉴权（results）——
	{
		console.log("\n— 鉴权 —");
		const db = createFreshDb();
		seed(db);

		const noAuth = await worker.fetch(makeRequest("/v1/admin/results"), makeEnv(db));
		check("results 无口令 → 401", noAuth.status === 401);

		const wrongAuth = await worker.fetch(
			makeRequest("/v1/admin/results", { headers: { "x-admin-password": "WRONG" } }),
			makeEnv(db),
		);
		check("results 错误口令 → 401", wrongAuth.status === 401);

		const usersNoAuth = await worker.fetch(makeRequest("/v1/admin/users"), makeEnv(db));
		check("users 无口令 → 401", usersNoAuth.status === 401);

		const usersWrongAuth = await worker.fetch(
			makeRequest("/v1/admin/users", { headers: { "x-admin-password": "WRONG" } }),
			makeEnv(db),
		);
		check("users 错误口令 → 401", usersWrongAuth.status === 401);
	}

	// —— GET /v1/admin/results ——
	{
		console.log("\n— results —");
		const db = createFreshDb();
		seed(db);
		const res = await worker.fetch(
			makeRequest("/v1/admin/results", { headers: { "x-admin-password": TEST_ADMIN_PASSWORD } }),
			makeEnv(db),
		);
		const body = (await res.json()) as {
			success?: boolean;
			data?: Array<Record<string, unknown>>;
		};

		check("results 200 + success:true", res.status === 200 && body.success === true);
		check("results data 长度 3", body.data?.length === 3);

		const first = body.data?.[0];
		check("results 最新在前（依依 formal）", first?.child_id === "c_yiyi" && first?.level === "SRC300");
		check("test_mode 映射 sampling（索引1）", body.data?.[1]?.test_mode === "sampling");
		check("known_characters_json → 数组", Array.isArray(first?.known_characters) && (first?.known_characters as string[]).length === 9);
		check("known_characters 内容正确", (first?.known_characters as string[])[0] === "我");
		check("completed_at 为 ISO 字符串", typeof first?.completed_at === "string" && (first?.completed_at as string).startsWith("1970-01-01T"));
		check("part_breakdown_json 解析为对象", typeof first?.part_breakdown === "object" && first?.part_breakdown !== null);
		check("weak_characters_json 解析为数组", Array.isArray(first?.weak_characters) && (first?.weak_characters as string[])[0] === "难");
		check("结果不含敏感字段", !Object.keys(first ?? {}).some((k) => /password|token/i.test(k)));

		// 空库兜底
		const emptyRes = await worker.fetch(
			makeRequest("/v1/admin/results", { headers: { "x-admin-password": TEST_ADMIN_PASSWORD } }),
			makeEnv(createFreshDb()),
		);
		const emptyBody = (await emptyRes.json()) as { data?: unknown[] };
		check("空库 → {success:true, data:[]}", emptyRes.status === 200 && Array.isArray(emptyBody.data) && emptyBody.data.length === 0);
	}

	// —— GET /v1/admin/users ——
	{
		console.log("\n— users —");
		const db = createFreshDb();
		seed(db);
		const res = await worker.fetch(
			makeRequest("/v1/admin/users", { headers: { "x-admin-password": TEST_ADMIN_PASSWORD } }),
			makeEnv(db),
		);
		const raw = await res.text();
		const body = JSON.parse(raw) as {
			users?: Array<Record<string, unknown>>;
			all_children?: Array<Record<string, unknown>>;
		};

		check("users 200", res.status === 200);
		check("users 长度 2", body.users?.length === 2);
		check("all_children 长度 4（含未测评孩子）", body.all_children?.length === 4);

		// 未完成测评的孩子必须出现（A04 硬性要求）
		const xixi = body.all_children?.find((c) => c.nickname === "嘻嘻");
		const fanfan = body.all_children?.find((c) => c.nickname === "饭饭");
		check("未测评孩子 嘻嘻 可见", xixi !== undefined);
		check("未测评孩子 饭饭 可见", fanfan !== undefined);
		check("未测评孩子无伪造测评数据", xixi?.assessment_status === "not_started");

		// parent_email 注入
		const yiyi = body.all_children?.find((c) => c.nickname === "依依");
		check("parent_email 注入正确", yiyi?.parent_email === "parent.b@example.com");

		// 排序：最新孩子在前
		check("all_children 最新在前（依依）", body.all_children?.[0]?.nickname === "依依");

		// 敏感字段不外泄
		check("users 不含 password_hash", !raw.includes("HASH-SECRET"));
		check("users 条目不含 password_hash 键", !Object.keys(body.users?.[0] ?? {}).some((k) => /password/i.test(k)));
		check("孩子含前端所需字段", typeof yiyi?.nickname === "string" && typeof yiyi?.grade === "string" && typeof yiyi?.country === "string");

		// 契约：前端优先读 all_children；users 条目含 email
		check("users 条目含 email", typeof body.users?.[0]?.email === "string");
	}

	// —— 汇总 ——
	console.log(`\n结果：${passCount} PASS / ${failCount} FAIL`);
	if (failCount > 0) {
		console.log("失败项：");
		for (const f of failures) console.log(`  - ${f}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});