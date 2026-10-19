/**
 * D1 → DBAdapter 实现
 *
 * 将 version-store 的纯逻辑接口适配到 Cloudflare D1。
 * - get/all 使用 D1 prepared statement，位置占位符 ?
 * - execBatch 使用 D1 batch() 原子提交（失败整体回滚）
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { BatchStatement, DBAdapter, Row } from "./version-store";

class D1DBAdapter implements DBAdapter {
	constructor(private readonly db: D1Database) {}

	async get<T = Row>(sql: string, params: unknown[]): Promise<T | undefined> {
		const row = await this.db.prepare(sql).bind(...params).first<T>();
		// D1 的 first() 类型为 T | null，统一收敛为适配器契约的 undefined
		return row ?? undefined;
	}

	async all<T = Row>(sql: string, params: unknown[]): Promise<T[]> {
		const res = await this.db.prepare(sql).bind(...params).all<T>();
		return res.results ?? [];
	}

	async execBatch(statements: BatchStatement[]): Promise<void> {
		const prepared = statements.map((s) =>
			this.db.prepare(s.sql).bind(...s.params),
		);
		await this.db.batch(prepared);
	}
}

export function createD1DBAdapter(db: D1Database): DBAdapter {
	return new D1DBAdapter(db);
}
