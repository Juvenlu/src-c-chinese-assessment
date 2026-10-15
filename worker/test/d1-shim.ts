/**
 * 最小 D1 兼容 shim（仅测试用）
 *
 * 在 node:sqlite DatabaseSync 之上实现 Worker 代码用到的 D1 子集：
 *   db.prepare(sql).bind(...p).first<T>() / .all<T>() / .run()
 *   db.batch(prepared[])  —— 单事务，任一失败整体回滚
 *
 * 这样 Worker HTTP handler（createD1DBAdapter + env.DB.prepare）可直接在内存库运行，
 * 走真实 SQL、真实部分唯一索引与外键，而不是 mock。
 */

import { DatabaseSync } from "node:sqlite";
import type { Row } from "../src/version-store.js";

interface D1ResultMeta {
	changes: number;
	last_row_id: number;
}

interface BoundStmt {
	first<T = Row>(): Promise<T | null>;
	all<T = Row>(): Promise<{ results: T[]; success: boolean; meta: D1ResultMeta }>;
	run(): Promise<{ success: boolean; meta: D1ResultMeta }>;
}

export interface D1Like {
	prepare(sql: string): { bind(...params: unknown[]): BoundStmt };
	batch(statements: BoundStmt[]): Promise<D1ResultMeta[]>;
}

class Bound implements BoundStmt {
	constructor(
		private readonly db: DatabaseSync,
		private readonly sql: string,
		private readonly params: unknown[],
	) {}

	first<T = Row>(): Promise<T | null> {
		const row = this.db.prepare(this.sql).get(...this.params) as T | undefined;
		return Promise.resolve(row ?? null);
	}

	all<T = Row>(): Promise<{ results: T[]; success: boolean; meta: D1ResultMeta }> {
		const rows = this.db.prepare(this.sql).all(...this.params) as T[];
		return Promise.resolve({
			results: rows,
			success: true,
			meta: { changes: rows.length, last_row_id: 0 },
		});
	}

	run(): Promise<{ success: boolean; meta: D1ResultMeta }> {
		const r = this.db.prepare(this.sql).run(...this.params);
		return Promise.resolve({
			success: true,
			meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
		});
	}

	/** batch 内部使用：在已开启事务中同步执行 */
	execInTx(): void {
		this.db.prepare(this.sql).run(...this.params);
	}
}

/** 将 node:sqlite 包装为 Worker 代码所需的 D1 子集 */
export function createD1Like(db: DatabaseSync): D1Like {
	return {
		prepare(sql: string) {
			return {
				bind(...params: unknown[]): BoundStmt {
					return new Bound(db, sql, params);
				},
			};
		},
		async batch(statements: BoundStmt[]): Promise<D1ResultMeta[]> {
			db.exec("BEGIN");
			try {
				for (const s of statements) (s as Bound).execInTx();
				db.exec("COMMIT");
				return statements.map(() => ({ changes: 0, last_row_id: 0 }));
			} catch (err) {
				db.exec("ROLLBACK");
				throw err;
			}
		},
	};
}
