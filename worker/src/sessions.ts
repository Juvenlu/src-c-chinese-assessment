/**
 * Sessions — 测试会话管理（Worker 版本）
 *
 * GET    /v1/sessions?child_id=xxx  按孩子查询会话列表
 * POST   /v1/sessions               创建会话
 * PATCH  /v1/sessions/:id           更新会话状态
 *
 * Auth：HMAC Session + child/session ownership
 * 与 children.ts / growth-map.ts 模式一致。
 */

import type { Env, Level } from './types';
import { LEVEL_CONFIG } from './types';
import { getSessionFromRequest } from './session';

const VALID_LEVELS: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
const VALID_STATUSES = ['in_progress', 'completed', 'abandoned'];

/** D1 test_sessions 行 → 前端 TestSession（时间戳转换 + 字段映射） */
function rowToSession(row: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (k === 'started_at' || k === 'completed_at' || k === 'created_at') {
			result[k] = v ? new Date((v as number) * 1000).toISOString() : null;
		} else if (k === 'test_type') {
			// D1 test_type → 前端 test_mode（兼容命名）
			result.test_mode = v;
			result.test_type = v;
		} else {
			result[k] = v;
		}
	}
	return result;
}

/**
 * 校验 session 归属：session.id → session.child_id → children.parent_id
 * 返回 { ok, childId, sessionId } 或 { ok: false, error, status }
 */
async function verifySessionOwnership(
	env: Env,
	parentId: string,
	sessionId: string,
): Promise<{ ok: true; childId: string; sessionId: string } | { ok: false; error: string; status: number }> {
	const row = await env.DB.prepare(`
		SELECT ts.child_id, c.parent_id
		  FROM test_sessions ts
		  JOIN children c ON c.id = ts.child_id
		 WHERE ts.id = ?1
		   AND c.status = 'active'
	`).bind(sessionId).first<{ child_id: string; parent_id: string }>();

	if (!row) {
		return { ok: false, error: '测试会话不存在', status: 404 };
	}
	if (row.parent_id !== parentId) {
		return { ok: false, error: '无权访问该会话', status: 403 };
	}
	return { ok: true, childId: row.child_id, sessionId };
}

/**
 * 校验 child 归属：child.id → children.parent_id
 */
async function verifyChildOwnership(
	env: Env,
	parentId: string,
	childId: string,
): Promise<{ ok: true; childId: string } | { ok: false; error: string; status: number }> {
	const row = await env.DB.prepare(`
		SELECT id FROM children WHERE id = ?1 AND parent_id = ?2 AND status = 'active'
	`).bind(childId, parentId).first<{ id: string }>();

	if (!row) {
		return { ok: false, error: '孩子不存在', status: 404 };
	}
	return { ok: true, childId: row.id };
}

/**
 * 转换 test_mode → test_type
 * formal → formal, full → formal, sampling → sampling
 */
function normalizeTestType(mode: string | undefined): string {
	if (!mode) return 'sampling';
	if (mode === 'full' || mode === 'formal') return 'formal';
	if (mode === 'sampling') return 'sampling';
	return 'sampling'; // 默认
}

/**
 * GET /v1/sessions?child_id=xxx
 * 按孩子查询全部会话，按创建时间倒序
 */
export async function handleGetSessions(
	request: Request,
	env: Env,
	parentId: string,
): Promise<Response> {
	const url = new URL(request.url);
	const childId = url.searchParams.get('child_id');

	if (!childId) {
		return Response.json({ error: 'child_id required' }, { status: 400 });
	}

	const auth = await verifyChildOwnership(env, parentId, childId);
	if (!auth.ok) {
		return Response.json({ error: auth.error }, { status: auth.status });
	}

	const { results } = await env.DB.prepare(`
		SELECT * FROM test_sessions
		 WHERE child_id = ?1
		 ORDER BY created_at DESC
	`).bind(auth.childId).all<Record<string, unknown>>();

	const data = results.map(rowToSession);
	return Response.json({ data });
}

/**
 * POST /v1/sessions
 * 创建新测试会话
 */
export async function handlePostSessions(
	request: Request,
	env: Env,
	parentId: string,
): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ error: 'Invalid request body' }, { status: 400 });
	}

	const { child_id, level, test_mode } = body;

	if (!child_id || !level) {
		return Response.json({ error: 'child_id and level required' }, { status: 400 });
	}

	const levelStr = String(level);
	if (!VALID_LEVELS.includes(levelStr as Level)) {
		return Response.json(
			{ error: `Invalid level: ${levelStr}. Must be one of: ${VALID_LEVELS.join(', ')}` },
			{ status: 400 },
		);
	}

	// child 归属校验
	const childAuth = await verifyChildOwnership(env, parentId, String(child_id));
	if (!childAuth.ok) {
		return Response.json({ error: childAuth.error }, { status: childAuth.status });
	}

	const testType = normalizeTestType(String(test_mode || ''));
	const config = LEVEL_CONFIG[levelStr as Level];
	const timeLimit = config?.timeLimitSeconds || 300;

	const sessionId = crypto.randomUUID();
	const nowUnix = Math.floor(Date.now() / 1000);

	await env.DB.prepare(`
		INSERT INTO test_sessions
		(id, child_id, level, test_type, status, started_at,
		 time_limit_seconds, total_questions, created_at)
		VALUES (?1, ?2, ?3, ?4, 'in_progress', ?5, ?6, 0, ?7)
	`).bind(
		sessionId,
		childAuth.childId,
		levelStr,
		testType,
		nowUnix,
		timeLimit,
		nowUnix,
	).run();

	// 返回创建后的 session
	const row = await env.DB.prepare(
		'SELECT * FROM test_sessions WHERE id = ?1'
	).bind(sessionId).first<Record<string, unknown>>();

	const data = row ? rowToSession(row) : null;
	return Response.json({ data }, { status: 201 });
}

/**
 * PATCH /v1/sessions/:id
 * 更新会话状态（status, completed_at, total_questions 等）
 */
export async function handlePatchSession(
	request: Request,
	env: Env,
	parentId: string,
	sessionId: string,
): Promise<Response> {
	const auth = await verifySessionOwnership(env, parentId, sessionId);
	if (!auth.ok) {
		return Response.json({ error: auth.error }, { status: auth.status });
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ error: 'Invalid request body' }, { status: 400 });
	}

	const updates: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	// status 字段
	if (body.status !== undefined && typeof body.status === 'string') {
		if (!VALID_STATUSES.includes(body.status)) {
			return Response.json(
				{ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
				{ status: 400 },
			);
		}
		updates.push(`status = ?${idx}`);
		values.push(body.status);
		idx++;

		// completed → 自动填 completed_at
		if (body.status === 'completed') {
			updates.push(`completed_at = ?${idx}`);
			values.push(Math.floor(Date.now() / 1000));
			idx++;
		}
	}

	// total_questions
	if (body.total_questions !== undefined) {
		updates.push(`total_questions = ?${idx}`);
		values.push(Number(body.total_questions));
		idx++;
	}

	if (updates.length === 0) {
		return Response.json({ error: '没有可更新的字段' }, { status: 400 });
	}

	values.push(sessionId); // WHERE id = ?

	try {
		await env.DB.prepare(
			`UPDATE test_sessions SET ${updates.join(', ')} WHERE id = ?${idx}`
		).bind(...values).run();
	} catch (err) {
		console.error('update session error:', err);
		return Response.json({ error: '更新失败，请稍后重试' }, { status: 500 });
	}

	const row = await env.DB.prepare(
		'SELECT * FROM test_sessions WHERE id = ?1'
	).bind(sessionId).first<Record<string, unknown>>();

	const data = row ? rowToSession(row) : null;
	return Response.json({ data });
}

// ===== V1 Wrappers（Session 鉴权 + 调用业务函数）=====

export async function handleV1SessionsGet(request: Request, env: Env): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handleGetSessions(request, env, session.parent_id);
}

export async function handleV1SessionsPost(request: Request, env: Env): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handlePostSessions(request, env, session.parent_id);
}

export async function handleV1SessionPatch(request: Request, env: Env, sessionId: string): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handlePatchSession(request, env, session.parent_id, sessionId);
}
