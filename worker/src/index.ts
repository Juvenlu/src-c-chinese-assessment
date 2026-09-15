/**
 * SRC Primary Database - Cloudflare Worker
 *
 * 目标架构：
 *   Vercel Production → Cloudflare Worker → D1「SRC Primary Database」
 */

import { verifyPassword } from "./password";
import {
	signSession,
	createSessionCookie,
} from "./session";

export interface Env {
	DB: D1Database;
	SRC_WORKER_SERVICE_KEY: string;
	SESSION_SECRET: string;
}

// ===== 工具函数 =====

function jsonResponse(data: unknown, status: number = 200, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			...extraHeaders,
		},
	});
}

function verifyServiceKey(request: Request, env: Env): boolean {
	const key = request.headers.get("X-SRC-Service-Key");
	if (!key || !env.SRC_WORKER_SERVICE_KEY) return false;
	// 安全比较：长度相同且逐字节一致
	if (key.length !== env.SRC_WORKER_SERVICE_KEY.length) return false;
	let result = 0;
	for (let i = 0; i < key.length; i++) {
		result |= key.charCodeAt(i) ^ env.SRC_WORKER_SERVICE_KEY.charCodeAt(i);
	}
	return result === 0;
}

function nowUnix(): number {
	return Math.floor(Date.now() / 1000);
}

// ===== 业务类型 =====

type Level = 'SRC100' | 'SRC300' | 'SRC500' | 'SRC800';

interface QuickResultPostBody {
	device_id: string;
	result_data: {
		characterLevel: Level;
		characterLevelLower: Level;
		characterLevelUpper: Level;
		wordLevel: Level;
		wordLevelLower: Level;
		wordLevelUpper: Level;
		readingBaseLevel: Level;
		readingBaseDesc?: string;
		recommendedReadingLevel: Level;
		recommendedReadingDesc?: string;
		confidence: string;
		totalQuestions: number;
		totalCharQuestions: number;
		totalWordQuestions: number;
		totalTimeMs: number;
		levelResults?: Array<Record<string, unknown>>;
	};
	answers: Array<{
		questionId: string;
		questionType: string;
		userAnswer: boolean;
		correct?: boolean;
		reactionTimeMs?: number;
		minimumSrcLevel?: number;
		questionRole?: string;
	}>;
	device_info?: {
		userAgent?: string;
		language?: string;
		platform?: string;
	};
}

// ===== Handler：POST /v1/guest/test-result =====

async function handlePostGuestTestResult(request: Request, env: Env): Promise<Response> {
	let body: QuickResultPostBody;
	try {
		body = await request.json() as QuickResultPostBody;
	} catch {
		return jsonResponse({ error: "Invalid request body" }, 400);
	}

	// 基础校验
	if (!body.device_id || typeof body.device_id !== "string") {
		return jsonResponse({ error: "device_id is required" }, 400);
	}
	if (!body.result_data || typeof body.result_data !== "object") {
		return jsonResponse({ error: "result_data is required" }, 400);
	}
	if (!body.answers || !Array.isArray(body.answers)) {
		return jsonResponse({ error: "answers is required" }, 400);
	}

	const rd = body.result_data;
	const sessionId = crypto.randomUUID();
	const resultId = crypto.randomUUID();
	const nowTs = nowUnix();

	// 计算正确数（优先用 correct 字段，没有则用 userAnswer 近似）
	const correctCount = body.answers.filter(a =>
		typeof a.correct === "boolean" ? a.correct : a.userAnswer === true
	).length;

	// 整个 result_data + answers 序列化存入 result_data_json（保持 Supabase 时代的 blob 语义）
	const resultDataJson = JSON.stringify({
		characterLevel: rd.characterLevel,
		characterLevelLower: rd.characterLevelLower,
		characterLevelUpper: rd.characterLevelUpper,
		wordLevel: rd.wordLevel,
		wordLevelLower: rd.wordLevelLower,
		wordLevelUpper: rd.wordLevelUpper,
		readingBaseLevel: rd.readingBaseLevel,
		readingBaseDesc: rd.readingBaseDesc,
		recommendedReadingLevel: rd.recommendedReadingLevel,
		recommendedReadingDesc: rd.recommendedReadingDesc,
		confidence: rd.confidence,
		totalQuestions: rd.totalQuestions,
		totalCharQuestions: rd.totalCharQuestions,
		totalWordQuestions: rd.totalWordQuestions,
		totalTimeMs: rd.totalTimeMs,
		levelResults: rd.levelResults || [],
		answers: body.answers,
		deviceInfo: body.device_info || null,
	});

	const rawResultJson = resultDataJson;

	try {
		// DB.batch() 原子写入两张表
		const statements = [
			env.DB.prepare(
				`INSERT INTO guest_test_sessions
				(id, device_id, test_type, status, result_data_json, claimed, child_id, created_at, completed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			).bind(
				sessionId,
				body.device_id,
				"quick",
				"completed",
				resultDataJson,
				0, // claimed = 0 (false)
				null, // child_id = NULL (游客未注册)
				nowTs,
				nowTs,
			),
			env.DB.prepare(
				`INSERT INTO quick_assessment_results
				(id, session_id, child_id, guest_session_id,
				 character_level_l, character_level_u,
				 word_level_l, word_level_u, reading_base,
				 confidence, recommended_level,
				 total_questions, correct_count,
				 raw_result_json, completed_at, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			).bind(
				resultId,
				null, // session_id = NULL (guest, 没有正式 test_session)
				null, // child_id = NULL
				sessionId,
				rd.characterLevelLower,
				rd.characterLevelUpper,
				rd.wordLevelLower,
				rd.wordLevelUpper,
				rd.readingBaseLevel,
				rd.confidence || "medium",
				rd.recommendedReadingLevel,
				rd.totalQuestions,
				correctCount,
				rawResultJson,
				nowTs,
				nowTs,
			),
		];

		await env.DB.batch(statements);

		return jsonResponse({
			success: true,
			guest_session_id: sessionId,
			result_id: resultId,
		}, 201);
	} catch (error) {
		return jsonResponse({
			error: "Failed to save guest test result",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}

// ===== Handler：POST /v1/auth/login =====

interface LoginRequestBody {
	email?: string;
	password?: string;
}

interface ParentRow {
	id: string;
	email: string;
	password_hash: string;
	email_verified: number;
	status: string;
	created_at: number;
}

interface ChildRow {
	id: string;
	nickname: string;
	age: number;
	grade: string;
	country: string;
	home_language: string | null;
	home_language_other: string | null;
	created_at: number;
	updated_at: number | null;
	status: string;
}

async function handlePostAuthLogin(request: Request, env: Env): Promise<Response> {
	let body: LoginRequestBody;
	try {
		body = await request.json() as LoginRequestBody;
	} catch {
		return jsonResponse({ error: "Email或密码不正确" }, 401);
	}

	const email = (body.email || "").toString().trim().toLowerCase();
	const password = (body.password || "").toString();

	if (!email || !password) {
		return jsonResponse({ error: "Email或密码不正确" }, 401);
	}

	if (!env.SESSION_SECRET) {
		return jsonResponse({ error: "服务配置错误" }, 500);
	}

	try {
		const parentResult = await env.DB.prepare(
			"SELECT id, email, password_hash, email_verified, status, created_at FROM parents WHERE email = ?"
		).bind(email).all<ParentRow>();

		const parent = parentResult.results?.[0];

		if (!parent) {
			return jsonResponse({ error: "Email或密码不正确" }, 401);
		}

		if (parent.status !== "active") {
			return jsonResponse({ error: "账户已被禁用，请联系管理员" }, 403);
		}

		if (!parent.password_hash) {
			return jsonResponse({ error: "账户需要设置密码，请使用忘记密码功能" }, 401);
		}

		const passwordValid = await verifyPassword(password, parent.password_hash);
		if (!passwordValid) {
			return jsonResponse({ error: "Email或密码不正确" }, 401);
		}

		const childrenResult = await env.DB.prepare(
			`SELECT id, nickname, age, grade, country, home_language, home_language_other,
					 created_at, updated_at, status
			 FROM children
			 WHERE parent_id = ? AND status = 'active'
			 ORDER BY created_at ASC`
		).bind(parent.id).all<ChildRow>();

		const children = childrenResult.results || [];

		const sessionToken = await signSession(
			{ parent_id: parent.id },
			env.SESSION_SECRET
		);

		const userOut = {
			id: parent.id,
			email: parent.email,
			email_verified: parent.email_verified === 1,
			created_at: parent.created_at,
		};

		const childrenOut = children.map((c) => ({
			id: c.id,
			nickname: c.nickname,
			age: c.age,
			grade: c.grade,
			country: c.country,
			home_language: c.home_language,
			home_language_other: c.home_language_other,
			created_at: c.created_at,
			updated_at: c.updated_at,
			status: c.status,
		}));

		const cookie = createSessionCookie(sessionToken);

		return jsonResponse(
			{
				success: true,
				session: sessionToken,
				user: userOut,
				children: childrenOut,
			},
			200,
			{
				"Set-Cookie": cookie,
			}
		);
	} catch (error) {
		console.error("[Login] error:", error instanceof Error ? error.message : "Unknown");
		return jsonResponse(
			{ error: "登录失败，请稍后重试" },
			500
		);
	}
}

// ===== 主入口 =====

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// CORS headers
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, X-SRC-Service-Key",
		};

		// CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		// GET /health — 只读健康检查
		if (path === "/health" && request.method === "GET") {
			try {
				const result = await env.DB.prepare("SELECT 1 as ok").run();
				const row = result.results?.[0] as { ok: number } | undefined;
				return jsonResponse({
					status: "ok",
					database: "src-primary-database",
					query: row?.ok === 1 ? "verified" : "unknown",
				}, 200, corsHeaders);
			} catch (error) {
				return jsonResponse({
					status: "error",
					database: "src-primary-database",
					message: error instanceof Error ? error.message : "Unknown error",
				}, 500, corsHeaders);
			}
		}

		// ===== /v1/* — 业务 API（需要 Service Key 鉴权） =====
		if (path.startsWith("/v1/")) {
			// Service Key 鉴权
			if (!verifyServiceKey(request, env)) {
				return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
			}

			// POST /v1/guest/test-result
			if (path === "/v1/guest/test-result" && request.method === "POST") {
				return handlePostGuestTestResult(request, env);
			}

			// POST /v1/auth/login
			if (path === "/v1/auth/login" && request.method === "POST") {
				return handlePostAuthLogin(request, env);
			}

			// v1 404
			return jsonResponse({ error: "Not found", path }, 404, corsHeaders);
		}

		// 根路径 404
		return jsonResponse({ error: "Not found", path }, 404, corsHeaders);
	},
};
