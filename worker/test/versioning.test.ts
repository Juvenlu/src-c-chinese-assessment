/**
 * P3-H-12C 绘本正式版本管理 — 本地集成测试
 *
 * 运行（在 worker/ 目录）：
 *   npx tsx test/versioning.test.ts
 *
 * 使用 node:sqlite 内存库 + 真实部分唯一索引/外键，覆盖：
 *  1. Finalize 不自动上架
 *  2. 同孩子同集不能同时两个 active（索引 + activate 归档旧版）
 *  3. 不同孩子同 episode 各有一个 active
 *  4. 切换正式版本不影响其他孩子
 *  5. 归档/恢复/软删除保留 reading_records / reading_feedback
 *  6. 非管理员无权操作（HTTP 层）
 *  7. 孩子无法访问其他孩子的绘本（归属校验，HTTP 层）
 *  8. 推送后“新”，首次打开后消失
 *  9. 重复请求/失败不产生不一致（幂等 + 事务回滚 + 非法状态拒绝）
 * 另含：迁移幂等 / 先回填再建索引 / 旧 Worker 兼容。
 *
 * 不写 Production，不发网络请求。
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
	createMemoryDb,
	SqliteDBAdapter,
	getRow,
	getRows,
} from "./sqlite-adapter.js";
import { createD1Like } from "./d1-shim.js";
import { applyVersioningMigration } from "../migrations/run_local.mjs";
import {
	activateVersion,
	archiveVersion,
	listVersions,
	markFirstViewed,
	previewDelete,
	pushVersion,
	restoreVersion,
	softDeleteVersion,
	markRewriteFinal,
} from "../src/version-store.js";
import { verifyAdminPassword } from "../src/admin-auth.js";
import {
	handleAdminActivate,
	handleAdminArchive,
	handleAdminDelete,
	handleAdminListVersions,
	handleAdminPush,
	handleAdminRestore,
} from "../src/admin-versioning.js";
import type { Env } from "../src/types.js";

// ------------------------------------------------------------
// 测试统计
// ------------------------------------------------------------
let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
	try {
		fn();
		passed++;
		console.log(`  PASS  ${name}`);
	} catch (err) {
		failed++;
		console.error(`  FAIL  ${name}`);
		console.error(`        ${(err as Error).message}`);
	}
}
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
// 种子数据
// ------------------------------------------------------------
const TED = "child-ted";
const SEAN = "child-sean";
const EP = 2;
const T0 = 1_700_000_000;

function makePages(): string {
	return JSON.stringify(
		Array.from({ length: 10 }, (_, i) => ({
			page: i + 1,
			text: `第${i + 1}页内容`,
			frontier: [],
			image_url: `https://r2/P0${i + 1}.png`,
			original_text: `原第${i + 1}页`,
		})),
	);
}

interface Seed {
	db: DatabaseSync;
	adapter: SqliteDBAdapter;
	rewriteIds: { w24: number; w25: number; w26: number; w27: number; sean27: number; draft: number };
}

function seedBase(): Seed {
	const db = createMemoryDb();
	const adapter = new SqliteDBAdapter(db);
	const pages = makePages();

	db.prepare(`INSERT INTO children(id,parent_id,nickname,status) VALUES (?,?,?,?)`)
		.run(TED, "parent-ted", "Ted", "active");
	db.prepare(`INSERT INTO children(id,parent_id,nickname,status) VALUES (?,?,?,?)`)
		.run(SEAN, "parent-sean", "Sean", "active");
	db.prepare(`INSERT INTO book_episodes(id,series_name,episode_number,episode_title,status) VALUES (?,?,?,?,?)`)
		.run(EP, "西游记", 1, "大家都叫他孙悟空", "published");

	const insertRewrite = db.prepare(
		`INSERT INTO book_rewrite_versions
		 (episode_id,child_id,target_level,pages_json,frontier_targets_json,status,version,
		  total_chars,unique_chars,max_page_chars,created_at,finalized_at,finalized_by)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	);
	const mk = (child: string, level: string, status: string, version: number, tc: number): number => {
		const r = insertRewrite.run(
			EP, child, level, pages, "[]", status, version, tc, 200, 150,
			T0, status === "final" ? T0 + 100 : null, status === "final" ? "admin" : null,
		);
		return Number(r.lastInsertRowid);
	};

	const w24 = mk(TED, "SRC500", "final", 1, 402);
	const w25 = mk(TED, "SRC300", "final", 2, 896);
	const w26 = mk(TED, "SRC300", "final", 3, 894);
	const w27 = mk(TED, "SRC300", "final", 4, 777);
	const sean27 = mk(SEAN, "SRC300", "final", 1, 777);
	const draft = mk(TED, "SRC300", "review", 5, 700);

	return { db, adapter, rewriteIds: { w24, w25, w26, w27, sean27, draft } };
}

const activeCount = (db: DatabaseSync, child: string, episode = EP): number =>
	(getRow<{ n: number }>(db,
		`SELECT count(*) AS n FROM custom_books WHERE child_id=? AND episode_id=? AND status='active'`,
		[child, episode]) as { n: number }).n;

// ------------------------------------------------------------
// HTTP 测试用 Env / Request
// ------------------------------------------------------------
const ADMIN_PWD = "admin-secret";
function makeEnv(db: DatabaseSync): Env {
	return {
		DB: createD1Like(db) as unknown as Env["DB"],
		SRC_WORKER_SERVICE_KEY: "svc",
		SESSION_SECRET: "session-secret",
		ADMIN_PASSWORD: ADMIN_PWD,
	};
}
function req(body: unknown, admin = true, method = "POST"): Request {
	return new Request("http://local/v1/admin/x", {
		method,
		headers: {
			"Content-Type": "application/json",
			...(admin ? { "x-admin-password": ADMIN_PWD } : {}),
		},
		body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
	});
}

async function activateWithRead(db: DatabaseSync, adapter: SqliteDBAdapter, rewriteId: number): Promise<number> {
	const res = await activateVersion(adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId });
	assert.equal(res.ok, true);
	const bookId = res.ok ? res.data.customBookId : 0;
	db.prepare(
		`INSERT INTO reading_records
		   (child_id,custom_book_id,start_time,end_time,duration_seconds,pages_read,total_pages,completed,created_at)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
	).run(TED, bookId, T0 + 400, T0 + 460, 60, 10, 10, 1, T0 + 400);
	db.prepare(
		`INSERT INTO reading_feedback(child_id,custom_book_id,interest,difficulty,created_at,updated_at)
		 VALUES (?,?,?,?,?,?)`,
	).run(TED, bookId, "like", "hard", T0 + 401, T0 + 401);
	return bookId;
}

async function main(): Promise<void> {
	// ============================================================
	console.log("\n[0] 迁移幂等 / 先回填再建索引 / 旧 Worker 兼容");

	test("迁移 runner 对迁移前裸表加列；重复执行跳过已存在列", () => {
		// 复刻 Production 迁移前 custom_books（无新列、无新索引）
		const bare = new DatabaseSync(":memory:");
		bare.exec(`CREATE TABLE custom_books(
		  id INTEGER PRIMARY KEY AUTOINCREMENT, child_id TEXT NOT NULL, rewrite_id INTEGER NOT NULL,
		  episode_id INTEGER NOT NULL, level_tier TEXT NOT NULL, is_free INTEGER NOT NULL DEFAULT 0,
		  status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER,
		  UNIQUE(child_id, rewrite_id))`);

		const r1 = applyVersioningMigration(bare);
		assert.deepEqual(r1.addedColumns.sort(), ["first_viewed_at", "pushed_at"]);
		assert.ok(r1.createdIndexes.includes("ux_custom_books_active"));
		const cols = (bare.prepare("PRAGMA table_info(custom_books)").all() as Array<{ name: string }>)
			.map((c) => c.name);
		assert.ok(cols.includes("pushed_at") && cols.includes("first_viewed_at"));

		const r2 = applyVersioningMigration(bare);
		assert.deepEqual(r2.addedColumns, []);
		assert.deepEqual(r2.skippedColumns.sort(), ["first_viewed_at", "pushed_at"]);

		// 在已迁移的完整 fixture 上同样幂等
		const fixture = applyVersioningMigration(createMemoryDb());
		assert.deepEqual(fixture.addedColumns, []);
		assert.deepEqual(fixture.skippedColumns.sort(), ["first_viewed_at", "pushed_at"]);
	});

	test("存在多个 active 时建唯一索引被拒绝；回填后成功", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys=OFF;");
		db.exec(`CREATE TABLE custom_books(
		  id INTEGER PRIMARY KEY AUTOINCREMENT, child_id TEXT, rewrite_id INTEGER,
		  episode_id INTEGER, level_tier TEXT, is_free INTEGER DEFAULT 0,
		  status TEXT DEFAULT 'active', created_at INTEGER, updated_at INTEGER,
		  UNIQUE(child_id, rewrite_id))`);
		const ins = db.prepare(
			"INSERT INTO custom_books(child_id,rewrite_id,episode_id,level_tier,created_at) VALUES(?,?,?,?,?)",
		);
		[24, 25, 26, 27].forEach((w) => ins.run(TED, w, EP, "SRC300", T0));
		assert.throws(() => applyVersioningMigration(db, true), /multiple active/i);
		// 回填（仅留 27 active）后成功
		db.prepare("UPDATE custom_books SET status='archived' WHERE rewrite_id IN (24,25,26)").run();
		const r = applyVersioningMigration(db, true);
		assert.ok(r.createdIndexes.includes("ux_custom_books_active"));
		assert.equal(activeCount(db, TED), 1);
	});

	test("回滚 005：DROP 唯一索引后恢复多 active，列保留、数据不丢", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys=OFF;");
		db.exec(`CREATE TABLE custom_books(
		  id INTEGER PRIMARY KEY AUTOINCREMENT, child_id TEXT NOT NULL, rewrite_id INTEGER NOT NULL,
		  episode_id INTEGER NOT NULL, level_tier TEXT NOT NULL, is_free INTEGER NOT NULL DEFAULT 0,
		  status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER,
		  UNIQUE(child_id, rewrite_id))`);
		[24, 25, 26, 27].forEach((w) =>
			db.prepare("INSERT INTO custom_books(child_id,rewrite_id,episode_id,level_tier,created_at) VALUES(?,?,?,?,?)")
				.run(TED, w, EP, "SRC300", T0));
		db.prepare("UPDATE custom_books SET status='archived' WHERE rewrite_id IN (24,25,26)").run();
		applyVersioningMigration(db, true);
		db.prepare("UPDATE custom_books SET pushed_at=? WHERE rewrite_id=27").run(T0 + 1);

		// 执行 005 回滚：仅 DROP 索引
		db.exec(`DROP INDEX IF EXISTS ux_custom_books_active;
		         DROP INDEX IF EXISTS idx_custom_books_child_episode;
		         DROP INDEX IF EXISTS idx_custom_books_status;`);
		// 回滚后允许重新出现多 active（旧行为）
		db.prepare("UPDATE custom_books SET status='active' WHERE rewrite_id IN (24,25,26)").run();
		assert.equal(activeCount(db, TED), 4);
		// 列与推送时间保留
		const kept = getRow<{ pushed_at: number | null }>(
			db, `SELECT pushed_at FROM custom_books WHERE rewrite_id=27`);
		assert.equal(kept?.pushed_at, T0 + 1);
	});

	await testAsync("FK 完整性：归档/软删除不触发 CASCADE，记录与反馈保留（外键开启）", async () => {
		const seed = seedBase();
		const bookId = await activateWithRead(seed.db, seed.adapter, seed.rewriteIds.w27);
		// 外键处于开启状态（createMemoryDb 中 PRAGMA foreign_keys=ON）
		const fk = getRow<{ foreign_keys: number }>(seed.db, `PRAGMA foreign_keys`);
		assert.equal(fk?.foreign_keys, 1);
		await softDeleteVersion(seed.adapter, T0 + 610, bookId, true);
		// 软删除只是 UPDATE status，reading_records / reading_feedback 行仍在
		assert.equal(
			getRows(seed.db, `SELECT * FROM reading_records WHERE custom_book_id=?`, [bookId]).length, 1);
		assert.equal(
			getRows(seed.db, `SELECT * FROM reading_feedback WHERE custom_book_id=?`, [bookId]).length, 1);
	});

	test("旧 Worker 兼容：不含新列的显式 INSERT 仍可写入，新列默认 NULL", () => {
		const seed = seedBase();
		// 模拟旧 Worker 的 INSERT OR IGNORE（显式列名，无 pushed_at/first_viewed_at）
		seed.db.prepare(
			`INSERT OR IGNORE INTO custom_books(child_id,rewrite_id,episode_id,level_tier,is_free,status,created_at)
			 VALUES (?,?,?,?,0,'active',?)`,
		).run(TED, seed.rewriteIds.w24, EP, T0);
		const row = getRow<{ pushed_at: number | null; first_viewed_at: number | null }>(
			seed.db,
			`SELECT pushed_at, first_viewed_at FROM custom_books WHERE rewrite_id=?`,
			[seed.rewriteIds.w24],
		);
		assert.equal(row?.pushed_at ?? null, null);
		assert.equal(row?.first_viewed_at ?? null, null);
	});

	// ============================================================
	console.log("\n[1] Finalize 不自动上架");

	await testAsync("Finalize 只置 rewrite=final，custom_books 不新增", async () => {
		const { db, adapter, rewriteIds } = seedBase();
		const before = getRows(db, `SELECT * FROM custom_books`).length;
		const res = await markRewriteFinal(adapter, T0 + 200, rewriteIds.draft, null);
		assert.equal(res.ok, true);
		assert.equal(getRows(db, `SELECT * FROM custom_books`).length, before);
		const rw = getRow<{ status: string }>(
			db, `SELECT status FROM book_rewrite_versions WHERE id=?`, [rewriteIds.draft]);
		assert.equal(rw?.status, "final");
	});

	await testAsync("重复 Finalize 幂等，且仍不创建 custom_books", async () => {
		const { db, adapter, rewriteIds } = seedBase();
		const res1 = await markRewriteFinal(adapter, T0 + 200, rewriteIds.w27, null);
		assert.equal(res1.ok, true);
		if (res1.ok) assert.equal(res1.data.alreadyFinal, true); // 种子已是 final
		const res2 = await markRewriteFinal(adapter, T0 + 201, rewriteIds.w27, null);
		assert.equal(res2.ok, true);
		if (res2.ok) assert.equal(res2.data.alreadyFinal, true);
		assert.equal(getRows(db, `SELECT * FROM custom_books`).length, 0);
	});

	// ============================================================
	console.log("\n[2] 每 child+episode 唯一 active");

	await testAsync("activate 目标版本 → 唯一 active", async () => {
		const { db, adapter, rewriteIds } = seedBase();
		const res = await activateVersion(adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: rewriteIds.w25 });
		assert.equal(res.ok, true);
		assert.equal(activeCount(db, TED), 1);
		const row = getRow<{ rewrite_id: number }>(
			db, `SELECT rewrite_id FROM custom_books WHERE child_id=? AND episode_id=? AND status='active'`, [TED, EP]);
		assert.equal(row?.rewrite_id, rewriteIds.w25);
	});

	await testAsync("再 activate 另一版本 → 旧 active 自动归档，仍唯一", async () => {
		const { db, adapter, rewriteIds } = seedBase();
		await activateVersion(adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: rewriteIds.w25 });
		await activateVersion(adapter, T0 + 301, { childId: TED, episodeId: EP, rewriteId: rewriteIds.w27 });
		assert.equal(activeCount(db, TED), 1);
		const old = getRow<{ status: string }>(db, `SELECT status FROM custom_books WHERE rewrite_id=?`, [rewriteIds.w25]);
		assert.equal(old?.status, "archived");
		const cur = getRow<{ rewrite_id: number }>(
			db, `SELECT rewrite_id FROM custom_books WHERE child_id=? AND episode_id=? AND status='active'`, [TED, EP]);
		assert.equal(cur?.rewrite_id, rewriteIds.w27);
	});

	await testAsync("不能 activate 非 final 的 rewrite", async () => {
		const { adapter, rewriteIds } = seedBase();
		const res = await activateVersion(adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: rewriteIds.draft });
		assert.equal(res.ok, false);
		if (!res.ok) assert.equal(res.status, 409);
	});

	await testAsync("不能 activate 属于别的孩子的 rewrite", async () => {
		const { adapter, rewriteIds } = seedBase();
		const res = await activateVersion(adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: rewriteIds.sean27 });
		assert.equal(res.ok, false);
		if (!res.ok) assert.equal(res.status, 403);
	});

	await testAsync("episode 不匹配被拒绝", async () => {
		const { adapter, rewriteIds } = seedBase();
		const res = await activateVersion(adapter, T0 + 300, { childId: TED, episodeId: 999, rewriteId: rewriteIds.w27 });
		assert.equal(res.ok, false);
		if (!res.ok) assert.equal(res.status, 409);
	});

	// ============================================================
	console.log("\n[3] 不同孩子同 episode 各一个 active");

	await testAsync("Ted 与 Sean 各自 activate 同集不同 rewrite，互不冲突", async () => {
		const { db, adapter, rewriteIds } = seedBase();
		const a = await activateVersion(adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: rewriteIds.w27 });
		const b = await activateVersion(adapter, T0 + 300, { childId: SEAN, episodeId: EP, rewriteId: rewriteIds.sean27 });
		assert.equal(a.ok, true);
		assert.equal(b.ok, true);
		assert.equal(activeCount(db, TED), 1);
		assert.equal(activeCount(db, SEAN), 1);
	});

	// ============================================================
	console.log("\n[4] 切换正式版本不影响其他孩子");

	await testAsync("Ted 切换 w25→w27，Sean 的 active 不变", async () => {
		const { db, adapter, rewriteIds } = seedBase();
		await activateVersion(adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: rewriteIds.w25 });
		await activateVersion(adapter, T0 + 300, { childId: SEAN, episodeId: EP, rewriteId: rewriteIds.sean27 });
		await activateVersion(adapter, T0 + 301, { childId: TED, episodeId: EP, rewriteId: rewriteIds.w27 });
		const sean = getRow<{ rewrite_id: number }>(
			db, `SELECT rewrite_id FROM custom_books WHERE child_id=? AND episode_id=? AND status='active'`, [SEAN, EP]);
		assert.equal(sean?.rewrite_id, rewriteIds.sean27);
		assert.equal(activeCount(db, SEAN), 1);
	});

	// ============================================================
	console.log("\n[5] 归档/恢复/软删除保留阅读记录与反馈");

	await testAsync("归档后阅读记录/反馈仍在", async () => {
		const seed = seedBase();
		const bookId = await activateWithRead(seed.db, seed.adapter, seed.rewriteIds.w27);
		await archiveVersion(seed.adapter, T0 + 500, bookId);
		const rc = getRow<{ n: number }>(seed.db, `SELECT count(*) AS n FROM reading_records WHERE custom_book_id=?`, [bookId]);
		const fc = getRow<{ n: number }>(seed.db, `SELECT count(*) AS n FROM reading_feedback WHERE custom_book_id=?`, [bookId]);
		assert.equal(rc?.n, 1);
		assert.equal(fc?.n, 1);
	});

	await testAsync("恢复后重新成为唯一 active（归档同组其它 active）", async () => {
		const seed = seedBase();
		const book27 = await activateWithRead(seed.db, seed.adapter, seed.rewriteIds.w27);
		await activateVersion(seed.adapter, T0 + 301, { childId: TED, episodeId: EP, rewriteId: seed.rewriteIds.w25 });
		assert.equal(activeCount(seed.db, TED), 1);
		const res = await restoreVersion(seed.adapter, T0 + 501, book27);
		assert.equal(res.ok, true);
		assert.equal(activeCount(seed.db, TED), 1);
		const cur = getRow<{ rewrite_id: number }>(
			seed.db, `SELECT rewrite_id FROM custom_books WHERE id=? AND status='active'`, [book27]);
		assert.equal(cur?.rewrite_id, seed.rewriteIds.w27);
	});

	await testAsync("软删除需 confirm；删除后记录/反馈保留", async () => {
		const seed = seedBase();
		const bookId = await activateWithRead(seed.db, seed.adapter, seed.rewriteIds.w27);
		const preview = await previewDelete(seed.adapter, bookId);
		assert.equal(preview.ok, true);
		if (preview.ok) assert.equal(preview.data.record_count, 1);
		const noConfirm = await softDeleteVersion(seed.adapter, T0 + 600, bookId, false);
		assert.equal(noConfirm.ok, false);
		if (!noConfirm.ok) assert.equal(noConfirm.status, 428);
		const del = await softDeleteVersion(seed.adapter, T0 + 601, bookId, true);
		assert.equal(del.ok, true);
		const st = getRow<{ status: string }>(seed.db, `SELECT status FROM custom_books WHERE id=?`, [bookId]);
		assert.equal(st?.status, "deleted");
		const rc = getRow<{ n: number }>(seed.db, `SELECT count(*) AS n FROM reading_records WHERE custom_book_id=?`, [bookId]);
		const fc = getRow<{ n: number }>(seed.db, `SELECT count(*) AS n FROM reading_feedback WHERE custom_book_id=?`, [bookId]);
		assert.equal(rc?.n, 1);
		assert.equal(fc?.n, 1);
	});

	await testAsync("deleted 必须先恢复才能归档", async () => {
		const seed = seedBase();
		const bookId = await activateWithRead(seed.db, seed.adapter, seed.rewriteIds.w27);
		await softDeleteVersion(seed.adapter, T0 + 600, bookId, true);
		const a = await archiveVersion(seed.adapter, T0 + 601, bookId);
		assert.equal(a.ok, false);
		if (!a.ok) assert.equal(a.status, 409);
		const r = await restoreVersion(seed.adapter, T0 + 602, bookId);
		assert.equal(r.ok, true);
		assert.equal(activeCount(seed.db, TED), 1);
	});

	// ============================================================
	console.log("\n[6] 非管理员无权操作（HTTP 层）");

	test("verifyAdminPassword 常量时间比较基本行为", () => {
		const env = makeEnv(new DatabaseSync(":memory:"));
		assert.equal(verifyAdminPassword(new Request("http://x", { headers: { "x-admin-password": ADMIN_PWD } }), env), true);
		assert.equal(verifyAdminPassword(new Request("http://x", { headers: { "x-admin-password": "nope" } }), env), false);
		assert.equal(verifyAdminPassword(new Request("http://x"), env), false);
	});

	await testAsync("缺少/错误 x-admin-password → 401", async () => {
		const seed = seedBase();
		const env = makeEnv(seed.db);
		await activateVersion(seed.adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: seed.rewriteIds.w27 });
		const body = { child_id: TED, episode_id: EP };

		const noPwd = await handleAdminActivate(req(body, false), env, String(seed.rewriteIds.w25));
		assert.equal(noPwd.status, 401);

		const wrongReq = new Request("http://local/x", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-admin-password": "wrong" },
			body: JSON.stringify(body),
		});
		const wrong = await handleAdminActivate(wrongReq, env, String(seed.rewriteIds.w25));
		assert.equal(wrong.status, 401);

		const archId = (getRow<{ id: number }>(
			seed.db, `SELECT id FROM custom_books WHERE rewrite_id=?`, [seed.rewriteIds.w27]) as { id: number }).id;
		const archNoAuth = await handleAdminArchive(req({}, false), env, String(archId));
		assert.equal(archNoAuth.status, 401);
	});

	// ============================================================
	console.log("\n[7] 孩子无法访问其他孩子绘本（归属校验）");

	await testAsync("activate 端点拒绝把他人 rewrite 挂到本孩子（403）", async () => {
		const seed = seedBase();
		const env = makeEnv(seed.db);
		const res = await handleAdminActivate(
			req({ child_id: TED, episode_id: EP }), env, String(seed.rewriteIds.sean27));
		assert.equal(res.status, 403);
	});

	await testAsync("版本列表只返回指定孩子的版本", async () => {
		const seed = seedBase();
		const env = makeEnv(seed.db);
		await activateVersion(seed.adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: seed.rewriteIds.w27 });
		await activateVersion(seed.adapter, T0 + 300, { childId: SEAN, episodeId: EP, rewriteId: seed.rewriteIds.sean27 });
		const res = await handleAdminListVersions(req({}, true, "GET"), env, TED, String(EP));
		assert.equal(res.status, 200);
		const json = (await res.json()) as { data: { versions: Array<{ rewrite_id: number }> } };
		const ids = json.data.versions.map((v) => v.rewrite_id);
		assert.ok(ids.includes(seed.rewriteIds.w27));
		assert.ok(!ids.includes(seed.rewriteIds.sean27), "不应包含 Sean 的版本");
	});

	await testAsync("不存在的 child → 404", async () => {
		const seed = seedBase();
		const env = makeEnv(seed.db);
		const res = await handleAdminListVersions(req({}, true, "GET"), env, "no-such-child", String(EP));
		assert.equal(res.status, 404);
	});

	// ============================================================
	console.log("\n[8] 推送后“新”，首次打开后消失");

	await testAsync("push → is_new=true；markFirstViewed → is_new=false", async () => {
		const seed = seedBase();
		const bookId = await activateWithRead(seed.db, seed.adapter, seed.rewriteIds.w27);
		let versions = await listVersions(seed.adapter, TED, EP);
		let v = versions.find((x) => x.custom_book_id === bookId);
		assert.equal(v?.is_new, false, "未推送时无“新”");
		const p = await pushVersion(seed.adapter, T0 + 700, bookId);
		assert.equal(p.ok, true);
		versions = await listVersions(seed.adapter, TED, EP);
		v = versions.find((x) => x.custom_book_id === bookId);
		assert.equal(v?.is_new, true, "推送后应有“新”");
		assert.equal(v?.pushed_at, T0 + 700);
		await markFirstViewed(seed.adapter, T0 + 701, bookId);
		versions = await listVersions(seed.adapter, TED, EP);
		v = versions.find((x) => x.custom_book_id === bookId);
		assert.equal(v?.is_new, false, "首次查看后“新”消失");
		assert.equal(v?.first_viewed_at, T0 + 701);
	});

	await testAsync("重复推送：重置 first_viewed_at（再次出现“新”）", async () => {
		const seed = seedBase();
		const bookId = await activateWithRead(seed.db, seed.adapter, seed.rewriteIds.w27);
		await pushVersion(seed.adapter, T0 + 700, bookId);
		await markFirstViewed(seed.adapter, T0 + 701, bookId);
		await pushVersion(seed.adapter, T0 + 702, bookId);
		const row = getRow<{ pushed_at: number; first_viewed_at: number | null }>(
			seed.db, `SELECT pushed_at, first_viewed_at FROM custom_books WHERE id=?`, [bookId]);
		assert.equal(row?.pushed_at, T0 + 702);
		assert.equal(row?.first_viewed_at ?? null, null);
	});

	await testAsync("非 active 版本不可推送（HTTP 409）", async () => {
		const seed = seedBase();
		const bookId = await activateWithRead(seed.db, seed.adapter, seed.rewriteIds.w27);
		await archiveVersion(seed.adapter, T0 + 710, bookId);
		const env = makeEnv(seed.db);
		const res = await handleAdminPush(req({}), env, String(bookId));
		assert.equal(res.status, 409);
	});

	// ============================================================
	console.log("\n[9] 重复请求/异常/事务不产生不一致");

	await testAsync("activate 幂等：重复 activate 同版本仍唯一 active、单行", async () => {
		const { db, adapter, rewriteIds } = seedBase();
		await activateVersion(adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: rewriteIds.w27 });
		await activateVersion(adapter, T0 + 301, { childId: TED, episodeId: EP, rewriteId: rewriteIds.w27 });
		assert.equal(activeCount(db, TED), 1);
		assert.equal(
			getRows(db, `SELECT id FROM custom_books WHERE rewrite_id=?`, [rewriteIds.w27]).length,
			1,
			"UNIQUE(child,rewrite) 防止重复行",
		);
	});

	await testAsync("archive/restore 幂等", async () => {
		const seed = seedBase();
		const bookId = await activateWithRead(seed.db, seed.adapter, seed.rewriteIds.w27);
		await archiveVersion(seed.adapter, T0 + 800, bookId);
		const a2 = await archiveVersion(seed.adapter, T0 + 801, bookId);
		assert.equal(a2.ok, true);
		await restoreVersion(seed.adapter, T0 + 802, bookId);
		const r2 = await restoreVersion(seed.adapter, T0 + 803, bookId);
		assert.equal(r2.ok, true);
		assert.equal(activeCount(seed.db, TED), 1);
	});

	await testAsync("不存在的 id 返回失败且无写入", async () => {
		const { db, adapter } = seedBase();
		const a = await archiveVersion(adapter, T0 + 900, 99999);
		const d = await softDeleteVersion(adapter, T0 + 900, 99999, true);
		const p = await pushVersion(adapter, T0 + 900, 99999);
		assert.equal(a.ok && d.ok && p.ok, false);
		assert.equal(getRows(db, `SELECT * FROM custom_books`).length, 0);
	});

	await testAsync("HTTP 参数非法返回 400，不写库", async () => {
		const seed = seedBase();
		const env = makeEnv(seed.db);
		const arch = await handleAdminArchive(req({}), env, "abc");
		assert.equal(arch.status, 400);
		const restore = await handleAdminRestore(req({}), env, "0");
		assert.equal(restore.status, 400);
		const delBad = await handleAdminDelete(req({ confirm: true }), env, "-3");
		assert.equal(delBad.status, 400);
		const pushBad = await handleAdminPush(req({}), env, "x");
		assert.equal(pushBad.status, 400);
		assert.equal(getRows(seed.db, `SELECT * FROM custom_books`).length, 0);
	});

	await testAsync("批次中途失败整体回滚（事务原子性）", async () => {
		// 先 activate w27，再尝试 activate 一个非 final 版本：服务层在读校验即拒绝（不写）。
		// 另验证 DB 适配器层面：让第二个语句触发唯一约束，整批应回滚。
		const seed = seedBase();
		await activateVersion(seed.adapter, T0 + 300, { childId: TED, episodeId: EP, rewriteId: seed.rewriteIds.w27 });
		// 直接用 adapter 构造一个必然失败的批次（重复 (child,rewrite) 唯一键冲突）
		await assert.rejects(
			seed.adapter.execBatch([
				{ sql: `UPDATE custom_books SET status='archived' WHERE id=-1`, params: [] },
				{
					sql: `INSERT INTO custom_books(child_id,rewrite_id,episode_id,level_tier,status,created_at)
					      VALUES (?,?,?,?,?,?)`,
					params: [TED, seed.rewriteIds.w27, EP, "SRC300", "archived", T0 + 999],
				},
			]),
		);
		// 回滚后 active 仍是 w27，且无第二条
		assert.equal(activeCount(seed.db, TED), 1);
		assert.equal(
			getRows(seed.db, `SELECT id FROM custom_books WHERE rewrite_id=?`, [seed.rewriteIds.w27]).length,
			1,
		);
	});

	// ============================================================
	console.log("\n[汇总]");
	console.log(`PASS=${passed}  FAIL=${failed}`);
	if (failed > 0) process.exitCode = 1;
}

void main();
