/**
 * SRC Primary Database - Cloudflare Worker
 *
 * 目标架构：
 *   Vercel Production → Cloudflare Worker → D1「SRC Primary Database」
 */

import { verifyPassword, hashPassword } from "./password";
import { runPbkdf2Diagnostic, runPbkdf2Sha512Diagnostic } from "./pbkdf2-diag";
import { runArgon2BatchDiagnostic, runArgon2VerifyDiagnostic } from "./argon2-diag";
import { runArgon2WasmBatchDiagnostic } from "./argon2-wasm-diag";
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

// ===== Handler：POST /v1/auth/signup =====

interface SignupRequestBody {
	email?: string;
	password?: string;
	nickname?: string;
	age?: number;
	grade?: string;
	country?: string;
	home_language?: string;
	home_language_other?: string;
	guest_session_id?: string;
}

interface GuestSessionRow {
	id: string;
	claimed: number;
	result_data_json: string | null;
}

function isValidEmail(email: string): boolean {
	// 简单但够用的 email 正则
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractLevelNum(val: unknown): number | null {
	if (val === null || val === undefined) return null;
	if (typeof val === "number") return val;
	const m = String(val).match(/(\d+)/);
	return m ? parseInt(m[1], 10) : null;
}

function numToLevel(num: number | null): string | null {
	if (num === null) return null;
	const map: Record<number, string> = { 100: "SRC100", 300: "SRC300", 500: "SRC500", 800: "SRC800" };
	return map[num] || null;
}

async function handlePostAuthSignup(request: Request, env: Env): Promise<Response> {
	let body: SignupRequestBody;
	let signupStep = "start";
	let hashSubstep = "pre_random_bytes"; // TEMP P0-13F-5-AB: 细粒度 password_hash 子步骤追踪
	try {
		body = await request.json() as SignupRequestBody;
	} catch {
		return jsonResponse({ error: "请求数据格式错误" }, 400);
	}

	const email = (body.email || "").toString().trim().toLowerCase();
	const password = (body.password || "").toString();
	const nickname = (body.nickname || "").toString().trim();
	const age = typeof body.age === "number" ? body.age : parseInt(String(body.age || "0"), 10);
	const grade = (body.grade || "").toString().trim();
	const country = (body.country || "").toString().trim();
	const homeLanguage = body.home_language ? String(body.home_language) : null;
	const homeLanguageOther = body.home_language_other ? String(body.home_language_other) : null;
	const guestSessionId = body.guest_session_id ? String(body.guest_session_id) : null;

	// ===== 基础校验 =====
	if (!email || !isValidEmail(email)) {
		return jsonResponse({ error: "请输入有效的Email地址" }, 400);
	}
	if (!password || password.length < 8) {
		return jsonResponse({ error: "密码至少需要8位" }, 400);
	}
	if (!nickname) {
		return jsonResponse({ error: "请输入孩子昵称" }, 400);
	}
	if (!age || age < 3 || age > 18) {
		return jsonResponse({ error: "请选择有效的年龄" }, 400);
	}
	if (!grade) {
		return jsonResponse({ error: "请选择年级" }, 400);
	}
	if (!country) {
		return jsonResponse({ error: "请选择国家/地区" }, 400);
	}

	if (!env.SESSION_SECRET) {
		return jsonResponse({ error: "服务配置错误" }, 500);
	}

	try {
		// ===== Email 查重 =====
		signupStep = "email_lookup";
		const existing = await env.DB.prepare(
			"SELECT id FROM parents WHERE email = ?"
		).bind(email).first<{ id: string }>();

		if (existing) {
			return jsonResponse({ error: "这个邮箱已经注册，请直接登录" }, 409);
		}

		// ===== 密码哈希 =====
		signupStep = "password_hash";
		hashSubstep = "pre_random_bytes";
		const passwordHash = await hashPassword(password, (sub) => {
			hashSubstep = sub;
		});

		// ===== 生成 IDs =====
		const parentId = crypto.randomUUID();
		const childId = crypto.randomUUID();
		const nowTs = nowUnix();

		// ===== Guest Claim 预校验 =====
		let guestClaimData: {
			sessionId: string;
			resultObj: Record<string, unknown>;
			charL: number | null;
			charU: number | null;
			wordL: number | null;
			wordU: number | null;
			readingBase: number | null;
			confidence: string;
			recommendedLevel: string;
			totalQuestions: number;
			correctCount: number;
			estimatedLevel: string | null;
			resultJson: string;
			assessmentId: string;
		} | null = null;

		if (guestSessionId) {
			signupStep = "guest_session_lookup";
			const guestRow = await env.DB.prepare(
				"SELECT id, claimed, result_data_json FROM guest_test_sessions WHERE id = ?"
			).bind(guestSessionId).first<GuestSessionRow>();

			if (!guestRow) {
				return jsonResponse({ error: "测试结果无效或已被绑定，请重新测试" }, 400);
			}
			if (guestRow.claimed !== 0) {
				return jsonResponse({ error: "测试结果无效或已被绑定，请重新测试" }, 400);
			}
			if (!guestRow.result_data_json) {
				return jsonResponse({ error: "测试结果无效或已被绑定，请重新测试" }, 400);
			}

			let resultObj: Record<string, unknown>;
			try {
				signupStep = "guest_result_parse";
				resultObj = JSON.parse(guestRow.result_data_json) as Record<string, unknown>;
			} catch {
				return jsonResponse({ error: "测试结果无效或已被绑定，请重新测试" }, 400);
			}
			if (!resultObj || typeof resultObj !== "object") {
				return jsonResponse({ error: "测试结果无效或已被绑定，请重新测试" }, 400);
			}

			signupStep = "guest_result_process";
			const charL = extractLevelNum(resultObj.characterLevelLower);
			const charU = extractLevelNum(resultObj.characterLevelUpper || resultObj.characterLevel);
			const wordL = extractLevelNum(resultObj.wordLevelLower);
			const wordU = extractLevelNum(resultObj.wordLevelUpper || resultObj.wordLevel);
			const readingBase = extractLevelNum(resultObj.readingBaseLevel);
			const confidence = resultObj.confidence && ["high", "medium", "low"].includes(String(resultObj.confidence))
				? String(resultObj.confidence)
				: "medium";
			const recommendedLevel = numToLevel(readingBase) || "SRC100";
			const totalQuestions = typeof resultObj.totalQuestions === "number" ? resultObj.totalQuestions : 0;

			// 从 levelResults 或 answers 估算正确数（如果没有 correct 字段，保守设为 0）
			let correctCount = 0;
			if (Array.isArray(resultObj.answers)) {
				correctCount = resultObj.answers.filter((a: any) =>
					typeof a?.correct === "boolean" ? a.correct : a?.userAnswer === true
				).length;
			}

			const estimatedLevel = numToLevel(readingBase);
			const assessmentId = crypto.randomUUID();

			guestClaimData = {
				sessionId: guestRow.id,
				resultObj,
				charL,
				charU,
				wordL,
				wordU,
				readingBase,
				confidence,
				recommendedLevel,
				totalQuestions,
				correctCount,
				estimatedLevel,
				resultJson: guestRow.result_data_json,
				assessmentId,
			};
		}

		// ===== 原子写入 =====
		signupStep = "prepare_batch";
		const statements: D1PreparedStatement[] = [];

		// 1. INSERT parent
		statements.push(
			env.DB.prepare(
				`INSERT INTO parents (id, email, password_hash, email_verified, status, created_at)
				 VALUES (?, ?, ?, 1, 'active', ?)`
			).bind(parentId, email, passwordHash, nowTs)
		);

		// 2. INSERT child
		const childAssessmentStatus = guestClaimData ? "quick_done" : "not_started";
		const childEstimatedLevel = guestClaimData?.estimatedLevel || null;

		statements.push(
			env.DB.prepare(
				`INSERT INTO children
					(id, parent_id, nickname, age, grade, country,
					 home_language, home_language_other, status,
					 assessment_status, estimated_level, confirmed_level, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?)`
			).bind(
				childId,
				parentId,
				nickname,
				age,
				grade,
				country,
				homeLanguage,
				homeLanguageOther,
				childAssessmentStatus,
				childEstimatedLevel,
				nowTs
			)
		);

		// 3. Guest Claim: UPDATE guest_test_sessions + INSERT quick_assessment_results
		if (guestClaimData) {
			statements.push(
				env.DB.prepare(
					`UPDATE guest_test_sessions
					 SET claimed = 1, child_id = ?
					 WHERE id = ?`
				).bind(childId, guestClaimData.sessionId)
			);

			statements.push(
				env.DB.prepare(
					`INSERT INTO quick_assessment_results
						(id, child_id, guest_session_id,
						 character_level_l, character_level_u,
						 word_level_l, word_level_u, reading_base,
						 confidence, recommended_level,
						 total_questions, correct_count,
						 raw_result_json, completed_at, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				).bind(
					guestClaimData.assessmentId,
					childId,
					guestClaimData.sessionId,
					guestClaimData.charL,
					guestClaimData.charU,
					guestClaimData.wordL,
					guestClaimData.wordU,
					guestClaimData.readingBase,
					guestClaimData.confidence,
					guestClaimData.recommendedLevel,
					guestClaimData.totalQuestions,
					guestClaimData.correctCount,
					guestClaimData.resultJson,
					nowTs,
					nowTs
				)
			);
		}

		// 执行 batch
		signupStep = "db_batch";
		await env.DB.batch(statements);

		// ===== 生成 Session =====
		signupStep = "session_sign";
		const sessionToken = await signSession(
			{ parent_id: parentId },
			env.SESSION_SECRET
		);

		// ===== 构造返回 =====
		const userOut = {
			id: parentId,
			email,
			email_verified: true,
			created_at: nowTs,
		};

		const childOut = {
			id: childId,
			nickname,
			age,
			grade,
			country,
			home_language: homeLanguage,
			home_language_other: homeLanguageOther,
			status: "active",
			assessment_status: childAssessmentStatus,
			estimated_level: childEstimatedLevel,
			confirmed_level: null,
			created_at: nowTs,
			updated_at: null,
		};

		const cookie = createSessionCookie(sessionToken);

		return jsonResponse(
			{
				success: true,
				session: sessionToken,
				user: userOut,
				child: childOut,
				children: [childOut],
			},
			200,
			{
				"Set-Cookie": cookie,
			}
		);
	} catch (error) {
		// UNIQUE constraint on email = 并发重复注册
		const msg = error instanceof Error ? error.message : "Unknown";
		if (msg.includes("UNIQUE constraint failed: parents.email")) {
			return jsonResponse({ error: "这个邮箱已经注册，请直接登录" }, 409);
		}
		const errName = error instanceof Error ? error.name : "Unknown";
		// 安全分类：只输出 step + name + 通用类别，不输出 message 原文（可能含敏感信息）
		let errCategory = "unknown";
		if (msg.includes("D1") || msg.includes("SQLITE") || msg.includes("database") || msg.includes("batch")) {
			errCategory = "database";
		} else if (msg.includes("crypto") || msg.includes("CryptoKey") || msg.includes("HMAC")) {
			errCategory = "crypto";
		} else if (msg.includes("fetch") || msg.includes("network")) {
			errCategory = "network";
		} else if (msg.includes("JSON")) {
			errCategory = "json_parse";
		} else if (msg.includes("session") || msg.includes("SESSION_SECRET")) {
			errCategory = "session";
		}
		console.error(
			"[signup-error] " +
			"step=" + signupStep + " " +
			"name=" + errName + " " +
			"category=" + errCategory +
			(signupStep === "password_hash" ? " substep=" + hashSubstep : "")
		);
		return jsonResponse(
			{
				error: "注册失败，请稍后重试",
				debug: {
					step: signupStep,
					name: errName,
					category: errCategory,
					...(signupStep === "password_hash" ? { substep: hashSubstep } : {}),
				},
			},
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
			"Access-Control-Allow-Headers": "Content-Type, X-SRC-Service-Key, X-Diag-Password",
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

			// POST /v1/auth/signup
			if (path === "/v1/auth/signup" && request.method === "POST") {
				return handlePostAuthSignup(request, env);
			}

			// v1 404
			return jsonResponse({ error: "Not found", path }, 404, corsHeaders);
		}

		// ===== /debug/* — 只读诊断端点（需要 Service Key 鉴权）=====
		// 用于定位 Production 密码学运行时问题，不修改业务数据
		if (path.startsWith("/debug/")) {
			if (!verifyServiceKey(request, env)) {
				return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
			}

			// GET /debug/pbkdf2?iterations=200000
			if (path === "/debug/pbkdf2" && request.method === "GET") {
				const itersParam = url.searchParams.get("iterations");
				const iterations = itersParam ? parseInt(itersParam, 10) : 1000;
				if (isNaN(iterations) || iterations <= 0) {
					return jsonResponse(
						{ error: "Invalid iterations parameter" },
						400,
						corsHeaders,
					);
				}
				const result = await runPbkdf2Diagnostic(iterations);
				return jsonResponse(result, 200, corsHeaders);
			}

			// GET /debug/pbkdf2/batch?list=1000,10000,100000,200000
			if (path === "/debug/pbkdf2/batch" && request.method === "GET") {
				const listParam = url.searchParams.get("list") || "1000,10000,100000,200000";
				const iterationsList = listParam
					.split(",")
					.map((s) => parseInt(s.trim(), 10))
					.filter((n) => !isNaN(n) && n > 0);

				const results = [];
				for (const iters of iterationsList) {
					results.push(await runPbkdf2Diagnostic(iters));
				}
				return jsonResponse(
					{ algorithm: "PBKDF2", hash: "SHA-256", saltBytes: 16, outputBits: 256, results },
					200,
					corsHeaders,
				);
			}
				// GET /debug/pbkdf2/sha512?iterations=100000
				if (path === "/debug/pbkdf2/sha512" && request.method === "GET") {
					const itersParam = url.searchParams.get("iterations");
					const iterations = itersParam ? parseInt(itersParam, 10) : 100000;
					if (isNaN(iterations) || iterations <= 0) {
						return jsonResponse(
							{ error: "Invalid iterations parameter" },
							400,
							corsHeaders,
						);
					}
					const result = await runPbkdf2Sha512Diagnostic(iterations);
					return jsonResponse(result, 200, corsHeaders);
				}

				// GET /debug/pbkdf2/sha512/batch?list=100000,100001
				if (path === "/debug/pbkdf2/sha512/batch" && request.method === "GET") {
					const listParam = url.searchParams.get("list") || "100000,100001";
					const iterationsList = listParam
						.split(",")
						.map((s) => parseInt(s.trim(), 10))
						.filter((n) => !isNaN(n) && n > 0);

					const results = [];
					for (const iters of iterationsList) {
						results.push(await runPbkdf2Sha512Diagnostic(iters));
					}
					return jsonResponse(
						{ algorithm: "PBKDF2", hash: "SHA-512", saltBytes: 16, outputBits: 512, results },
						200,
						corsHeaders,
					);
				}
				// GET /debug/argon2 - Argon2id WASM 可行性诊断
				if (path === "/debug/argon2" && request.method === "GET") {
					const result = await runArgon2BatchDiagnostic();
					return jsonResponse(result, 200, corsHeaders);
				}

				// GET /debug/argon2/verify - Argon2id hash+verify 诊断
				if (path === "/debug/argon2/verify" && request.method === "GET") {
					const result = await runArgon2VerifyDiagnostic();
					return jsonResponse(result, 200, corsHeaders);
				}
				// GET /debug/argon2-wasm - 预编译 WASM 版 Argon2id 可行性诊断
				if (path === "/debug/argon2-wasm" && request.method === "GET") {
					const result = await runArgon2WasmBatchDiagnostic();
					return jsonResponse(result, 200, corsHeaders);
				}



			return jsonResponse({ error: "Not found", path }, 404, corsHeaders);
		}

		// 根路径 404
		return jsonResponse({ error: "Not found", path }, 404, corsHeaders);
	},
};
