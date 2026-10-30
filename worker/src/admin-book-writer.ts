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
import { calculateGrowthMap } from "./growth-map";
import type { GrowthMapData } from "./growth-map";

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

	// source 以 generation_params.source 为准（manual / ai），缺失时按 manual 兼容历史数据
	const source =
		generation_params &&
		typeof generation_params === "object" &&
		typeof (generation_params as Record<string, unknown>).source === "string"
			? ((generation_params as Record<string, unknown>).source as string)
			: "manual";

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
		source,
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

		// 2. 默认 seed：每页 text = original_text（同三元组无历史版本时使用）
		let pagesJson: RewritePage[] = masterPages.map((p) => ({
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

		let uniqueChars = uniqueCharsSet.size;
		let frontierTargetsJson = JSON.stringify([]);
		let basedOnVersion: number | null = null;
		let basedOnRewriteId: number | null = null;

		const childId = body.child_id?.trim() || null;

		// 4. child_id 有值时，优先继承同 (child + episode + target_level) 最新版本，
		//    完整保留人工编辑后的 text / frontier，绝不静默回 Master 丢稿。
		//    查询严格限定三元组：首次建 SRC300 不会继承已存在的 SRC500。
		if (childId) {
			const prior = await env.DB.prepare(
				`SELECT id, version, pages_json, frontier_targets_json,
				        total_chars, unique_chars, max_page_chars
				   FROM book_rewrite_versions
				  WHERE child_id = ? AND episode_id = ? AND target_level = ?
				  ORDER BY version DESC, id DESC
				  LIMIT 1`
			)
				.bind(childId, episodeId, targetLevel)
				.first<{
					id: number;
					version: number;
					pages_json: string;
					frontier_targets_json: string | null;
					total_chars: number;
					unique_chars: number;
					max_page_chars: number;
				}>();

			if (prior) {
				// 损坏 / 非数组：明确失败并停止，绝不静默回 Master（否则仍会丢人工编辑）
				let inherited: unknown;
				try {
					inherited = JSON.parse(prior.pages_json);
				} catch {
					return jsonResponse(
						{
							error: "Previous same-level rewrite pages_json is corrupted; aborting draft creation",
							based_on_rewrite_id: prior.id,
						},
						422
					);
				}
				if (!Array.isArray(inherited)) {
					return jsonResponse(
						{
							error: "Previous same-level rewrite pages_json is not an array; aborting draft creation",
							based_on_rewrite_id: prior.id,
						},
						422
					);
				}

				pagesJson = inherited as RewritePage[];
				frontierTargetsJson = prior.frontier_targets_json ?? JSON.stringify([]);
				totalChars = prior.total_chars;
				uniqueChars = prior.unique_chars;
				maxPageChars = prior.max_page_chars;
				basedOnVersion = prior.version;
				basedOnRewriteId = prior.id;
			}
		}

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
			based_on_version: basedOnVersion,
			based_on_rewrite_id: basedOnRewriteId,
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
			frontierTargetsJson,
			JSON.stringify(generationParams),
			null,
			nextVersion,
			childId,
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

// ============================================================
// Admin: Child Reading Profile Detail（AI 个性化改写的档案数据源）
// ============================================================

const READING_PROFILE_LEVEL_ORDER = ["SRC100", "SRC300", "SRC500", "SRC800"] as const;

interface TestResultProfileRow {
	level: string;
	stable_char_count: number | null;
	stable_vocab_count: number | null;
	total_questions: number | null;
	correct_count: number | null;
	known_characters_json: string | null;
	weak_characters_json: string | null;
	completed_at: number | null;
}

function parseJsonStringArray(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
	} catch {
		return [];
	}
}

/**
 * GET /v1/admin/children/:id/reading-profile
 *
 * 从 D1 读取孩子真实阅读档案明细，供 AI 个性化改写使用。
 * - children 基本信息 + confirmed_level
 * - test_results（formal + completed，与 growth-map 同口径）每等级最新一条
 * - known_characters / weak_characters 为各等级实测字表的并集（去重）
 * - 只返回原始计数（total_questions / correct_count），不计算掌握率：
 *   D1 无 mastery_rate 字段，不得把整级测评正确率虚构为单字/单词掌握率。
 */
export async function handleV1AdminChildReadingProfile(
	request: Request,
	env: Env,
	childId: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	if (!childId || childId.length > 64) {
		return jsonResponse({ error: "Invalid child id" }, 400);
	}

	try {
		const childRow = await env.DB.prepare(
			`SELECT id, nickname, age, grade, country, home_language, confirmed_level, status
			 FROM children WHERE id = ?`
		).bind(childId).first<{
			id: string; nickname: string; age: number | null; grade: string | null;
			country: string | null; home_language: string | null;
			confirmed_level: string | null; status: string;
		}>();

		if (!childRow) {
			return jsonResponse({ error: "Child not found" }, 404);
		}

		// 与 growth-map.ts 同口径：仅正式测试（formal）且已完成
		const resultsResp = await env.DB.prepare(
			`SELECT level, stable_char_count, stable_vocab_count,
			        total_questions, correct_count,
			        known_characters_json, weak_characters_json, completed_at
			 FROM test_results
			 WHERE child_id = ? AND test_type = 'formal' AND status = 'completed'
			 ORDER BY completed_at DESC
			 LIMIT 20`
		).bind(childId).all<TestResultProfileRow>();

		// 每等级保留最新一条（查询已按 completed_at DESC 排序）
		const latestByLevel = new Map<string, TestResultProfileRow>();
		for (const row of resultsResp.results || []) {
			if (!latestByLevel.has(row.level)) {
				latestByLevel.set(row.level, row);
			}
		}

		const knownSet = new Set<string>();
		const weakSet = new Set<string>();
		const levels: Record<string, unknown>[] = [];

		for (const lv of READING_PROFILE_LEVEL_ORDER) {
			const r = latestByLevel.get(lv);
			if (!r) continue;
			const knownChars = parseJsonStringArray(r.known_characters_json);
			const weakChars = parseJsonStringArray(r.weak_characters_json);
			for (const c of knownChars) knownSet.add(c);
			for (const c of weakChars) weakSet.add(c);
			levels.push({
				level: lv,
				stable_char_count: r.stable_char_count,
				stable_vocab_count: r.stable_vocab_count,
				total_questions: r.total_questions,
				correct_count: r.correct_count,
				known_characters_count: knownChars.length,
				weak_characters_count: weakChars.length,
				completed_at: r.completed_at
					? new Date(r.completed_at * 1000).toISOString()
					: null,
			});
		}

		return jsonResponse({
			success: true,
			data: {
				child: {
					id: childRow.id,
					nickname: childRow.nickname,
					age: childRow.age,
					grade: childRow.grade,
					country: childRow.country,
					home_language: childRow.home_language,
				},
				confirmed_level: childRow.confirmed_level,
				levels,
				known_characters: Array.from(knownSet),
				weak_characters: Array.from(weakSet),
			},
		});
	} catch (error) {
		console.error("[admin-children] reading profile error:", error);
		return jsonResponse({
			error: "Read reading profile failed",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}

// ============================================================
// Admin: AI Generated Draft（受控写入，status 硬编码 review）
// ============================================================

interface GeneratedDraftBody {
	episode_id: number | string;
	child_id?: string;
	target_level?: string;
	pages?: unknown;
	frontier_targets?: unknown;
	generation_params?: Record<string, unknown>;
	validation_result?: unknown;
}

/**
 * 正式等级字数区间（全书汉字出现次数）。
 * 与 src/lib/book-rewrite/level-rules.ts 的 LEVEL_LANGUAGE_RULES.targetReadingMin/Max 同源：
 * 任一处调整必须同步另一处（Worker 与 Next.js 分属两个运行时，暂无共享模块，刻意保持最小副本，勿扩大为架构重构）。
 */
const LEVEL_TOTAL_HANZI_RANGE: Record<string, { min: number; max: number }> = {
	SRC100: { min: 100, max: 150 },
	SRC300: { min: 300, max: 380 },
	SRC500: { min: 500, max: 600 },
	SRC800: { min: 800, max: 900 },
};

/**
 * POST /v1/admin/rewrite/generated
 *
 * AI 生成稿的唯一落库入口（由 Next.js 编排层在 LLM 生成 + 验证通过后调用）。
 * 安全约束：
 * - status 硬编码 'review'，请求体无法指定，绝不直接生成可 Finalize 之外的状态；
 * - 页数必须与 Master 完全一致；image_url / original_text 强制以 Master 为准回填，
 *   不信任请求体（Master Asset Lock 双保险）；
 * - 幂等：同 (child_id, episode_id, target_level) 已存在活跃版本
 *   （status IN review/ai_draft）时 409 拒绝，不产生重复版本；
 * - generation_params 的 source/tool 由服务端强制覆盖，防止伪造来源；
 * - 只 INSERT 新版本，绝不修改 Master 或任何既有 Rewrite。
 */
export async function handleV1AdminGeneratedDraft(request: Request, env: Env): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	let body: GeneratedDraftBody;
	try {
		body = (await request.json()) as GeneratedDraftBody;
	} catch {
		return jsonResponse({ error: "Invalid JSON body" }, 400);
	}

	const episodeId = Number(body.episode_id);
	if (!Number.isInteger(episodeId) || episodeId <= 0) {
		return jsonResponse({ error: "episode_id required" }, 400);
	}

	const childId = typeof body.child_id === "string" ? body.child_id.trim() : "";
	if (!childId) {
		return jsonResponse({ error: "child_id required" }, 400);
	}

	const targetLevel = body.target_level || "";
	const validLevels = ["SRC100", "SRC300", "SRC500", "SRC800"];
	if (!validLevels.includes(targetLevel)) {
		return jsonResponse({ error: "invalid target_level" }, 400);
	}

	if (!Array.isArray(body.pages) || body.pages.length === 0) {
		return jsonResponse({ error: "pages must be a non-empty array" }, 400);
	}

	// 页结构基础校验：每页必须是 { page: 正整数, text: 非空字符串 }
	const rawPages = body.pages as Record<string, unknown>[];
	for (let i = 0; i < rawPages.length; i++) {
		const p = rawPages[i];
		if (!p || typeof p !== "object") {
			return jsonResponse({ error: `pages[${i}] is not an object` }, 400);
		}
		if (!Number.isInteger(p.page) || (p.page as number) <= 0) {
			return jsonResponse({ error: `pages[${i}].page must be a positive integer` }, 400);
		}
		if (typeof p.text !== "string" || (p.text as string).trim().length === 0) {
			return jsonResponse({ error: `pages[${i}].text must be a non-empty string` }, 400);
		}
	}

	const nowTs = nowUnix();

	try {
		// 1. 读取 Master Pages（结构保护基准）
		const pagesResult = await env.DB.prepare(
			`SELECT page_number, original_text, image_url
			 FROM book_episode_pages
			 WHERE episode_id = ?
			 ORDER BY page_number ASC`
		).bind(episodeId).all<EpisodePageRow>();
		const masterPages = pagesResult.results || [];

		if (masterPages.length === 0) {
			return jsonResponse({ error: "Episode has no pages" }, 404);
		}

		// 2. Master Asset Lock：页数必须一致
		if (rawPages.length !== masterPages.length) {
			return jsonResponse({
				error: `Page count mismatch: master has ${masterPages.length} pages, got ${rawPages.length}`,
			}, 422);
		}

		// 3. 强制以 Master 为准回填 image_url / original_text，页序按 Master 页码对齐
		const masterByPage = new Map(masterPages.map((m) => [m.page_number, m]));
		const pagesJson: RewritePage[] = [];
		for (let i = 0; i < rawPages.length; i++) {
			const expectedPage = i + 1;
			const p = rawPages[i];
			if (p.page !== expectedPage) {
				return jsonResponse({
					error: `Page sequence mismatch at index ${i}: expected page ${expectedPage}, got ${p.page}`,
				}, 422);
			}
			const master = masterByPage.get(expectedPage);
			if (!master) {
				return jsonResponse({ error: `Master page ${expectedPage} missing` }, 422);
			}
			pagesJson.push({
				page: expectedPage,
				text: (p.text as string).trim(),
				frontier: Array.isArray(p.frontier)
					? (p.frontier as unknown[]).filter((f): f is string => typeof f === "string")
					: [],
				image_url: master.image_url || undefined,
				original_text: master.original_text || "",
			});
		}

		// 4. 幂等：同三元组存在活跃版本（review / ai_draft）→ 409，不产生重复版本
		const activeExisting = await env.DB.prepare(
			`SELECT id, version, status
			 FROM book_rewrite_versions
			 WHERE child_id = ? AND episode_id = ? AND target_level = ?
			   AND status IN ('review', 'ai_draft')
			 ORDER BY version DESC, id DESC
			 LIMIT 1`
		).bind(childId, episodeId, targetLevel).first<{
			id: number; version: number; status: string;
		}>();

		if (activeExisting) {
			return jsonResponse({
				error: "Active draft already exists for this child/episode/level; reject or edit it first",
				existing_rewrite_id: activeExisting.id,
				existing_version: activeExisting.version,
				existing_status: activeExisting.status,
			}, 409);
		}

		// 5. 统计（与 manual 同口径：总字符按 Array.from，独立字仅 CJK）
		let totalChars = 0;
		let totalHanzi = 0;
		const uniqueCharsSet = new Set<string>();
		let maxPageChars = 0;
		for (const page of pagesJson) {
			const chars = Array.from(page.text);
			totalChars += chars.length;
			if (chars.length > maxPageChars) maxPageChars = chars.length;
			for (const ch of chars) {
				// 只统计 CJK 统一汉字（与 manual 同口径）
				if (ch >= "一" && ch <= "鿿") {
					uniqueCharsSet.add(ch);
				}
				// 汉字出现次数：与 Next.js validation.ts countChineseChars 同区间 [一-龥]，
				// 供下方阅读量硬校验使用（服务端独立可信校验，不信任客户端字数）
				if (ch >= "一" && ch <= "龥") {
					totalHanzi++;
				}
			}
		}

		// 5.5 服务端硬校验（57N-4）：正式字数区间 + validation_result 完整性。
		// 任一不满足 → 422，零写入；其余启发式单项（语言难度/图文一致性等）允许 passed=false
		// 进入人工审核，原始 validation_result 原样存储、不做任何修改。
		const range = LEVEL_TOTAL_HANZI_RANGE[targetLevel];
		if (totalHanzi < range.min || totalHanzi > range.max) {
			return jsonResponse({
				error: `Reading volume out of range for ${targetLevel}: ${totalHanzi} hanzi, expected ${range.min}-${range.max}`,
				total_hanzi: totalHanzi,
				expected_min: range.min,
				expected_max: range.max,
			}, 422);
		}

		const vr = body.validation_result;
		if (!vr || typeof vr !== "object" || Array.isArray(vr)) {
			return jsonResponse({ error: "validation_result must be an object" }, 422);
		}
		const vrObj = vr as Record<string, unknown>;
		if (typeof vrObj.overall_pass !== "boolean") {
			return jsonResponse({ error: "validation_result.overall_pass must be a boolean" }, 422);
		}
		if (vrObj.overall_pass !== true) {
			return jsonResponse({ error: "validation_result.overall_pass must be true" }, 422);
		}
		if (!Array.isArray(vrObj.items)) {
			return jsonResponse({ error: "validation_result.items must be an array" }, 422);
		}
		// 阅读量项为硬校验项：按稳定标识 name === '阅读量' 精确匹配；
		// 缺失或重复均拒绝——不因名称变化而静默放行。
		const volumeItems = (vrObj.items as unknown[]).filter(
			(item): item is Record<string, unknown> =>
				!!item && typeof item === "object" && (item as Record<string, unknown>).name === "阅读量"
		);
		if (volumeItems.length === 0) {
			return jsonResponse({ error: "validation_result missing reading-volume item (name '阅读量')" }, 422);
		}
		if (volumeItems.length > 1) {
			return jsonResponse({ error: "validation_result has duplicate reading-volume items" }, 422);
		}
		if (typeof volumeItems[0].passed !== "boolean") {
			return jsonResponse({ error: "reading-volume item 'passed' must be a boolean" }, 422);
		}
		if (volumeItems[0].passed !== true) {
			return jsonResponse({ error: "reading-volume validation must pass" }, 422);
		}

		// 6. version = episode 维度 MAX+1
		const versionRow = await env.DB.prepare(
			`SELECT COALESCE(MAX(version), 0) + 1 AS next_version
			 FROM book_rewrite_versions
			 WHERE episode_id = ?`
		).bind(episodeId).first<{ next_version: number }>();
		const nextVersion = versionRow?.next_version || 1;

		// 7. generation_params：source/tool 服务端强制覆盖，防止伪造来源
		const generationParams = {
			...(body.generation_params && typeof body.generation_params === "object"
				? body.generation_params
				: {}),
			source: "ai",
			tool: "book-writer-ai",
			child_id: childId,
			target_level: targetLevel,
			created_at: new Date(nowTs * 1000).toISOString(),
		};

		const frontierTargetsJson = JSON.stringify(
			Array.isArray(body.frontier_targets)
				? (body.frontier_targets as unknown[]).filter((f): f is string => typeof f === "string")
				: []
		);

		const validationResultJson =
			body.validation_result && typeof body.validation_result === "object"
				? JSON.stringify(body.validation_result)
				: null;

		// 8. INSERT（status 硬编码 review；只新增，不触碰任何既有记录）
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
			frontierTargetsJson,
			JSON.stringify(generationParams),
			validationResultJson,
			nextVersion,
			childId,
			totalChars,
			uniqueCharsSet.size,
			maxPageChars,
			nowTs,
		).first<RewriteRow>();

		if (!insertResult) {
			return jsonResponse({ error: "Failed to create generated draft" }, 500);
		}

		return jsonResponse({
			rewrite_id: insertResult.id,
			status: insertResult.status,
			...mapRewriteRow(insertResult),
		}, 201);
	} catch (error) {
		console.error("[admin-rewrites] generated draft error:", error);
		return jsonResponse({
			error: "Create generated draft failed",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}

// ============================================================
// Admin: Child Detail with Reading Profile
// ============================================================

export async function handleV1AdminChildDetail(
	request: Request,
	env: Env,
	childId: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	try {
		const childRow = await env.DB.prepare(
			`SELECT id, parent_id, nickname, age, grade, country, home_language, confirmed_level, assessment_status, status
			 FROM children WHERE id = ?`
		).bind(childId).first() as {
			id: string; parent_id: string; nickname: string; age: number;
			grade: string; country: string; home_language: string;
			confirmed_level: string | null; assessment_status: string | null;
			status: string;
		} | null;

		if (!childRow) {
			return jsonResponse({ error: "Child not found" }, 404);
		}

		let growthMap: GrowthMapData | null = null;
		try {
			growthMap = await calculateGrowthMap(childId, env);
		} catch (gmError) {
			console.warn("[admin-child] growth-map calculation skipped:", gmError);
		}

		return jsonResponse({
			success: true,
			data: {
				child: {
					id: childRow.id,
					nickname: childRow.nickname,
					age: childRow.age,
					grade: childRow.grade,
					country: childRow.country,
					home_language: childRow.home_language,
					status: childRow.status,
				},
				confirmed_level: growthMap?.confirmed_level ?? childRow.confirmed_level,
				stable_char_count:
					(growthMap as any)?.srcMastery?.mastered ?? null,
				stable_vocab_count:
					(growthMap as any)?.vocabularyMastery?.mastered ?? null,
				assessment_status:
					growthMap?.assessment_status ?? childRow.assessment_status ?? "not_started",
				growth_map: growthMap,
			},
		}, 200);
	} catch (error) {
		console.error("[admin-child] detail error:", error);
		return jsonResponse({
			error: "Failed to get child detail",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}

// ============================================================
// Admin: Episodes List (Master Story)
// ============================================================

export async function handleV1AdminEpisodesList(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	try {
		const url = new URL(request.url);
		const status = url.searchParams.get("status");

		let sql = `SELECT id, series_name, episode_number, episode_title, page_count,
		                  level_tier, status, cover_image_url, description, total_words,
		                  created_at, updated_at
		           FROM book_episodes`;
		const params: (string | number)[] = [];

		if (status) {
			sql += ` WHERE status = ?`;
			params.push(status);
		}

		sql += ` ORDER BY id DESC LIMIT 100`;

		const { results } = await env.DB.prepare(sql).bind(...params).all();

		return jsonResponse({
			success: true,
			data: results,
			total: results?.length ?? 0,
		}, 200);
	} catch (error) {
		console.error("[admin-episodes] list error:", error);
		return jsonResponse({
			error: "Failed to list episodes",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}

// ============================================================
// Admin: Episode Pages (Master Pages)
// ============================================================

export async function handleV1AdminEpisodePages(
	request: Request,
	env: Env,
	episodeId: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	try {
		const episodeRow = await env.DB.prepare(
			`SELECT id, series_name, episode_title FROM book_episodes WHERE id = ?`
		).bind(episodeId).first() as { id: number; series_name: string; episode_title: string } | null;

		if (!episodeRow) {
			return jsonResponse({ error: "Episode not found" }, 404);
		}

		const { results } = await env.DB.prepare(
			`SELECT id, page_number, image_url, original_text,
			        new_chars_json, total_chars, unique_chars
			 FROM book_episode_pages
			 WHERE episode_id = ?
			 ORDER BY page_number ASC`
		).bind(episodeId).all();

		const pages = (results || []).map((p: any) => ({
			page: p.page_number,
			text: p.original_text,
			original_text: p.original_text,
			image_url: p.image_url,
			frontier: [],
		}));

		return jsonResponse({
			success: true,
			data: {
				episode: episodeRow,
				pages,
			},
		}, 200);
	} catch (error) {
		console.error("[admin-episodes] pages error:", error);
		return jsonResponse({
			error: "Failed to get episode pages",
			message: error instanceof Error ? error.message : "Unknown error",
		}, 500);
	}
}
