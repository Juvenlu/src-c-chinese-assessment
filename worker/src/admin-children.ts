/**
 * Admin Children — D1 全量孩子列表
 *
 * GET /v1/admin/children
 *   - Admin 密码鉴权（x-admin-password）
 *   - 返回所有 status='active' 的孩子（全量，无 parent_id 过滤）
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

// ===== Admin 鉴权 =====

function verifyAdminPassword(request: Request, env: Env): boolean {
	const pwd = request.headers.get("x-admin-password");
	if (!pwd || !env.ADMIN_PASSWORD) return false;
	// 安全比较（逐字节 XOR）
	if (pwd.length !== env.ADMIN_PASSWORD.length) return false;
	let result = 0;
	for (let i = 0; i < pwd.length; i++) {
		result |= pwd.charCodeAt(i) ^ env.ADMIN_PASSWORD.charCodeAt(i);
	}
	return result === 0;
}

// ===== 数据转换 =====

interface ChildRow {
	id: string;
	parent_id: string | null;
	nickname: string;
	age: number;
	grade: string;
	country: string;
	home_language: string | null;
	home_language_other: string | null;
	status: string;
	assessment_status: string | null;
	created_at: number;
	updated_at: number | null;
}

function rowToChild(row: ChildRow): Record<string, unknown> {
	return {
		id: row.id,
		parent_id: row.parent_id,
		nickname: row.nickname,
		age: row.age,
		grade: row.grade,
		country: row.country,
		home_language: row.home_language,
		home_language_other: row.home_language_other,
		status: row.status,
		assessment_status: row.assessment_status,
		created_at: row.created_at ? new Date(row.created_at * 1000).toISOString() : null,
		updated_at: row.updated_at ? new Date(row.updated_at * 1000).toISOString() : null,
	};
}

// ===== Handler：GET /v1/admin/children =====

/**
 * Admin 获取所有 active 孩子列表
 *
 * 注意：这是 Admin 全量接口，不按 parent_id 过滤。
 * 鉴权：x-admin-password + X-SRC-Service-Key
 */
export async function handleV1AdminChildren(
	request: Request,
	env: Env,
): Promise<Response> {
	// Admin 鉴权
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	try {
		const { results } = await env.DB
			.prepare(
				`SELECT * FROM children
				 WHERE status = 'active'
				 ORDER BY created_at DESC`
			)
			.all<ChildRow>();

		const children = results.map(rowToChild);
		return jsonResponse({ children });
	} catch (error) {
		console.error("[admin-children] query error:", error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}
