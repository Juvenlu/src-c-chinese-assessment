/**
 * P3-SRC-MULTIBOOK-57N-4 generated 端点硬校验 — 本地集成测试
 *
 * 运行（在 worker/ 目录）：
 *   npx tsx test/generated-validation.test.ts
 *
 * 使用 node:sqlite 内存库 + d1-shim，覆盖：
 *  A. 四级正式字数区间边界（min-1/min/max/max+1）
 *  B. validation_result 拒绝场景（缺失/类型错误/overall_pass=false/阅读量项缺失、重复、failed）
 *  C. 放行场景（合格字数 + 仅语言难度启发式 failed → 201 review，原始 validation 保留）
 *  D. 回归（幂等 409 / Master Asset Lock 回填 / 页数页序 422 / 版本号 MAX+1 / 统计字段口径 / source 强制覆盖）
 *
 * 不写 Production，不发网络请求。
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createMemoryDb } from "./sqlite-adapter.js";
import { createD1Like } from "./d1-shim.js";
import { handleV1AdminGeneratedDraft } from "../src/admin-book-writer.js";
import type { Env } from "../src/types.js";

// ------------------------------------------------------------
// 测试统计
// ------------------------------------------------------------
let passed = 0;
let failed = 0;
async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
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

// ------------------------------------------------------------
// 环境 / 种子
// ------------------------------------------------------------
const ADMIN_PWD = "admin-secret";
const EP = 3;
const MASTER_PAGE_COUNT = 8;

function makeEnv(db: DatabaseSync): Env {
	return {
		DB: createD1Like(db) as unknown as Env["DB"],
		SRC_WORKER_SERVICE_KEY: "svc",
		SESSION_SECRET: "session-secret",
		ADMIN_PASSWORD: ADMIN_PWD,
	};
}

function makeRequest(body: unknown): Request {
	return new Request("http://local/v1/admin/rewrite/generated", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-admin-password": ADMIN_PWD },
		body: JSON.stringify(body ?? {}),
	});
}

function seedDb(): DatabaseSync {
	const db = createMemoryDb();
	// book_episode_pages 不在共享 fixture 中，测试内补建（与 Production 列结构对齐：本端点仅读 page_number/original_text/image_url）
	db.exec(`CREATE TABLE IF NOT EXISTS book_episode_pages (
	  id INTEGER PRIMARY KEY AUTOINCREMENT,
	  episode_id INTEGER NOT NULL,
	  page_number INTEGER NOT NULL,
	  image_url TEXT,
	  original_text TEXT
	)`);
	db.prepare(`INSERT INTO children(id,parent_id,nickname,status) VALUES (?,?,?,?)`)
		.run("child-a", "parent-a", "A", "active");
	db.prepare(`INSERT INTO children(id,parent_id,nickname,status) VALUES (?,?,?,?)`)
		.run("child-b", "parent-b", "B", "active");
	db.prepare(`INSERT INTO book_episodes(id,series_name,episode_number,episode_title,status) VALUES (?,?,?,?,?)`)
		.run(EP, "西游记", 2, "翻个跟头上京城", "published");
	for (let i = 1; i <= MASTER_PAGE_COUNT; i++) {
		db.prepare(`INSERT INTO book_episode_pages(episode_id,page_number,image_url,original_text) VALUES (?,?,?,?)`)
			.run(EP, i, `https://r2/master-p${i}.png`, `Master原文第${i}页`);
	}
	return db;
}

// ------------------------------------------------------------
// 请求体构造
// ------------------------------------------------------------
/** 生成全书 total 个汉字、pageCount 页的 pages（纯汉字，无标点） */
function pagesWithTotalHanzi(total: number, pageCount = MASTER_PAGE_COUNT): { page: number; text: string }[] {
	const base = Math.floor(total / pageCount);
	const rem = total % pageCount;
	return Array.from({ length: pageCount }, (_, i) => ({
		page: i + 1,
		text: "汉".repeat(base + (i < rem ? 1 : 0)),
	}));
}

interface VrItem { name: string; passed: boolean; detail?: string; score?: number }

function makeValidation(overrides: {
	overallPass?: unknown;
	volumePassed?: unknown;
	extraItems?: VrItem[];
	omitVolume?: boolean;
} = {}): Record<string, unknown> {
	const items: VrItem[] = [];
	if (!overrides.omitVolume) {
		items.push({ name: "阅读量", passed: (overrides.volumePassed ?? true) as boolean, detail: "ok", score: 800 });
	}
	items.push({ name: "语言难度（启发式）", passed: true, detail: "ok", score: 95 });
	items.push({ name: "Frontier 存在性", passed: true, detail: "ok" });
	items.push({ name: "Master Story 保持", passed: true, detail: "ok" });
	items.push({ name: "图文一致性（启发式）", passed: true, detail: "ok" });
	if (overrides.extraItems) items.push(...overrides.extraItems);
	return { overall_pass: overrides.overallPass ?? true, items };
}

function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		episode_id: EP,
		child_id: "child-a",
		target_level: "SRC800",
		pages: pagesWithTotalHanzi(850),
		frontier_targets: ["武器", "京城"],
		validation_result: makeValidation(),
		...overrides,
	};
}

// ------------------------------------------------------------
// 主流程
// ------------------------------------------------------------
async function main(): Promise<void> {
	// ============================================================
	console.log("\n[A] 四级正式字数区间边界（57N-4 新标准）");

	const levels: { level: string; min: number; max: number }[] = [
		{ level: "SRC100", min: 100, max: 150 },
		{ level: "SRC300", min: 300, max: 380 },
		{ level: "SRC500", min: 500, max: 600 },
		{ level: "SRC800", min: 800, max: 900 },
	];

	for (const { level, min, max } of levels) {
		await testAsync(`${level}: ${min - 1} 汉字（下限外）→ 422 零写入`, async () => {
			const db = seedDb();
			const res = await handleV1AdminGeneratedDraft(
				makeRequest(makeBody({ target_level: level, pages: pagesWithTotalHanzi(min - 1) })), makeEnv(db));
			assert.equal(res.status, 422);
			const json = (await res.json()) as Record<string, unknown>;
			assert.match(String(json.error), /out of range/);
			assert.equal(json.total_hanzi, min - 1);
			const n = db.prepare(`SELECT count(*) AS n FROM book_rewrite_versions`).get() as { n: number };
			assert.equal(n.n, 0, "必须零写入");
		});

		await testAsync(`${level}: ${min} 汉字（下限）→ 201`, async () => {
			const db = seedDb();
			const res = await handleV1AdminGeneratedDraft(
				makeRequest(makeBody({ target_level: level, pages: pagesWithTotalHanzi(min) })), makeEnv(db));
			assert.equal(res.status, 201);
		});

		await testAsync(`${level}: ${max} 汉字（上限）→ 201`, async () => {
			const db = seedDb();
			const res = await handleV1AdminGeneratedDraft(
				makeRequest(makeBody({ child_id: "child-b", target_level: level, pages: pagesWithTotalHanzi(max) })), makeEnv(db));
			assert.equal(res.status, 201);
		});

		await testAsync(`${level}: ${max + 1} 汉字（上限外）→ 422 零写入`, async () => {
			const db = seedDb();
			const res = await handleV1AdminGeneratedDraft(
				makeRequest(makeBody({ target_level: level, pages: pagesWithTotalHanzi(max + 1) })), makeEnv(db));
			assert.equal(res.status, 422);
			const n = db.prepare(`SELECT count(*) AS n FROM book_rewrite_versions`).get() as { n: number };
			assert.equal(n.n, 0, "必须零写入");
		});
	}

	// ============================================================
	console.log("\n[B] validation_result 拒绝场景");

	await testAsync("validation_result 缺失 → 422", async () => {
		const db = seedDb();
		const body = makeBody();
		delete body.validation_result;
		const res = await handleV1AdminGeneratedDraft(makeRequest(body), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("validation_result 为数组 → 422", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ validation_result: [1, 2] })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("overall_pass=false → 422", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ validation_result: makeValidation({ overallPass: false }) })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("overall_pass 为字符串 'true'（类型错误）→ 422", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ validation_result: makeValidation({ overallPass: "true" }) })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("overall_pass 缺失 → 422", async () => {
		const db = seedDb();
		const vr = makeValidation();
		delete vr.overall_pass;
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ validation_result: vr })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("items 缺失 → 422", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ validation_result: { overall_pass: true } })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("阅读量项缺失（不因名称变化静默放行）→ 422", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ validation_result: makeValidation({ omitVolume: true }) })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("阅读量项重复 → 422", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({
				validation_result: makeValidation({ extraItems: [{ name: "阅读量", passed: true }] }),
			})), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("阅读量项 passed=false → 422", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ validation_result: makeValidation({ volumePassed: false }) })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("阅读量项 passed 为字符串（类型错误）→ 422", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ validation_result: makeValidation({ volumePassed: "yes" }) })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	// ============================================================
	console.log("\n[C] 放行场景：合格字数 + 仅语言难度启发式 failed");

	await testAsync("语言难度 passed=false、其余全过 → 201 review，原始 validation 原样保留", async () => {
		const db = seedDb();
		const vr = makeValidation();
		(vr.items as VrItem[])[1].passed = false; // 语言难度 failed
		(vr.items as VrItem[])[1].detail = "生僻字偏多（启发式）";
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ validation_result: vr })), makeEnv(db));
		assert.equal(res.status, 201);
		const row = db.prepare(`SELECT status, validation_result_json FROM book_rewrite_versions`).get() as
			{ status: string; validation_result_json: string };
		assert.equal(row.status, "review");
		const stored = JSON.parse(row.validation_result_json) as { overall_pass: boolean; items: VrItem[] };
		assert.equal(stored.overall_pass, true);
		const lang = stored.items.find((i) => i.name === "语言难度（启发式）");
		assert.equal(lang?.passed, false, "原始 failed 必须保留，不得篡改");
		assert.equal(lang?.detail, "生僻字偏多（启发式）");
	});

	// ============================================================
	console.log("\n[D] 回归：幂等 / Master Asset Lock / 页结构 / 版本号 / 统计口径 / source 覆盖");

	await testAsync("幂等：同三元组已有 review → 409，不产生重复", async () => {
		const db = seedDb();
		const env = makeEnv(db);
		const res1 = await handleV1AdminGeneratedDraft(makeRequest(makeBody()), env);
		assert.equal(res1.status, 201);
		const res2 = await handleV1AdminGeneratedDraft(makeRequest(makeBody()), env);
		assert.equal(res2.status, 409);
		const n = db.prepare(`SELECT count(*) AS n FROM book_rewrite_versions`).get() as { n: number };
		assert.equal(n.n, 1);
	});

	await testAsync("Master Asset Lock：请求体伪造 image_url/original_text，服务端以 Master 回填", async () => {
		const db = seedDb();
		const fakePages = pagesWithTotalHanzi(850).map((p) => ({
			...p, image_url: "https://evil/fake.png", original_text: "伪造原文",
		}));
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ pages: fakePages })), makeEnv(db));
		assert.equal(res.status, 201);
		const row = db.prepare(`SELECT pages_json FROM book_rewrite_versions`).get() as { pages_json: string };
		const pages = JSON.parse(row.pages_json) as { page: number; image_url: string; original_text: string }[];
		assert.equal(pages.length, MASTER_PAGE_COUNT);
		for (const p of pages) {
			assert.equal(p.image_url, `https://r2/master-p${p.page}.png`);
			assert.equal(p.original_text, `Master原文第${p.page}页`);
		}
	});

	await testAsync("页数与 Master 不符 → 422", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ pages: pagesWithTotalHanzi(850, 7) })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("页序错乱 → 422", async () => {
		const db = seedDb();
		const pages = pagesWithTotalHanzi(850);
		pages[3].page = 99;
		const res = await handleV1AdminGeneratedDraft(makeRequest(makeBody({ pages })), makeEnv(db));
		assert.equal(res.status, 422);
	});

	await testAsync("版本号 = episode 维度 MAX+1", async () => {
		const db = seedDb();
		// 预置同 episode 的 v1（另一孩子，避免幂等冲突）
		db.prepare(`INSERT INTO book_rewrite_versions
		  (episode_id,child_id,target_level,pages_json,status,version,created_at)
		  VALUES (?,?,?,?,?,?,?)`).run(EP, "child-b", "SRC800", "[]", "final", 1, 1700000000);
		const res = await handleV1AdminGeneratedDraft(makeRequest(makeBody()), makeEnv(db));
		assert.equal(res.status, 201);
		const row = db.prepare(`SELECT version FROM book_rewrite_versions WHERE child_id='child-a'`).get() as { version: number };
		assert.equal(row.version, 2);
	});

	await testAsync("统计字段口径：total_chars 含标点全字符 / unique_chars 唯一汉字 / max_page_chars", async () => {
		const db = seedDb();
		// 每页 106 个汉字（848 总数，区间内）+ 句读标点
		const pages = pagesWithTotalHanzi(848).map((p) => ({ ...p, text: p.text + "。！" }));
		const res = await handleV1AdminGeneratedDraft(makeRequest(makeBody({ pages })), makeEnv(db));
		assert.equal(res.status, 201);
		const row = db.prepare(`SELECT total_chars, unique_chars, max_page_chars FROM book_rewrite_versions`).get() as
			{ total_chars: number; unique_chars: number; max_page_chars: number };
		assert.equal(row.total_chars, 848 + 8 * 2, "total_chars 为 Array.from 全字符（含标点）");
		assert.equal(row.unique_chars, 1, "unique_chars 为唯一汉字（本例仅 '汉'）");
		assert.equal(row.max_page_chars, 108);
	});

	await testAsync("generation_params.source/tool 服务端强制覆盖，防伪造来源", async () => {
		const db = seedDb();
		const res = await handleV1AdminGeneratedDraft(
			makeRequest(makeBody({ generation_params: { source: "human", tool: "fake-tool", note: "x" } })), makeEnv(db));
		assert.equal(res.status, 201);
		const row = db.prepare(`SELECT generation_params_json FROM book_rewrite_versions`).get() as
			{ generation_params_json: string };
		const gp = JSON.parse(row.generation_params_json) as Record<string, unknown>;
		assert.equal(gp.source, "ai");
		assert.equal(gp.tool, "book-writer-ai");
		assert.equal(gp.note, "x", "客户端其他字段保留");
	});

	await testAsync("非管理员 → 401", async () => {
		const db = seedDb();
		const badReq = new Request("http://local/v1/admin/rewrite/generated", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-admin-password": "wrong" },
			body: JSON.stringify(makeBody()),
		});
		const res = await handleV1AdminGeneratedDraft(badReq, makeEnv(db));
		assert.equal(res.status, 401);
	});

	// ============================================================
	console.log(`\n========================================`);
	console.log(`结果: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
}

main().catch((err) => {
	console.error("测试运行异常:", err);
	process.exit(1);
});
