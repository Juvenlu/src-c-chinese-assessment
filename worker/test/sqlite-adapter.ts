/**
 * node:sqlite → version-store DBAdapter（仅用于本地测试）
 *
 * execBatch 用 BEGIN/COMMIT 包裹，任一条失败即 ROLLBACK（与 D1 batch 原子语义对齐）。
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { BatchStatement, DBAdapter, Row } from "../src/version-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createMemoryDb(schemaFile = join(__dirname, "fixtures", "schema.sql")): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec(readFileSync(schemaFile, "utf8"));
	return db;
}

export class SqliteDBAdapter implements DBAdapter {
	constructor(private readonly db: DatabaseSync) {}

	async get<T = Row>(sql: string, params: unknown[]): Promise<T | undefined> {
		return this.db.prepare(sql).get(...params) as T | undefined;
	}

	async all<T = Row>(sql: string, params: unknown[]): Promise<T[]> {
		return this.db.prepare(sql).all(...params) as T[];
	}

	async execBatch(statements: BatchStatement[]): Promise<void> {
		this.db.exec("BEGIN");
		try {
			for (const s of statements) {
				this.db.prepare(s.sql).run(...s.params);
			}
			this.db.exec("COMMIT");
		} catch (err) {
			this.db.exec("ROLLBACK");
			throw err;
		}
	}
}

/** 直接同步执行 SQL（测试种子数据用，不走 adapter） */
export function runSql(db: DatabaseSync, sql: string, params: unknown[] = []): unknown {
	return db.prepare(sql).run(...params);
}

export function getRow<T = Row>(db: DatabaseSync, sql: string, params: unknown[] = []): T | undefined {
	return db.prepare(sql).get(...params) as T | undefined;
}

export function getRows<T = Row>(db: DatabaseSync, sql: string, params: unknown[] = []): T[] {
	return db.prepare(sql).all(...params) as T[];
}
