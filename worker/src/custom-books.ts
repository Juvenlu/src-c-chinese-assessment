/**
 * Custom Books — D1 实现
 *
 * GET  /v1/books/custom?child_id=xxx   孩子的定制绘本列表（需登录 + 归属校验）
 * GET  /v1/books/custom/:id            单本定制绘本详情（含 pages_json，需登录 + 归属校验）
 *
 * Auth: HMAC Session Cookie → getSessionFromRequest
 * Ownership: custom_books → child → parent_id 校验
 */

import { getSessionFromRequest } from './session';
import type { Env } from './types';

/** D1 行 → 前端 custom book 列表项（时间戳转 ISO string） */
function rowToBookListItem(row: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (k === 'created_at' || k === 'updated_at' || k === 'finalized_at') {
			result[k] = v ? new Date((v as number) * 1000).toISOString() : null;
		} else {
			result[k] = v;
		}
	}
	// 组装 episodes 对象（保持与原 Supabase API contract 一致）
	result.episodes = {
		series_name: row.series_name,
		episode_number: row.episode_number,
		episode_title: row.episode_title,
	};
	return result;
}

/**
 * 校验 child 归属：child_id → children.parent_id
 * 返回 { ok: true, childId } 或 { ok: false, error, status }
 */
async function verifyChildOwnership(
	env: Env,
	parentId: string,
	childId: string,
): Promise<{ ok: true; childId: string } | { ok: false; error: string; status: number }> {
	const row = await env.DB.prepare(`
		SELECT id, parent_id, status
		  FROM children
		 WHERE id = ?1
	`).bind(childId).first<Record<string, unknown>>();

	if (!row) {
		return { ok: false, error: 'Child not found', status: 404 };
	}
	if (row.status !== 'active') {
		return { ok: false, error: 'Child not active', status: 403 };
	}
	if (row.parent_id !== parentId) {
		return { ok: false, error: 'Forbidden', status: 403 };
	}
	return { ok: true, childId };
}

/**
 * GET /v1/books/custom?child_id=xxx
 *
 * 返回当前孩子的 active 定制绘本列表。
 * JOIN book_rewrite_versions + book_episodes 补全前端需要的字段。
 */
export async function handleV1CustomBooksList(request: Request, env: Env): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) {
		return Response.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const url = new URL(request.url);
	const childId = url.searchParams.get('child_id');
	if (!childId) {
		return Response.json({ error: 'child_id required' }, { status: 400 });
	}

	// 归属校验
	const ownership = await verifyChildOwnership(env, session.parent_id, childId);
	if (ownership.ok) {
		// 校验通过，继续查询
	} else {
		return Response.json({ error: ownership.error }, { status: ownership.status });
	}

	const { results } = await env.DB.prepare(`
		SELECT cb.id,
		       cb.child_id,
		       cb.rewrite_id,
		       cb.episode_id,
		       cb.level_tier,
		       cb.is_free,
		       cb.status,
		       cb.created_at,
		       cb.updated_at,
		       brv.version,
		       brv.target_level,
		       be.series_name,
		       be.episode_number,
		       be.episode_title
		  FROM custom_books cb
		  JOIN book_rewrite_versions brv ON cb.rewrite_id = brv.id
		  JOIN book_episodes be ON cb.episode_id = be.id
		 WHERE cb.child_id = ?1
		   AND cb.status = 'active'
		 ORDER BY cb.created_at DESC
	`).bind(childId).all<Record<string, unknown>>();

	const data = results.map(rowToBookListItem);
	return Response.json({ data });
}

/**
 * GET /v1/books/custom/:id
 *
 * 返回单本定制绘本详情，含 pages_json。
 * 通过 custom_books.id 查找，先取 child_id 做归属校验。
 */
export async function handleV1CustomBookDetail(request: Request, env: Env, bookId: string): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) {
		return Response.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const idNum = Number(bookId);
	if (!Number.isInteger(idNum) || idNum <= 0) {
		return Response.json({ error: 'Invalid book id' }, { status: 400 });
	}

	// 先取 book 拿到 child_id
	const bookRow = await env.DB.prepare(`
		SELECT cb.*,
		       brv.version,
		       brv.target_level,
		       brv.pages_json,
		       brv.frontier_targets_json,
		       brv.total_chars,
		       brv.unique_chars,
		       brv.max_page_chars,
		       brv.finalized_at,
		       brv.finalized_by,
		       be.series_name,
		       be.episode_number,
		       be.episode_title
		  FROM custom_books cb
		  JOIN book_rewrite_versions brv ON cb.rewrite_id = brv.id
		  JOIN book_episodes be ON cb.episode_id = be.id
		 WHERE cb.id = ?1
		   AND cb.status = 'active'
	`).bind(idNum).first<Record<string, unknown>>();

	if (!bookRow) {
		return Response.json({ error: 'Book not found' }, { status: 404 });
	}

	// 归属校验
	const ownership = await verifyChildOwnership(env, session.parent_id, bookRow.child_id as string);
	if (ownership.ok) {
		// 校验通过，继续返回数据
	} else {
		return Response.json({ error: ownership.error }, { status: ownership.status });
	}

	// pages_json 在 D1 中是 TEXT 存储的 JSON 字符串，需要解析为对象
	let pagesJson: unknown = null;
	if (bookRow.pages_json && typeof bookRow.pages_json === 'string') {
		try {
			pagesJson = JSON.parse(bookRow.pages_json);
		} catch {
			pagesJson = [];
		}
	}

	const result = rowToBookListItem(bookRow);
	// 用解析后的对象替换原始字符串
	result.pages_json = pagesJson;

	return Response.json({ data: result });
}
