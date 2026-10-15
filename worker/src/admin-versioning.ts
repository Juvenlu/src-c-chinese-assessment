/**
 * Admin 绘本版本管理 — HTTP Handlers（Worker 侧）
 *
 * P3-H-12C 新增端点（均为 /v1/admin 前缀，外层 Service Key + x-admin-password 双鉴权）：
 *
 *   GET  /v1/admin/children/:childId/episodes/:episodeId/versions
 *        管理员版本列表（final rewrites + custom_books 状态/推送/记录计数）
 *   POST /v1/admin/rewrite/:rewriteId/activate
 *        显式设为某孩子该集的唯一正式版（body: {child_id, episode_id}）
 *   POST /v1/admin/custom-books/:id/archive
 *   POST /v1/admin/custom-books/:id/restore
 *   POST /v1/admin/custom-books/:id/delete        软删除（body: {confirm:boolean}）
 *   POST /v1/admin/custom-books/:id/push          推送（置“新”）
 *
 * 所有操作先校验归属/状态，再经 version-store 原子写。不修改绘本文字与图片。
 */

import { verifyAdminPassword } from "./admin-auth";
import { createD1DBAdapter } from "./d1-adapter";
import type { Env } from "./types";
import {
	activateVersion,
	archiveVersion,
	listVersions,
	markFirstViewed,
	previewDelete,
	pushVersion,
	restoreVersion,
	softDeleteVersion,
} from "./version-store";

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function nowUnix(): number {
	return Math.floor(Date.now() / 1000);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
	try {
		return (await request.json()) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function asPositiveInt(v: unknown): number | null {
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : null;
}

// ============================================================
// GET 版本列表
// ============================================================

export async function handleAdminListVersions(
	request: Request,
	env: Env,
	childId: string,
	episodeIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	const episodeId = asPositiveInt(episodeIdStr);
	if (!episodeId || !childId) {
		return jsonResponse({ error: "Invalid child or episode" }, 400);
	}

	// 归属核验：child 必须存在（管理员视角不强制 parent，但记录孩子维度）
	const child = await env.DB.prepare(
		`SELECT id, nickname FROM children WHERE id = ?`,
	).bind(childId).first<{ id: string; nickname: string }>();
	if (!child) return jsonResponse({ error: "Child not found" }, 404);

	const adapter = createD1DBAdapter(env.DB);
	const versions = await listVersions(adapter, childId, episodeId);
	const activeCount = versions.filter((v) => v.book_status === "active").length;
	return jsonResponse({
		data: {
			child_id: childId,
			nickname: child.nickname,
			episode_id: episodeId,
			active_count: activeCount,
			versions,
		},
	});
}

// ============================================================
// POST 设为正式版
// ============================================================

export async function handleAdminActivate(
	request: Request,
	env: Env,
	rewriteIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	const rewriteId = asPositiveInt(rewriteIdStr);
	if (!rewriteId) return jsonResponse({ error: "Invalid rewrite id" }, 400);

	const body = await readJson(request);
	const childId = typeof body.child_id === "string" ? body.child_id.trim() : "";
	const episodeId = asPositiveInt(body.episode_id);
	if (!childId || !episodeId) {
		return jsonResponse({ error: "child_id and episode_id required" }, 400);
	}

	const adapter = createD1DBAdapter(env.DB);
	const res = await activateVersion(adapter, nowUnix(), { childId, episodeId, rewriteId });
	if (!res.ok) return jsonResponse({ error: res.error, extra: res.extra }, res.status);
	return jsonResponse({ data: { ...res.data, rewrite_id: rewriteId, status: "active" } });
}

// ============================================================
// POST 归档
// ============================================================

export async function handleAdminArchive(
	request: Request,
	env: Env,
	bookIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	const bookId = asPositiveInt(bookIdStr);
	if (!bookId) return jsonResponse({ error: "Invalid book id" }, 400);

	const adapter = createD1DBAdapter(env.DB);
	const res = await archiveVersion(adapter, nowUnix(), bookId);
	if (!res.ok) return jsonResponse({ error: res.error }, res.status);
	return jsonResponse({ data: res.data });
}

// ============================================================
// POST 恢复
// ============================================================

export async function handleAdminRestore(
	request: Request,
	env: Env,
	bookIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	const bookId = asPositiveInt(bookIdStr);
	if (!bookId) return jsonResponse({ error: "Invalid book id" }, 400);

	const adapter = createD1DBAdapter(env.DB);
	const res = await restoreVersion(adapter, nowUnix(), bookId);
	if (!res.ok) return jsonResponse({ error: res.error }, res.status);
	return jsonResponse({ data: res.data });
}

// ============================================================
// POST 软删除（confirm=false 仅预检查；confirm=true 执行）
// ============================================================

export async function handleAdminDelete(
	request: Request,
	env: Env,
	bookIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	const bookId = asPositiveInt(bookIdStr);
	if (!bookId) return jsonResponse({ error: "Invalid book id" }, 400);

	const body = await readJson(request);
	const confirm = body.confirm === true;
	const adapter = createD1DBAdapter(env.DB);
	const res = await softDeleteVersion(adapter, nowUnix(), bookId, confirm);
	if (!res.ok) {
		// 428 = 需要二次确认，携带依赖计数
		return jsonResponse({ error: res.error, extra: res.extra }, res.status);
	}
	return jsonResponse({ data: res.data });
}

/** GET 仅预检查依赖（不修改任何数据），便于管理后台在二次确认弹窗中展示 */
export async function handleAdminDeletePreview(
	request: Request,
	env: Env,
	bookIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	const bookId = asPositiveInt(bookIdStr);
	if (!bookId) return jsonResponse({ error: "Invalid book id" }, 400);

	const adapter = createD1DBAdapter(env.DB);
	const res = await previewDelete(adapter, bookId);
	if (!res.ok) return jsonResponse({ error: res.error }, res.status);
	return jsonResponse({ data: res.data });
}

// ============================================================
// POST 推送（置“新”）
// ============================================================

export async function handleAdminPush(
	request: Request,
	env: Env,
	bookIdStr: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	const bookId = asPositiveInt(bookIdStr);
	if (!bookId) return jsonResponse({ error: "Invalid book id" }, 400);

	const adapter = createD1DBAdapter(env.DB);
	const res = await pushVersion(adapter, nowUnix(), bookId);
	if (!res.ok) return jsonResponse({ error: res.error, extra: res.extra }, res.status);
	return jsonResponse({ data: res.data });
}

/**
 * 孩子打开正式版时标记首次查看（内部复用，供 custom-books 详情调用）。
 * best-effort：任何失败都不应阻断阅读。
 */
export async function markCustomBookFirstViewed(env: Env, customBookId: number): Promise<void> {
	try {
		const adapter = createD1DBAdapter(env.DB);
		await markFirstViewed(adapter, nowUnix(), customBookId);
	} catch (error) {
		console.error("[admin-versioning] markFirstViewed failed:", error);
	}
}
