/**
 * Admin Data — D1 只读数据端点（测试结果 / 用户数据）
 *
 * GET /v1/admin/results — 全部测试结果（按 completed_at DESC）
 * GET /v1/admin/users   — 家长列表 + 全量孩子（all_children 含 parent_email）
 *
 * 背景（SRC-ADMIN-BUG-01/02）：
 *   admin results/users 原直连已弃用的 Supabase 旧库，导致 A02/A03/A04 后台
 *   数据停在新旧分界点。本模块将该数据源迁移到唯一 Production 权威库 D1，
 *   复用既有 x-admin-password 常量时间鉴权，不降低安全标准。
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

/** D1 时间戳为秒级 unix，转为 ISO 字符串（与 admin-children.ts 一致） */
function toIso(sec: number | null | undefined): string | null {
	return sec ? new Date(sec * 1000).toISOString() : null;
}

/** 安全解析 JSON 文本字段，失败返回兜底值 */
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

// ===== GET /v1/admin/results =====

interface TestResultRow {
	id: string;
	session_id: string;
	child_id: string;
	level: string;
	test_type: string;
	status: string;
	character_score: number;
	vocab_score: number;
	reading_score: number;
	comprehension_score: number;
	total_score: number;
	stable_char_count: number;
	stable_vocab_count: number;
	completion_time_seconds: number;
	total_questions: number;
	correct_count: number;
	known_characters_json: string | null;
	weak_characters_json: string | null;
	part_breakdown_json: string | null;
	completed_at: number;
	created_at: number;
}

/**
 * 测试结果 → 前端现有契约（兼容 legacy Supabase 字段）。
 * 关键映射：
 * - test_mode ← test_type（前端以 test_mode === 'sampling' 渲染「估算」标记）
 * - known_characters ← JSON.parse(known_characters_json)（A03 字库数据源）
 */
function rowToResult(row: TestResultRow): Record<string, unknown> {
	return {
		id: row.id,
		session_id: row.session_id,
		child_id: row.child_id,
		level: row.level,
		test_mode: row.test_type,
		test_type: row.test_type,
		status: row.status,
		character_score: row.character_score,
		vocab_score: row.vocab_score,
		reading_score: row.reading_score,
		comprehension_score: row.comprehension_score,
		total_score: row.total_score,
		stable_char_count: row.stable_char_count,
		stable_vocab_count: row.stable_vocab_count,
		completion_time_seconds: row.completion_time_seconds,
		total_questions: row.total_questions,
		correct_count: row.correct_count,
		known_characters: parseJson<string[]>(row.known_characters_json, []),
		weak_characters: parseJson<string[]>(row.weak_characters_json, []),
		part_breakdown: parseJson<unknown>(row.part_breakdown_json, null),
		completed_at: toIso(row.completed_at),
		created_at: toIso(row.created_at),
	};
}

/**
 * Admin 获取全部测试结果（D1 权威数据，按完成时间倒序）。
 * 返回 { success, data } 契约与历史 API 一致。
 */
export async function handleV1AdminResults(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	try {
		const { results } = await env.DB.prepare(
			`SELECT * FROM test_results
			 ORDER BY completed_at DESC, created_at DESC`
		).bind().all<TestResultRow>();

		const rows = (results ?? []).map(rowToResult);
		return jsonResponse({ success: true, data: rows });
	} catch (error) {
		console.error("[admin-data] results query error:", error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}

// ===== GET /v1/admin/users =====

interface ParentRow {
	id: string;
	email: string;
	email_verified: number;
	status: string;
	created_at: number;
	updated_at: number | null;
	roles: string;
}

interface ChildRow {
	id: string;
	parent_id: string;
	nickname: string;
	age: number;
	grade: string;
	country: string;
	home_language: string | null;
	home_language_other: string | null;
	status: string;
	estimated_level: string | null;
	confirmed_level: string | null;
	assessment_status: string;
	created_at: number;
	updated_at: number | null;
}

/**
 * Admin 获取用户数据（家长 + 孩子，D1 权威数据）。
 * 返回 { users, all_children } 契约与历史 API 一致：
 * - users：家长列表（不含 password_hash 等敏感字段）
 * - all_children：全量 active 孩子（含未完成测评孩子），注入 parent_email；
 *   D1 children.parent_id 为 NOT NULL 外键，无 orphan 分支（历史契约字段保留为 null 兜底）
 */
export async function handleV1AdminUsers(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	try {
		const parentRes = await env.DB.prepare(
			`SELECT id, email, email_verified, status, created_at, updated_at, roles
			 FROM parents
			 ORDER BY created_at DESC`
		).bind().all<ParentRow>();

		const childRes = await env.DB.prepare(
			`SELECT id, parent_id, nickname, age, grade, country,
			        home_language, home_language_other, status,
			        estimated_level, confirmed_level, assessment_status,
			        created_at, updated_at
			 FROM children
			 WHERE status = 'active'
			 ORDER BY created_at DESC`
		).bind().all<ChildRow>();

		const parents = (parentRes.results ?? []).map((p) => ({
			id: p.id,
			email: p.email,
			email_verified: p.email_verified === 1,
			status: p.status,
			roles: p.roles,
			created_at: toIso(p.created_at),
			updated_at: toIso(p.updated_at),
		}));

		const emailById = new Map<string, string>(
			(parentRes.results ?? []).map((p) => [p.id, p.email]),
		);

		const allChildren = (childRes.results ?? []).map((c) => ({
			id: c.id,
			parent_id: c.parent_id,
			parent_email: emailById.get(c.parent_id) ?? null,
			nickname: c.nickname,
			age: c.age,
			grade: c.grade,
			country: c.country,
			home_language: c.home_language,
			home_language_other: c.home_language_other,
			status: c.status,
			estimated_level: c.estimated_level,
			confirmed_level: c.confirmed_level,
			assessment_status: c.assessment_status,
			created_at: toIso(c.created_at),
			updated_at: toIso(c.updated_at),
		}));

		return jsonResponse({ users: parents, all_children: allChildren });
	} catch (error) {
		console.error("[admin-data] users query error:", error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}