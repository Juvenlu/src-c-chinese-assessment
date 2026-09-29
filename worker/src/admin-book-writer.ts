/**
 * Admin Book Writer — Manual Draft
 *
 * POST /v1/admin/rewrite/manual
 *   - Admin 密码鉴权（x-admin-password）
 *   - 从 Master Pages 读取原文
 *   - 创建新的 rewrite version（status = review，来源=manual）
 *   - 返回完整 rewrite 记录
 *
 * 架构：Vercel → Worker → D1
 */

import type { Env } from "./types";

function jsonResponse(data: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function nowUnix(): number {
	return Math.floor(Date.now() / 1000);
}

function verifyAdminPassword(request: Request, env: Env): boolean {
	const pwd = request.headers.get("x-admin-password");
	if (!pwd || !env.ADMIN_PASSWORD) return false;
	if (pwd.length !== env.ADMIN_PASSWORD.length) return false;
	let result = 0;
	for (let i = 0; i < pwd.length; i++) {
		result |= pwd.charCodeAt(i) ^ env.ADMIN_PASSWORD.charCodeAt(i);
	}
	return result === 0;
}

interface ManualDraftBody {
	episode_id: number | string;
	child_id?: string;
	target_level?: string;
}

interface EpisodePageRow {
	page_number: number;
	original_text: string;
	image_url: string | null;
}

interface RewriteRow {
	id: number;
	episode_id: number;
	child_id: string | null;
	target_level: string;
	status: string;
	version: number;
	pages_json: string;
	frontier_targets_json: string;
	total_chars: number;
	unique_chars: number;
	max_page_chars: number;
	validation_result_json: string | null;
	generation_params_json: string | null;
	retry_count: number;
	failure_reason: string | null;
	created_at: number;
	finalized_at: number | null;
	finalized_by: string | null;
}

interface RewritePage {
	page: number;
	text: string;
	frontier: string[];
	image_url?: string;
	original_text?: string;
}

function mapRewriteRow(row: RewriteRow): Record<string, unknown> {
	let pages_json: RewritePage[] = [];
	try {
		pages_json = JSON.parse(row.pages_json) as RewritePage[];
	} catch {
		pages_json = [];
	}

	let frontier_targets: string[] = [];
	try {
		frontier_targets = JSON.parse(row.frontier_targets_json) as string[];
	} catch {
		frontier_targets = [];
	}

	let validation_result: unknown = null;
	if (row.validation_result_json) {
		try {
			validation_result = JSON.parse(row.validation_result_json);
		} catch {
			validation_result = null;
		}
	}

	let generation_params: unknown = null;
	if (row.generation_params_json) {
		try {
			generation_params = JSON.parse(row.generation_params_json);
		} catch {
			generation_params = null;
		}
	}

	return {
		id: row.id,
		episode_id: row.episode_id,
		target_level: row.target_level,
		pages_json,
		frontier_targets,
		status: row.status,
		generation_params,
		validation_result,
		version: row.version,
		retry_count: row.retry_count,
		failure_reason: row.failure_reason,
		child_id: row.child_id,
		created_at: row.created_at ? new Date(row.created_at * 1000).toISOString() : "",
		finalized_at: row.finalized_at ? new Date(row.finalized_at * 1000).toISOString() : null,
		finalized_by: row.finalized_by,
		total_chars: row.total_chars,
		unique_chars: row.unique_chars,
		max_page_chars: row.max_page_chars,
		source: "manual",
	};
}

/**
 * GET /v1/admin/rewrite/:id
 *
 * 从 D1 读取单条 rewrite 详情（Admin 用，包含完整数据）
 */
export async function handleV1AdminRewriteDetail(
	request: Request,
	env: Env,
	rewriteIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	const rewriteId = Number(rewriteIdStr);
	if (!Number.isInteger(rewriteId) || rewriteId <= 0) {
		return jsonResponse({ error: "Invalid rewrite id" }, 400);
	}

	try {
		const row = await env.DB.prepare(
			`SELECT id, episode_id, child_id, target_level, status, version,
            pages_json, frontier_targets_json,
            total_chars, unique_chars, max_page_chars,
            validation_result_json, generation_params_json,
            retry_count, failure_reason,
            created_at, finalized_at, finalized_by
         FROM book_rewrite_versions
        WHERE id = ?`
		).bind(rewriteId).first<RewriteRow>();

		if (!row) {
			return jsonResponse({ error: "Not found" }, 404);
		}

		return jsonResponse(mapRewriteRow(row));
	} catch (error) {
		console.error("[admin-rewrites] detail error:", error);
		return jsonResponse({
			error: "Failed to get rewrite",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}

/**
 * GET /v1/admin/episodes/:id/rewrites
 *
 * 列出某 episode 的所有 rewrite 版本（Admin 用）
 */
export async function handleV1AdminEpisodeRewrites(
	request: Request,
	env: Env,
	episodeIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	const episodeId = Number(episodeIdStr);
	if (!Number.isInteger(episodeId) || episodeId <= 0) {
		return jsonResponse({ error: "Invalid episode id" }, 400);
	}

	try {
		const result = await env.DB.prepare(
			`SELECT id, episode_id, child_id, target_level, status, version,
            pages_json, frontier_targets_json,
            total_chars, unique_chars, max_page_chars,
            validation_result_json, generation_params_json,
            retry_count, failure_reason,
            created_at, finalized_at, finalized_by
         FROM book_rewrite_versions
        WHERE episode_id = ?
        ORDER BY created_at DESC`
		).bind(episodeId).all<RewriteRow>();

		const rows = result.results || [];
		return jsonResponse(rows.map((r) => mapRewriteRow(r)));
	} catch (error) {
		console.error("[admin-rewrites] list error:", error);
		return jsonResponse({
			error: "Failed to list rewrites",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}

/**
 * PATCH /v1/admin/rewrite/:id
 *
 * 更新 rewrite 的 pages 和/或状态（Admin 编辑保存用）
 */
interface PatchRewriteBody {
	pages?: RewritePage[];
	status?: string;
}

export async function handleV1AdminRewritePatch(
	request: Request,
	env: Env,
	rewriteIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	const rewriteId = Number(rewriteIdStr);
	if (!Number.isInteger(rewriteId) || rewriteId <= 0) {
		return jsonResponse({ error: "Invalid rewrite id" }, 400);
	}

	let body: PatchRewriteBody;
	try {
		body = (await request.json()) as PatchRewriteBody;
	} catch {
		return jsonResponse({ error: "Invalid JSON body" }, 400);
	}

	try {
		// 先确认存在
		const existing = await env.DB.prepare(
			`SELECT id, pages_json, status, total_chars, unique_chars, max_page_chars
         FROM book_rewrite_versions WHERE id = ?`
		).bind(rewriteId).first<RewriteRow>();

		if (!existing) {
			return jsonResponse({ error: "Not found" }, 404);
		}

		let newStatus = body.status || existing.status;
		let pagesJsonStr = existing.pages_json;
		let totalChars = existing.total_chars;
		let uniqueChars = existing.unique_chars;
		let maxPageChars = existing.max_page_chars;

		if (body.pages && Array.isArray(body.pages)) {
			pagesJsonStr = JSON.stringify(body.pages);
			// 重新计算字量
			totalChars = 0;
			const uniqueSet = new Set<string>();
			maxPageChars = 0;
			for (const page of body.pages) {
				const chars = Array.from(page.text || "");
				totalChars += chars.length;
				if (chars.length > maxPageChars) maxPageChars = chars.length;
				for (const ch of chars) {
					if (ch >= "\u4e00" && ch <= "\u9fff") {
						uniqueSet.add(ch);
					}
				}
			}
			uniqueChars = uniqueSet.size;
		}

		const validStatuses = ["ai_draft", "review", "final", "rejected", "failed"];
		if (!validStatuses.includes(newStatus)) {
			newStatus = "review";
		}

		const result = await env.DB.prepare(
			`UPDATE book_rewrite_versions
           SET status = ?,
               pages_json = ?,
               total_chars = ?,
               unique_chars = ?,
               max_page_chars = ?
         WHERE id = ?
         RETURNING *`
		).bind(newStatus, pagesJsonStr, totalChars, uniqueChars, maxPageChars, rewriteId)
			.first<RewriteRow>();

		if (!result) {
			return jsonResponse({ error: "Update failed" }, 500);
		}

		return jsonResponse(mapRewriteRow(result));
	} catch (error) {
		console.error("[admin-rewrites] patch error:", error);
		return jsonResponse({
			error: "Failed to update rewrite",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}

/**
 * POST /v1/admin/rewrite/:id/reject
 *
 * 驳回 rewrite（Admin 用）
 */
export async function handleV1AdminRewriteReject(
	request: Request,
	env: Env,
	rewriteIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	const rewriteId = Number(rewriteIdStr);
	if (!Number.isInteger(rewriteId) || rewriteId <= 0) {
		return jsonResponse({ error: "Invalid rewrite id" }, 400);
	}

	try {
		const result = await env.DB.prepare(
			`UPDATE book_rewrite_versions SET status = 'rejected' WHERE id = ? RETURNING *`
		).bind(rewriteId).first<RewriteRow>();

		if (!result) {
			return jsonResponse({ error: "Not found" }, 404);
		}

		return jsonResponse(mapRewriteRow(result));
	} catch (error) {
		console.error("[admin-rewrites] reject error:", error);
		return jsonResponse({
			error: "Failed to reject rewrite",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}

/**
 * POST /v1/admin/rewrite/manual
 *
 * 从 Master Pages 初始化一条人工 rewrite draft。
 * - 读取 episode 的所有 page
 * - 每页初始 text = original_text（管理员后续可以在 UI 中编辑）
 * - status = review
 * - 计算 total_chars / unique_chars / max_page_chars
 */
export async function handleV1AdminManualDraft(request: Request, env: Env): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	let body: ManualDraftBody;
	try {
		body = (await request.json()) as ManualDraftBody;
	} catch {
		return jsonResponse({ error: "Invalid JSON body" }, 400);
	}

	const episodeId = Number(body.episode_id);
	if (!Number.isInteger(episodeId) || episodeId <= 0) {
		return jsonResponse({ error: "episode_id required" }, 400);
	}

	const targetLevel = body.target_level || "SRC300";
	const validLevels = ["SRC100", "SRC300", "SRC500", "SRC800"];
	if (!validLevels.includes(targetLevel)) {
		return jsonResponse({ error: "invalid target_level" }, 400);
	}

	const nowTs = nowUnix();

	try {
		// 1. 读取 Master Pages
		const pagesStmt = env.DB.prepare(
			`SELECT page_number, original_text, image_url
         FROM book_episode_pages
        WHERE episode_id = ?
        ORDER BY page_number ASC`
		).bind(episodeId);
		const pagesResult = await pagesStmt.all<EpisodePageRow>();
		const masterPages = pagesResult.results || [];

		if (masterPages.length === 0) {
			return jsonResponse({ error: "Episode has no pages" }, 404);
		}

		// 2. 构建初始 pages_json（每页 text = original_text，后续管理员编辑）
		const pagesJson: RewritePage[] = masterPages.map((p) => ({
			page: p.page_number,
			text: p.original_text || "",
			frontier: [],
			image_url: p.image_url || undefined,
			original_text: p.original_text || "",
		}));

		// 3. 计算字量统计
		let totalChars = 0;
		const uniqueCharsSet = new Set<string>();
		let maxPageChars = 0;

		for (const page of pagesJson) {
			const chars = Array.from(page.text);
			totalChars += chars.length;
			if (chars.length > maxPageChars) maxPageChars = chars.length;
			for (const ch of chars) {
				// 只统计 CJK 统一汉字
				if (ch >= "\u4e00" && ch <= "\u9fff") {
					uniqueCharsSet.add(ch);
				}
			}
		}

		const uniqueChars = uniqueCharsSet.size;

		// 4. 计算当前最大 version 号
		const versionRow = await env.DB.prepare(
			`SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM book_rewrite_versions
        WHERE episode_id = ?`
		).bind(episodeId).first<{ next_version: number }>();
		const nextVersion = versionRow?.next_version || 1;

		const generationParams = {
			source: "manual",
			tool: "book-writer",
			created_at: new Date(nowTs * 1000).toISOString(),
		};

		// 5. INSERT
		const insertResult = await env.DB.prepare(
			`INSERT INTO book_rewrite_versions
         (episode_id, target_level, pages_json, frontier_targets_json,
          generation_params_json, validation_result_json, status,
          version, retry_count, child_id, failure_reason,
          total_chars, unique_chars, max_page_chars, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'review', ?, 0, ?, NULL, ?, ?, ?, ?)
       RETURNING *`
		).bind(
			episodeId,
			targetLevel,
			JSON.stringify(pagesJson),
			JSON.stringify([]),
			JSON.stringify(generationParams),
			null,
			nextVersion,
			body.child_id || null,
			totalChars,
			uniqueChars,
			maxPageChars,
			nowTs,
		).first<RewriteRow>();

		if (!insertResult) {
			return jsonResponse({ error: "Failed to create manual draft" }, 500);
		}

		return jsonResponse({
			rewrite_id: insertResult.id,
			status: insertResult.status,
			...mapRewriteRow(insertResult),
		}, 201);
	} catch (error) {
		console.error("[admin-rewrites] manual draft error:", error);
		return jsonResponse({
			error: "Create manual draft failed",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}
