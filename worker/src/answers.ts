/**
 * Answers — 答题记录（Worker 版本）
 *
 * GET  /v1/answers?session_id=xxx   按 session 查询
 * GET  /v1/answers?child_id=xxx     按孩子查询（跨 session）
 * POST /v1/answers                  单条或批量提交
 *
 * Auth：HMAC Session + session/child ownership
 */

import type { Env } from './types';
import { getSessionFromRequest } from './session';

/** D1 test_answers 行 → 前端 TestAnswer（类型转换） */
function rowToAnswer(row: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (k === 'is_correct') {
			// INTEGER 0/1 → boolean
			result.is_correct = v === 1;
		} else if (k === 'created_at') {
			result.created_at = v ? new Date((v as number) * 1000).toISOString() : null;
		} else {
			result[k] = v;
		}
	}
	return result;
}

/** session → child 归属校验（复用 sessions 逻辑） */
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

	if (!row) return { ok: false, error: '测试会话不存在', status: 404 };
	if (row.parent_id !== parentId) return { ok: false, error: '无权访问该会话', status: 403 };
	return { ok: true, childId: row.child_id, sessionId };
}

async function verifyChildOwnership(
	env: Env,
	parentId: string,
	childId: string,
): Promise<{ ok: true; childId: string } | { ok: false; error: string; status: number }> {
	const row = await env.DB.prepare(`
		SELECT id FROM children WHERE id = ?1 AND parent_id = ?2 AND status = 'active'
	`).bind(childId, parentId).first<{ id: string }>();

	if (!row) return { ok: false, error: '孩子不存在', status: 404 };
	return { ok: true, childId: row.id };
}

/**
 * GET /v1/answers?session_id=xxx
 * GET /v1/answers?child_id=xxx
 */
export async function handleGetAnswers(
	request: Request,
	env: Env,
	parentId: string,
): Promise<Response> {
	const url = new URL(request.url);
	const sessionId = url.searchParams.get('session_id');
	const childId = url.searchParams.get('child_id');

	if (!sessionId && !childId) {
		return Response.json({ error: 'session_id or child_id required' }, { status: 400 });
	}

	let results: Record<string, unknown>[] = [];

	if (sessionId) {
		const auth = await verifySessionOwnership(env, parentId, sessionId);
		if (!auth.ok) {
			return Response.json({ error: auth.error }, { status: auth.status });
		}

		const { results: rows } = await env.DB.prepare(`
			SELECT * FROM test_answers
			 WHERE session_id = ?1
			 ORDER BY created_at ASC
		`).bind(sessionId).all<Record<string, unknown>>();

		results = rows;
	} else if (childId) {
		const auth = await verifyChildOwnership(env, parentId, childId);
		if (!auth.ok) {
			return Response.json({ error: auth.error }, { status: auth.status });
		}

		// 先拿该 child 的所有 session_id
		const { results: sessionRows } = await env.DB.prepare(`
			SELECT id FROM test_sessions WHERE child_id = ?1
		`).bind(auth.childId).all<{ id: string }>();

		if (sessionRows.length === 0) {
			return Response.json({ data: [] });
		}

		const sessionIds = sessionRows.map((s) => s.id);
		const placeholders = sessionIds.map((_, i) => `?${i + 1}`).join(', ');

		const { results: rows } = await env.DB.prepare(`
			SELECT * FROM test_answers
			 WHERE session_id IN (${placeholders})
			 ORDER BY created_at ASC
		`).bind(...sessionIds).all<Record<string, unknown>>();

		results = rows;
	}

	const data = results.map(rowToAnswer);
	return Response.json({ data });
}

/**
 * POST /v1/answers
 *
 * 单条模式：
 * { session_id, question_id?, question_content?, part, selected_answer?, is_correct, reaction_time_ms? }
 *
 * 批量模式（fulltest）：
 * { session_id, answers: [ { question_id?, question_content, part, is_correct, selected_answer?, reaction_time_ms? }, ... ] }
 */
export async function handlePostAnswers(
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

	const sessionId = body.session_id ? String(body.session_id) : null;
	if (!sessionId) {
		return Response.json({ error: 'session_id required' }, { status: 400 });
	}

	// 归属校验
	const auth = await verifySessionOwnership(env, parentId, sessionId);
	if (!auth.ok) {
		return Response.json({ error: auth.error }, { status: auth.status });
	}

	const nowUnix = Math.floor(Date.now() / 1000);

	// ===== 批量提交模式 =====
	if (Array.isArray(body.answers) && body.answers.length > 0) {
		const answers = body.answers as Record<string, unknown>[];

		if (answers.length === 0) {
			return Response.json({ error: 'answers array cannot be empty' }, { status: 400 });
		}

		// 构造 D1 batch statements
		const statements = answers.map((a) => {
			const answerId = crypto.randomUUID();
			const questionId = a.question_id ? String(a.question_id) : null;
			const questionContent = a.question_content ? String(a.question_content) : null;
			const part = a.part !== undefined ? Number(a.part) : null;
			const selectedAnswer = a.selected_answer !== undefined
				? String(a.selected_answer)
				: (a.answer !== undefined ? String(a.answer) : null);
			const isCorrect = a.is_correct !== undefined ? (a.is_correct ? 1 : 0) : null;
			const reactionTime = a.reaction_time_ms !== undefined
				? Number(a.reaction_time_ms)
				: null;

			return env.DB.prepare(`
				INSERT INTO test_answers
				(id, session_id, question_id, question_content, part,
				 selected_answer, is_correct, reaction_time_ms, created_at)
				VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
			`).bind(
				answerId, sessionId, questionId, questionContent, part,
				selectedAnswer, isCorrect, reactionTime, nowUnix,
			);
		});

		try {
			await env.DB.batch(statements);
		} catch (err) {
			console.error('batch insert answers error:', err);
			return Response.json({ error: '批量提交失败，请稍后重试' }, { status: 500 });
		}

		// 返回数量
		return Response.json({ count: answers.length }, { status: 201 });
	}

	// ===== 单条提交模式 =====
	const questionId = body.question_id ? String(body.question_id) : null;
	const questionContent = body.question_content ? String(body.question_content) : null;

	if (!questionId && !questionContent) {
		return Response.json({ error: 'question_id or question_content required' }, { status: 400 });
	}

	const answerId = crypto.randomUUID();
	const part = body.part !== undefined ? Number(body.part) : null;
	const selectedAnswer = body.selected_answer !== undefined
		? String(body.selected_answer)
		: (body.answer !== undefined ? String(body.answer) : null);
	const isCorrect = body.is_correct !== undefined ? (body.is_correct ? 1 : 0) : null;
	const reactionTime = body.reaction_time_ms !== undefined
		? Number(body.reaction_time_ms)
		: null;

	try {
		await env.DB.prepare(`
			INSERT INTO test_answers
			(id, session_id, question_id, question_content, part,
			 selected_answer, is_correct, reaction_time_ms, created_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
		`).bind(
			answerId, sessionId, questionId, questionContent, part,
			selectedAnswer, isCorrect, reactionTime, nowUnix,
		).run();
	} catch (err) {
		console.error('insert answer error:', err);
		return Response.json({ error: '提交失败，请稍后重试' }, { status: 500 });
	}

	const row = await env.DB.prepare(
		'SELECT * FROM test_answers WHERE id = ?1'
	).bind(answerId).first<Record<string, unknown>>();

	const data = row ? rowToAnswer(row) : null;
	return Response.json({ data }, { status: 201 });
}

// ===== V1 Wrappers =====

export async function handleV1AnswersGet(request: Request, env: Env): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handleGetAnswers(request, env, session.parent_id);
}

export async function handleV1AnswersPost(request: Request, env: Env): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handlePostAnswers(request, env, session.parent_id);
}
