/**
 * Admin Rewrite — Finalize + Publish
 *
 * POST /v1/admin/rewrite/:id/finalize
 *   - Admin 密码鉴权（x-admin-password）
 *   - Rewrite status → final
 *   - 自动建立 custom_books（INSERT OR IGNORE，幂等）
 *
 * 架构：Vercel → Worker → D1
 */

import type { Env } from "./types";

// ===== 工具函数 =====

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

// ===== 类型 =====

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

/**
 * 将 D1 row 转换成与 Vercel Finalize API 兼容的格式
 * 保持 Legacy PG 时代的字段命名（Admin UI 依赖的字段）
 */
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
	};
}

// ===== Admin 鉴权 =====

function verifyAdminPassword(request: Request, env: Env): boolean {
	const pwd = request.headers.get("x-admin-password");
	if (!pwd || !env.ADMIN_PASSWORD) return false;
	// 安全比较
	if (pwd.length !== env.ADMIN_PASSWORD.length) return false;
	let result = 0;
	for (let i = 0; i < pwd.length; i++) {
		result |= pwd.charCodeAt(i) ^ env.ADMIN_PASSWORD.charCodeAt(i);
	}
	return result === 0;
}

// ===== Handler：POST /v1/admin/rewrite/:id/finalize =====

interface FinalizeRequestBody {
	pages?: RewritePage[];
}

/**
 * Finalize Rewrite + 自动发布到 custom_books
 *
 * 流程：
 * 1. Admin 密码鉴权
 * 2. 查询 rewrite 是否存在
 * 3. UPDATE status=final, finalized_by=admin, finalized_at=now
 * 4. INSERT OR IGNORE custom_books（幂等）
 * 5. 返回完整 rewrite 对象
 */
export async function handleV1AdminRewriteFinalize(
	request: Request,
	env: Env,
	rewriteIdStr: string,
): Promise<Response> {
	// Admin 鉴权
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	const rewriteId = Number(rewriteIdStr);
	if (!Number.isInteger(rewriteId) || rewriteId <= 0) {
		return jsonResponse({ error: "Invalid rewrite id" }, 400);
	}

	let body: FinalizeRequestBody = {};
	try {
		body = await request.json() as FinalizeRequestBody;
	} catch {
		// body 可选，没有 pages 也可以 finalize
		body = {};
	}

	const nowTs = nowUnix();

	try {
		// 1. 先查 rewrite，确认存在并取得必要字段
		const selectResult = await env.DB
			.prepare(
				`SELECT id, episode_id, child_id, target_level, status, version,
            pages_json, frontier_targets_json,
            total_chars, unique_chars, max_page_chars,
            validation_result_json, generation_params_json,
            retry_count, failure_reason,
            created_at, finalized_at, finalized_by
         FROM book_rewrite_versions
         WHERE id = ?`
			)
			.bind(rewriteId)
			.first<RewriteRow>();

		if (!selectResult) {
			return jsonResponse({ error: "Not found" }, 404);
		}

		// 2. 如果已经是 final，直接返回（幂等）
		if (selectResult.status === "final" && selectResult.finalized_at) {
			// 确保 custom_books 存在（幂等保护）
			if (selectResult.child_id) {
				await env.DB
					.prepare(
						`INSERT OR IGNORE INTO custom_books
						(child_id, rewrite_id, episode_id, level_tier, is_free, status, created_at)
						VALUES (?, ?, ?, ?, 0, 'active', ?)`
					)
					.bind(
						selectResult.child_id,
						rewriteId,
						selectResult.episode_id,
						selectResult.target_level,
						nowTs,
					)
					.run();
			}

			return jsonResponse(mapRewriteRow(selectResult));
		}

		// 3. UPDATE status = final
		const pagesJson = body.pages
			? JSON.stringify(body.pages)
			: selectResult.pages_json;

		const updateResult = await env.DB
			.prepare(
				`UPDATE book_rewrite_versions
           SET status = 'final',
               finalized_by = 'admin',
               finalized_at = ?,
               pages_json = ?
         WHERE id = ?
         RETURNING *`
			)
			.bind(nowTs, pagesJson, rewriteId)
			.first<RewriteRow>();

		if (!updateResult) {
			return jsonResponse({ error: "Update failed" }, 500);
		}

		// 4. INSERT OR IGNORE custom_books（幂等发布）
		if (updateResult.child_id) {
			await env.DB
				.prepare(
					`INSERT OR IGNORE INTO custom_books
					(child_id, rewrite_id, episode_id, level_tier, is_free, status, created_at)
					VALUES (?, ?, ?, ?, 0, 'active', ?)`
				)
				.bind(
					updateResult.child_id,
					rewriteId,
					updateResult.episode_id,
					updateResult.target_level,
					nowTs,
				)
				.run();
		}

		// 5. 返回
		return jsonResponse(mapRewriteRow(updateResult));
	} catch (error) {
		console.error("[admin-rewrites] finalize error:", error);
		return jsonResponse({
			error: "Finalize failed",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}
