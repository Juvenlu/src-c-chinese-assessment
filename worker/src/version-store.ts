/**
 * 绘本正式版本管理 — 纯逻辑服务（与运行时解耦）
 *
 * P3-H-12C：Finalize / 设正式版 / 推送 三操作解耦。
 *
 * 不变量（由 DB 部分唯一索引 + 本服务共同保证）：
 *   每个 (child_id, episode_id) 至多一条 status='active' 的 custom_books。
 *
 * 状态机：
 *   rewrite: ai_draft/review ──finalize──▶ final（不再自动创建/激活 custom_books）
 *   custom_books.status: active（唯一正式展示版）/ archived（归档）/ deleted（软删除）
 *
 * 操作：
 *   markRewriteFinal  Finalize，仅置 rewrite.status=final，不触碰 custom_books
 *   activateVersion   显式设为正式版（原子：归档同 child+episode 其它 active，再激活目标）
 *   archiveVersion    归档（可使书架暂时无正式版，直到管理员另选）
 *   restoreVersion    恢复（从 archived/deleted 提升回 active，原子归档其它 active）
 *   softDeleteVersion 安全软删除（保留 reading_records / reading_feedback）
 *   pushVersion       显式推送（置 pushed_at、清空 first_viewed_at → 触发“新”）
 *   markFirstViewed   孩子首次打开（best-effort 置 first_viewed_at → “新”消失）
 *   listVersions      管理员版本列表（含记录/反馈计数与 is_new）
 *
 * 读写一致性说明：
 *   读校验在写之前进行；所有写操作通过 DBAdapter.execBatch 单批原子提交。
 *   即便在读与写之间发生并发，部分唯一索引也会让违规批次整体失败回滚。
 */

// ============================================================
// DB 适配器（D1 / node:sqlite 各提供一个实现）
// ============================================================

export interface Row {
	[key: string]: unknown;
}

export interface BatchStatement {
	sql: string;
	params: unknown[];
}

export interface DBAdapter {
	/** 单行查询，无结果返回 undefined。SQL 一律使用位置占位符 ? */
	get<T = Row>(sql: string, params: unknown[]): Promise<T | undefined>;
	/** 多行查询 */
	all<T = Row>(sql: string, params: unknown[]): Promise<T[]>;
	/** 原子执行多条写语句（D1 batch / SQLite BEGIN…COMMIT），失败整体回滚 */
	execBatch(statements: BatchStatement[]): Promise<void>;
}

// ============================================================
// 类型与结果
// ============================================================

export const BOOK_STATUS = {
	ACTIVE: "active",
	ARCHIVED: "archived",
	DELETED: "deleted",
} as const;
export type BookStatus = (typeof BOOK_STATUS)[keyof typeof BOOK_STATUS];

export type ServiceResult<T> =
	| { ok: true; data: T }
	| { ok: false; status: number; error: string; extra?: Row };

interface RewriteRef {
	id: number;
	episode_id: number;
	child_id: string | null;
	target_level: string;
	status: string;
}

// ============================================================
// 内部工具
// ============================================================

function fail(status: number, error: string, extra?: Row): ServiceResult<never> {
	return { ok: false, status, error, extra };
}

function asInt(v: unknown): number | null {
	// 注意：Number(null) === 0，必须先排除 NULL，否则可空时间戳列会被误判为 0
	if (v === null || v === undefined) return null;
	const n = Number(v);
	return Number.isInteger(n) ? n : null;
}

// ============================================================
// 1. Finalize（解耦：不创建/激活 custom_books）
// ============================================================

/**
 * 将 rewrite 置为 final。幂等：已是 final 直接返回。
 * 仅更新 rewrite，本身不产生 custom_books（这是与旧逻辑的关键区别）。
 * pagesJson 可选；提供则覆盖（管理员编辑后 finalize），否则保留原 pages_json。
 */
export async function markRewriteFinal(
	db: DBAdapter,
	now: number,
	rewriteId: number,
	pagesJson: string | null,
): Promise<ServiceResult<{ id: number; status: string; alreadyFinal: boolean }>> {
	const row = await db.get<RewriteRef & { pages_json: string; finalized_at: number | null }>(
		`SELECT id, episode_id, child_id, target_level, status, pages_json, finalized_at
		   FROM book_rewrite_versions WHERE id = ?`,
		[rewriteId],
	);
	if (!row) return fail(404, "Rewrite not found");

	if (row.status === "final" && row.finalized_at) {
		return { ok: true, data: { id: rewriteId, status: "final", alreadyFinal: true } };
	}

	const finalPages = pagesJson ?? row.pages_json;
	await db.execBatch([
		{
			sql: `UPDATE book_rewrite_versions
			        SET status = 'final', finalized_by = 'admin', finalized_at = ?, pages_json = ?
			      WHERE id = ?`,
			params: [now, finalPages, rewriteId],
		},
	]);
	return { ok: true, data: { id: rewriteId, status: "final", alreadyFinal: false } };
}

// ============================================================
// 2. 设为正式版（每 child+episode 唯一 active）
// ============================================================

/**
 * 显式选择某个 rewrite 作为孩子该集的唯一正式版。
 * - 校验 rewrite 存在、status=final、child_id/episode_id 与请求一致。
 * - 原子：先归档该 child+episode 下其它 active，再 upsert 目标为 active。
 * - 若目标 custom_books 不存在则按 rewrite 字段创建（INSERT…SELECT…ON CONFLICT）。
 */
export async function activateVersion(
	db: DBAdapter,
	now: number,
	opts: { childId: string; episodeId: number; rewriteId: number },
): Promise<ServiceResult<{ customBookId: number }>> {
	const { childId, episodeId, rewriteId } = opts;

	const ref = await db.get<RewriteRef>(
		`SELECT id, episode_id, child_id, target_level, status
		   FROM book_rewrite_versions WHERE id = ?`,
		[rewriteId],
	);
	if (!ref) return fail(404, "Rewrite not found");
	if (ref.status !== "final") {
		return fail(409, "Only finalized rewrites can be set as official", { rewrite_status: ref.status });
	}
	if (!ref.child_id || ref.child_id !== childId) {
		return fail(403, "Rewrite does not belong to this child");
	}
	if (asInt(ref.episode_id) !== episodeId) {
		return fail(409, "Rewrite episode mismatch");
	}

	// 原子写：先归档其它 active，再 upsert 目标。
	await db.execBatch([
		{
			sql: `UPDATE custom_books
			        SET status = 'archived', updated_at = ?
			      WHERE child_id = ? AND episode_id = ? AND rewrite_id <> ? AND status = 'active'`,
			params: [now, childId, episodeId, rewriteId],
		},
		{
			sql: `INSERT INTO custom_books
			        (child_id, rewrite_id, episode_id, level_tier, is_free, status, created_at, updated_at)
			      SELECT r.child_id, r.id, r.episode_id, r.target_level, 0, 'active', ?, ?
			        FROM book_rewrite_versions r
			       WHERE r.id = ? AND r.child_id = ? AND r.episode_id = ? AND r.status = 'final'
			      ON CONFLICT(child_id, rewrite_id) DO UPDATE SET
			        status = 'active', episode_id = excluded.episode_id,
			        level_tier = excluded.level_tier, updated_at = ?`,
			params: [now, now, rewriteId, childId, episodeId, now],
		},
	]);

	const book = await db.get<{ id: number }>(
		`SELECT id FROM custom_books WHERE child_id = ? AND rewrite_id = ?`,
		[childId, rewriteId],
	);
	if (!book) return fail(500, "Activation failed: custom book row missing");
	return { ok: true, data: { customBookId: asInt(book.id) as number } };
}

// ============================================================
// 3. 归档
// ============================================================

export async function archiveVersion(
	db: DBAdapter,
	now: number,
	customBookId: number,
): Promise<ServiceResult<{ id: number; status: BookStatus }>> {
	const row = await db.get<{ id: number; status: string }>(
		`SELECT id, status FROM custom_books WHERE id = ?`,
		[customBookId],
	);
	if (!row) return fail(404, "Custom book not found");
	if (row.status === BOOK_STATUS.DELETED) {
		return fail(409, "Deleted book must be restored before archiving");
	}
	if (row.status === BOOK_STATUS.ARCHIVED) {
		return { ok: true, data: { id: customBookId, status: BOOK_STATUS.ARCHIVED } }; // 幂等
	}
	await db.execBatch([
		{
			sql: `UPDATE custom_books SET status = 'archived', updated_at = ? WHERE id = ?`,
			params: [now, customBookId],
		},
	]);
	return { ok: true, data: { id: customBookId, status: BOOK_STATUS.ARCHIVED } };
}

// ============================================================
// 4. 恢复（提升回 active，原子归档同组其它 active）
// ============================================================

export async function restoreVersion(
	db: DBAdapter,
	now: number,
	customBookId: number,
): Promise<ServiceResult<{ id: number; status: BookStatus }>> {
	const row = await db.get<{ id: number; child_id: string; episode_id: number; rewrite_id: number; status: string }>(
		`SELECT id, child_id, episode_id, rewrite_id, status FROM custom_books WHERE id = ?`,
		[customBookId],
	);
	if (!row) return fail(404, "Custom book not found");
	if (row.status === BOOK_STATUS.ACTIVE) {
		return { ok: true, data: { id: customBookId, status: BOOK_STATUS.ACTIVE } }; // 幂等
	}

	// 恢复即重新选为正式版：归档其它 active，再激活本版本。
	await db.execBatch([
		{
			sql: `UPDATE custom_books SET status = 'archived', updated_at = ?
			      WHERE child_id = ? AND episode_id = ? AND rewrite_id <> ? AND status = 'active'`,
			params: [now, row.child_id, asInt(row.episode_id), asInt(row.rewrite_id)],
		},
		{
			sql: `UPDATE custom_books SET status = 'active', updated_at = ? WHERE id = ?`,
			params: [now, customBookId],
		},
	]);
	return { ok: true, data: { id: customBookId, status: BOOK_STATUS.ACTIVE } };
}

// ============================================================
// 5. 安全软删除（带依赖预检查，保留记录/反馈）
// ============================================================

export interface DeleteDependencies {
	record_count: number;
	feedback_count: number;
}

export async function previewDelete(
	db: DBAdapter,
	customBookId: number,
): Promise<ServiceResult<DeleteDependencies & { status: string }>> {
	const row = await db.get<{ status: string }>(
		`SELECT status FROM custom_books WHERE id = ?`,
		[customBookId],
	);
	if (!row) return fail(404, "Custom book not found");

	const recs = await db.get<{ n: number }>(
		`SELECT count(*) AS n FROM reading_records WHERE custom_book_id = ?`,
		[customBookId],
	);
	const fbs = await db.get<{ n: number }>(
		`SELECT count(*) AS n FROM reading_feedback WHERE custom_book_id = ?`,
		[customBookId],
	);
	return {
		ok: true,
		data: {
			status: row.status,
			record_count: asInt(recs?.n) ?? 0,
			feedback_count: asInt(fbs?.n) ?? 0,
		},
	};
}

/**
 * 软删除。必须显式 confirm=true；返回被保留的依赖计数。
 * 不删除 reading_records / reading_feedback / rewrite，仅置 status='deleted'。
 */
export async function softDeleteVersion(
	db: DBAdapter,
	now: number,
	customBookId: number,
	confirm: boolean,
): Promise<ServiceResult<DeleteDependencies>> {
	if (!confirm) {
		const preview = await previewDelete(db, customBookId);
		if (!preview.ok) return preview;
		return fail(428, "Confirmation required; preview dependencies first", { ...preview.data });
	}
	const row = await db.get<{ status: string }>(
		`SELECT status FROM custom_books WHERE id = ?`,
		[customBookId],
	);
	if (!row) return fail(404, "Custom book not found");

	const recs = await db.get<{ n: number }>(
		`SELECT count(*) AS n FROM reading_records WHERE custom_book_id = ?`,
		[customBookId],
	);
	const fbs = await db.get<{ n: number }>(
		`SELECT count(*) AS n FROM reading_feedback WHERE custom_book_id = ?`,
		[customBookId],
	);
	const record_count = asInt(recs?.n) ?? 0;
	const feedback_count = asInt(fbs?.n) ?? 0;

	if (row.status !== BOOK_STATUS.DELETED) {
		await db.execBatch([
			{
				sql: `UPDATE custom_books SET status = 'deleted', updated_at = ? WHERE id = ?`,
				params: [now, customBookId],
			},
		]);
	}
	return { ok: true, data: { record_count, feedback_count } };
}

// ============================================================
// 6. 推送（今日故事 + “新”）
// ============================================================

/**
 * 显式推送正式版到孩子的今日故事。
 * 仅 active 可推送；置 pushed_at=now、first_viewed_at=NULL（重新触发“新”）。
 */
export async function pushVersion(
	db: DBAdapter,
	now: number,
	customBookId: number,
): Promise<ServiceResult<{ id: number; pushed_at: number }>> {
	const row = await db.get<{ status: string }>(
		`SELECT status FROM custom_books WHERE id = ?`,
		[customBookId],
	);
	if (!row) return fail(404, "Custom book not found");
	if (row.status !== BOOK_STATUS.ACTIVE) {
		return fail(409, "Only the active official version can be pushed", { status: row.status });
	}
	await db.execBatch([
		{
			sql: `UPDATE custom_books SET pushed_at = ?, first_viewed_at = NULL, updated_at = ? WHERE id = ?`,
			params: [now, now, customBookId],
		},
	]);
	return { ok: true, data: { id: customBookId, pushed_at: now } };
}

// ============================================================
// 7. 首次查看（“新”消失，best-effort）
// ============================================================

/**
 * 孩子首次打开已推送且未查看的正式版时记录 first_viewed_at。
 * 不满足条件（未推送/已查看/非active）则无操作，不报错。
 */
export async function markFirstViewed(
	db: DBAdapter,
	now: number,
	customBookId: number,
): Promise<void> {
	await db.execBatch([
		{
			sql: `UPDATE custom_books
			        SET first_viewed_at = ?
			      WHERE id = ? AND status = 'active'
			        AND pushed_at IS NOT NULL AND first_viewed_at IS NULL`,
			params: [now, customBookId],
		},
	]);
}

// ============================================================
// 8. 管理员版本列表（以 final rewrite 为主，LEFT JOIN custom_books）
// ============================================================

export interface VersionListItem {
	rewrite_id: number;
	version: number;
	target_level: string;
	rewrite_status: string;
	page_count: number;
	total_chars: number;
	unique_chars: number;
	max_page_chars: number;
	custom_book_id: number | null;
	book_status: BookStatus | null;
	pushed_at: number | null;
	first_viewed_at: number | null;
	is_new: boolean;
	record_count: number;
	feedback_count: number;
	created_at: number;
	finalized_at: number | null;
}

export async function listVersions(
	db: DBAdapter,
	childId: string,
	episodeId: number,
): Promise<VersionListItem[]> {
	const rows = await db.all<Row>(
		`SELECT r.id AS rewrite_id, r.version, r.target_level,
		        r.status AS rewrite_status, r.total_chars, r.unique_chars, r.max_page_chars,
		        r.created_at, r.finalized_at,
		        json_array_length(r.pages_json) AS page_count,
		        cb.id AS custom_book_id, cb.status AS book_status,
		        cb.pushed_at AS pushed_at, cb.first_viewed_at AS first_viewed_at,
		        (SELECT count(*) FROM reading_records rr WHERE rr.custom_book_id = cb.id) AS record_count,
		        (SELECT count(*) FROM reading_feedback rf WHERE rf.custom_book_id = cb.id) AS feedback_count
		   FROM book_rewrite_versions r
		   LEFT JOIN custom_books cb
		     ON cb.rewrite_id = r.id AND cb.child_id = r.child_id AND cb.episode_id = r.episode_id
		  WHERE r.child_id = ? AND r.episode_id = ? AND r.status = 'final'
		  ORDER BY r.id`,
		[childId, episodeId],
	);

	return rows.map((r) => {
		const pushed_at = asInt(r.pushed_at);
		const first_viewed_at = asInt(r.first_viewed_at);
		return {
			rewrite_id: asInt(r.rewrite_id) as number,
			version: asInt(r.version) as number,
			target_level: String(r.target_level),
			rewrite_status: String(r.rewrite_status),
			page_count: asInt(r.page_count) ?? 0,
			total_chars: asInt(r.total_chars) ?? 0,
			unique_chars: asInt(r.unique_chars) ?? 0,
			max_page_chars: asInt(r.max_page_chars) ?? 0,
			custom_book_id: asInt(r.custom_book_id),
			book_status: (r.book_status as BookStatus | null) ?? null,
			pushed_at,
			first_viewed_at,
			is_new: pushed_at !== null && first_viewed_at === null,
			record_count: asInt(r.record_count) ?? 0,
			feedback_count: asInt(r.feedback_count) ?? 0,
			created_at: asInt(r.created_at) as number,
			finalized_at: asInt(r.finalized_at),
		};
	});
}
