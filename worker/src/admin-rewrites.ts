/**
 * Admin Rewrite — Finalize（P3-H-12C 起与上架解耦）
 *
 * POST /v1/admin/rewrite/:id/finalize
 *   - Admin 密码鉴权（x-admin-password）
 *   - Rewrite status → final
 *   - 不再自动创建/激活 custom_books；设正式版改走 activate 端点
 *
 * 架构：Vercel → Worker → D1
 */

import { createD1DBAdapter } from "./d1-adapter";
import type { Env } from "./types";
import { markRewriteFinal } from "./version-store";

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
 * Finalize Rewrite（仅定稿，与上架解耦）
 *
 * 流程：
 * 1. Admin 密码鉴权
 * 2. 查询 rewrite 是否存在
 * 3. UPDATE status=final, finalized_by=admin, finalized_at=now
 * 4. 返回完整 rewrite 对象
 *
 * 注意：本接口不再写入 custom_books，不会自动上架。
 * 正式版需由管理员显式调用 POST /v1/admin/rewrite/:id/activate，
 * 由 version-store.activateVersion 维护每个 child + episode 的唯一 active。
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
		// 1. 先确认 rewrite 存在（404），字段读取由 markRewriteFinal 完成
		const exists = await env.DB
			.prepare(`SELECT id FROM book_rewrite_versions WHERE id = ?`)
			.bind(rewriteId)
			.first<{ id: number }>();

		if (!exists) {
			return jsonResponse({ error: "Not found" }, 404);
		}

		// 2. Finalize 与上架解耦（P3-H-12C）：
		//    Finalize 只把 rewrite 置为 final，不再自动创建/激活 custom_books。
		//    设为正式版改由管理员显式调用 /v1/admin/rewrite/:id/activate。
		const pagesJson = body.pages ? JSON.stringify(body.pages) : null;
		const finalRes = await markRewriteFinal(
			createD1DBAdapter(env.DB),
			nowTs,
			rewriteId,
			pagesJson,
		);
		if (!finalRes.ok) {
			return jsonResponse({ error: finalRes.error }, finalRes.status);
		}

		// 3. 回读最新记录返回（保证 pages_json 与库内一致）
		const finalized = await env.DB
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

		if (!finalized) {
			return jsonResponse({ error: "Rewrite missing after finalize" }, 500);
		}

		return jsonResponse(mapRewriteRow(finalized));
	} catch (error) {
		console.error("[admin-rewrites] finalize error:", error);
		return jsonResponse({
			error: "Finalize failed",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}
