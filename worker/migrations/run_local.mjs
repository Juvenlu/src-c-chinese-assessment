#!/usr/bin/env node
/**
 * P3-H-12C 本地迁移 runner（幂等，仅用于本地 / CI，绝不连接 Production D1）
 *
 * 用法：
 *   node migrations/run_local.mjs <schema.sql> <database.sqlite>
 *
 * 行为：
 *   1. 若 <database.sqlite> 不存在，先执行 <schema.sql>（迁移前的建表脚本）。
 *   2. 再幂等地应用 003 迁移（加列前用 PRAGMA table_info 判断；索引用 IF NOT EXISTS）。
 *
 * 它与 worker/migrations/003_custom_book_versioning.sql 等价，只是加了可重复执行保护；
 * Production 仍按 004(回填) → 003(迁移) 的顺序在 D1 上人工执行，本脚本不会触碰生产。
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";

function columnExists(db, table, column) {
	return db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === column);
}

function indexExists(db, index) {
	return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`).get(index);
}

export function applyVersioningMigration(db, requireSingleActive = false) {
	const opts =
		typeof requireSingleActive === "boolean"
			? { requireSingleActive }
			: requireSingleActive ?? {};
	const addedColumns = [];
	const skippedColumns = [];
	const createdIndexes = [];

	if (opts.requireSingleActive) {
		const dupes = db
			.prepare(
				`SELECT child_id, episode_id, count(*) AS n
				   FROM custom_books WHERE status='active'
				  GROUP BY child_id, episode_id HAVING count(*) > 1`,
			)
			.all();
		if (dupes.length > 0) {
			throw new Error("Multiple active rows exist; run backfill (004) before applying 003.");
		}
	}

	for (const col of ["pushed_at", "first_viewed_at"]) {
		if (columnExists(db, "custom_books", col)) {
			skippedColumns.push(col);
		} else {
			db.exec(`ALTER TABLE custom_books ADD COLUMN ${col} INTEGER`);
			addedColumns.push(col);
		}
	}

	const indexes = [
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_custom_books_active
		   ON custom_books(child_id, episode_id) WHERE status='active'`,
		`CREATE INDEX IF NOT EXISTS idx_custom_books_child_episode
		   ON custom_books(child_id, episode_id)`,
		`CREATE INDEX IF NOT EXISTS idx_custom_books_status ON custom_books(status)`,
	];
	for (const sql of indexes) {
		const name = /INDEX (?:IF NOT EXISTS )?(\w+)/.exec(sql)?.[1] ?? "";
		db.exec(sql);
		if (name && indexExists(db, name)) createdIndexes.push(name);
	}

	return { addedColumns, skippedColumns, createdIndexes };
}

function main() {
	const [schemaPath, dbPath] = process.argv.slice(2);
	if (!schemaPath || !dbPath) {
		console.error("usage: node migrations/run_local.mjs <schema.sql> <database.sqlite>");
		process.exit(2);
	}
	const dbExisted = existsSync(dbPath);
	const db = new DatabaseSync(dbPath);
	db.exec("PRAGMA foreign_keys=ON;");
	const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='custom_books'").get();
	if (!dbExisted || !hasTable) {
		db.exec(readFileSync(schemaPath, "utf8"));
	}
	const result = applyVersioningMigration(db);
	console.log(JSON.stringify(result, null, 2));
	db.close();
}

// 仅在被直接执行时运行 main（被 import 时只导出函数）
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
