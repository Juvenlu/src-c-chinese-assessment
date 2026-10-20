/**
 * P3-H-12F-4E 两阶段末页完成协议 — 本地集成测试
 *
 * 运行（在 worker/ 目录）：
 *   npx tsx test/reading-completion.test.ts
 *
 * 使用 node:sqlite 内存库 + D1 shim + 真实 HMAC Session，覆盖：
 *  1. 非末页 completed=true 拒绝（400 completion_requires_last_page，零写入）
 *  2. 同请求夹带 pages_read=总页数 + completed=true 不构成完成依据（无副作用）
 *  3. 两阶段：末页进度先持久化 → 完成事件后持久化（completed=1、end_time 写入）
 *  4. 重复完成请求幂等，首次完成时间不变
 *  5. 重读进度允许更新，completed 不可逆、end_time 不变
 *  6. completed=false 被忽略（不允许撤销完成）
 *  7. duration 随完成事件一并更新
 *  8. 历史完成记录（completed=1 但 pages_read<total）保留完成资格，不修改历史数据
 *
 * 注意：协议验证的是服务端持久化进度，不能证明真实阅读行为（代码注释同此声明）。
 * 不写 Production，不发网络请求。
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createMemoryDb, getRow } from "./sqlite-adapter.js";
import { createD1Like } from "./d1-shim.js";
import { handleReadingRecords } from "../src/reading-records.js";
import { signSession, createSessionCookie, SESSION_COOKIE_NAME } from "../src/session.js";
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
// 常量与种子
// ------------------------------------------------------------
const TED = "child-ted";
const PARENT = "parent-ted";
const EP = 2;
const T0 = 1_700_000_000;
const TOTAL_PAGES = 10;

function makePages(): string {
	return JSON.stringify(
		Array.from({ length: TOTAL_PAGES }, (_, i) => ({
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
	env: Env;
	cookie: string;
	bookId: number;
}

async function seed(): Promise<Seed> {
	const db = createMemoryDb();
	db.prepare(`INSERT INTO children(id,parent_id,nickname,status) VALUES (?,?,?,?)`)
		.run(TED, PARENT, "Ted", "active");
	db.prepare(`INSERT INTO book_episodes(id,series_name,episode_number,episode_title,status) VALUES (?,?,?,?,?)`)
		.run(EP, "西游记", 1, "大家都叫他孙悟空", "published");
	const rw = db.prepare(
		`INSERT INTO book_rewrite_versions
		 (episode_id,child_id,target_level,pages_json,frontier_targets_json,status,version,
		  total_chars,unique_chars,max_page_chars,created_at,finalized_at,finalized_by)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	).run(EP, TED, "SRC300", makePages(), "[]", "final", 1, 700, 200, 150, T0, T0 + 100, "admin");
	const rewriteId = Number(rw.lastInsertRowid);
	const bk = db.prepare(
		`INSERT INTO custom_books(child_id,rewrite_id,episode_id,level_tier,is_free,status,created_at,updated_at)
		 VALUES (?,?,?,?,0,'active',?,?)`,
	).run(TED, rewriteId, EP, "SRC300", T0, T0);
	const bookId = Number(bk.lastInsertRowid);

	const env: Env = {
		DB: createD1Like(db) as unknown as Env["DB"],
		SRC_WORKER_SERVICE_KEY: "svc",
		SESSION_SECRET: "session-secret",
		ADMIN_PASSWORD: "admin-secret",
	};
	const token = await signSession({ parent_id: PARENT }, env.SESSION_SECRET);
	const cookie = createSessionCookie(token);
	assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
	return { db, env, cookie, bookId };
}

function patchReq(bookId: number, body: unknown, cookie: string): Request {
	return new Request(`http://local/v1/reading-records/${bookId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: JSON.stringify(body),
	});
}

function postCreateReq(body: unknown, cookie: string): Request {
	return new Request("http://local/v1/reading-records", {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: JSON.stringify(body),
	});
}

interface RecRow {
	pages_read: number;
	total_pages: number;
	completed: number;
	end_time: number | null;
	duration_seconds: number;
}

const getRec = (db: DatabaseSync, bookId: number): RecRow =>
	getRow<RecRow>(db,
		`SELECT pages_read,total_pages,completed,end_time,duration_seconds
		   FROM reading_records WHERE child_id=? AND custom_book_id=?`,
		[TED, bookId]) as RecRow;

async function createRecord(s: Seed): Promise<void> {
	const res = await handleReadingRecords(
		postCreateReq({ child_id: TED, custom_book_id: s.bookId }, s.cookie), s.env);
	assert.equal(res.status, 201);
}

// ------------------------------------------------------------
async function main(): Promise<void> {
	console.log("\n[两阶段末页完成协议]");

	await testAsync("非末页 completed=true → 400 completion_requires_last_page，零写入", async () => {
		const s = await seed();
		await createRecord(s); // pages_read=1
		const res = await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, completed: true }, s.cookie), s.env);
		assert.equal(res.status, 400);
		const body = await res.json() as { success: boolean; error: string; pages_read: number; total_pages: number };
		assert.equal(body.success, false);
		assert.equal(body.error, "completion_requires_last_page");
		assert.equal(body.pages_read, 1);
		assert.equal(body.total_pages, TOTAL_PAGES);
		// 零写入
		const rec = getRec(s.db, s.bookId);
		assert.equal(rec.pages_read, 1);
		assert.equal(rec.completed, 0);
		assert.equal(rec.end_time, null);
	});

	await testAsync("同请求夹带 pages_read=总页数 + completed=true → 400，pages_read 不落库（无副作用）", async () => {
		const s = await seed();
		await createRecord(s); // pages_read=1
		const res = await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, pages_read: TOTAL_PAGES, completed: true }, s.cookie), s.env);
		assert.equal(res.status, 400);
		const body = await res.json() as { error: string };
		assert.equal(body.error, "completion_requires_last_page");
		// 整体无副作用：同请求的 pages_read 也一并拒绝
		const rec = getRec(s.db, s.bookId);
		assert.equal(rec.pages_read, 1);
		assert.equal(rec.completed, 0);
		assert.equal(rec.end_time, null);
	});

	await testAsync("两阶段：末页进度先持久化 → 完成事件后持久化（completed=1、end_time 写入）", async () => {
		const s = await seed();
		await createRecord(s);
		// 阶段一：进度
		const p = await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, pages_read: TOTAL_PAGES, duration_seconds: 90 }, s.cookie), s.env);
		assert.equal(p.status, 200);
		assert.equal(getRec(s.db, s.bookId).pages_read, TOTAL_PAGES);
		// 阶段二：完成（不夹带 pages_read）
		const c = await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, duration_seconds: 95, completed: true }, s.cookie), s.env);
		assert.equal(c.status, 200);
		const body = await c.json() as { success: boolean };
		assert.equal(body.success, true);
		const rec = getRec(s.db, s.bookId);
		assert.equal(rec.completed, 1);
		assert.ok(rec.end_time !== null && rec.end_time > 0);
		assert.equal(rec.pages_read, TOTAL_PAGES);
		assert.equal(rec.duration_seconds, 95);
	});

	await testAsync("重复完成请求幂等：200，end_time 保持首次完成时间", async () => {
		const s = await seed();
		await createRecord(s);
		await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, pages_read: TOTAL_PAGES }, s.cookie), s.env);
		const c1 = await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, completed: true }, s.cookie), s.env);
		assert.equal(c1.status, 200);
		const firstEnd = getRec(s.db, s.bookId).end_time;
		assert.ok(firstEnd !== null);

		const c2 = await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, completed: true }, s.cookie), s.env);
		assert.equal(c2.status, 200);
		const rec = getRec(s.db, s.bookId);
		assert.equal(rec.completed, 1);
		assert.equal(rec.end_time, firstEnd);
	});

	await testAsync("重读：pages_read 可回退更新，completed 不可逆、end_time 不变", async () => {
		const s = await seed();
		await createRecord(s);
		await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, pages_read: TOTAL_PAGES }, s.cookie), s.env);
		await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, completed: true }, s.cookie), s.env);
		const firstEnd = getRec(s.db, s.bookId).end_time;

		const r = await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, pages_read: 4, duration_seconds: 200 }, s.cookie), s.env);
		assert.equal(r.status, 200);
		const rec = getRec(s.db, s.bookId);
		assert.equal(rec.pages_read, 4);
		assert.equal(rec.completed, 1);
		assert.equal(rec.end_time, firstEnd);
		assert.equal(rec.duration_seconds, 200);
	});

	await testAsync("completed=false 被忽略：不允许撤销完成，也不触发完成", async () => {
		const s = await seed();
		await createRecord(s);
		const res = await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, completed: false }, s.cookie), s.env);
		assert.equal(res.status, 200);
		const rec = getRec(s.db, s.bookId);
		assert.equal(rec.completed, 0);
		assert.equal(rec.end_time, null);
	});

	await testAsync("历史完成记录（completed=1 但 pages_read<total）保留资格：重复完成幂等，不修改历史数据", async () => {
		const s = await seed();
		// 直接种子一条历史宽松完成记录（如 Ted 历史：completed=1, pages_read=7/10）
		s.db.prepare(
			`INSERT INTO reading_records(child_id,custom_book_id,start_time,end_time,duration_seconds,pages_read,total_pages,completed,created_at)
			 VALUES (?,?,?,?,?,?,?,?,?)`,
		).run(TED, s.bookId, T0, T0 + 300, 300, 7, TOTAL_PAGES, 1, T0);

		const res = await handleReadingRecords(
			patchReq(s.bookId, { child_id: TED, completed: true }, s.cookie), s.env);
		assert.equal(res.status, 200); // 幂等放行
		const rec = getRec(s.db, s.bookId);
		assert.equal(rec.completed, 1);
		assert.equal(rec.pages_read, 7);            // 历史数据不被改写
		assert.equal(rec.end_time, T0 + 300);        // 首次完成时间保留
	});

	// ============================================================
	console.log("\n[汇总]");
	console.log(`PASS=${passed}  FAIL=${failed}`);
	if (failed > 0) process.exitCode = 1;
}

void main();
