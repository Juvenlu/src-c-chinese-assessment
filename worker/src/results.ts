/**
 * Results — 测试结果（Worker 版本）
 *
 * GET  /v1/results?session_id=xxx  按 session 查询
 * GET  /v1/results?child_id=xxx    按孩子查询
 * POST /v1/results                 计算并保存结果（评分 + 写入）
 *
 * 关键安全原则：
 * 1. level 只能来自 test_sessions.level（服务器端权威）
 * 2. 绝对不能信任客户端 body 传的 level
 * 3. 必须完成 session → child → parent 全链路校验
 *
 * 与 Vercel /api/results 行为完全一致。
 */

import type { Env, Level } from './types';
import { getSessionFromRequest } from './session';
import {
	calculatePartScores,
	calculateFormalTotalScore,
	calculateFormalStableCharCount,
	calculateFormalStableVocabCount,
	calculateTotalScore as calculateSamplingTotalScore,
	calculateStableCharCount as calculateSamplingStableCharCount,
	calculateStableVocabCount as calculateSamplingStableVocabCount,
} from './scoring';

const VALID_LEVELS: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];

/** D1 test_results 行 → 前端 TestResult（类型 + 字段转换） */
function rowToResult(row: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (k === 'known_characters_json') {
			result.known_characters = v ? JSON.parse(String(v)) : null;
		} else if (k === 'weak_characters_json') {
			result.weak_characters = v ? JSON.parse(String(v)) : null;
		} else if (k === 'part_breakdown_json') {
			result.part_breakdown = v ? JSON.parse(String(v)) : null;
			// 兼容旧字段名（从 part_breakdown 展开）
			if (v) {
				const pb = JSON.parse(String(v));
				result.character_mastery_rate = pb.character_mastery_rate ?? null;
				result.vocab_mastery_rate = pb.vocab_mastery_rate ?? null;
				result.reading_comprehension_rate = pb.reading_comprehension_rate ?? null;
			} else {
				result.character_mastery_rate = null;
				result.vocab_mastery_rate = null;
				result.reading_comprehension_rate = null;
			}
		} else if (k === 'completed_at' || k === 'created_at') {
			result[k] = v ? new Date((v as number) * 1000).toISOString() : null;
		} else if (k === 'test_type') {
			// 兼容前端旧字段名 test_mode
			result.test_mode = v;
			result.test_type = v;
		} else {
			result[k] = v;
		}
	}
	return result;
}

/** session → child 归属校验 */
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
 * GET /v1/results?session_id=xxx
 * GET /v1/results?child_id=xxx
 */
export async function handleGetResults(
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

	if (sessionId) {
		const auth = await verifySessionOwnership(env, parentId, sessionId);
		if (!auth.ok) {
			return Response.json({ error: auth.error }, { status: auth.status });
		}

		const row = await env.DB.prepare(`
			SELECT * FROM test_results WHERE session_id = ?1
		`).bind(sessionId).first<Record<string, unknown>>();

		const data = row ? rowToResult(row) : null;
		return Response.json({ data });
	}

	// child_id 查询
	const auth = await verifyChildOwnership(env, parentId, childId!);
	if (!auth.ok) {
		return Response.json({ error: auth.error }, { status: auth.status });
	}

	const { results } = await env.DB.prepare(`
		SELECT * FROM test_results
		 WHERE child_id = ?1
		 ORDER BY created_at DESC
	`).bind(auth.childId).all<Record<string, unknown>>();

	const data = results.map(rowToResult);
	return Response.json({ data });
}

/**
 * POST /v1/results
 * 计算并保存测试结果
 *
 * Body: { session_id }
 *
 * level 和 test_type 均从 session 读取，不信任 body。
 */
export async function handlePostResults(
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

	const { session_id } = body;
	if (!session_id) {
		return Response.json({ error: 'session_id 不能为空' }, { status: 400 });
	}

	// 第一步：校验 session 归属
	const auth = await verifySessionOwnership(env, parentId, String(session_id));
	if (!auth.ok) {
		return Response.json({ error: auth.error }, { status: auth.status });
	}

	// 第二步：从 session 表读取 level + test_type（服务器端权威）
	const session = await env.DB.prepare(`
		SELECT * FROM test_sessions WHERE id = ?1
	`).bind(auth.sessionId).first<Record<string, unknown>>();

	if (!session) {
		return Response.json({ error: '测试会话不存在' }, { status: 404 });
	}

	const level = session.level as Level;
	const testType = String(session.test_type || 'sampling');
	const childId = auth.childId;

	if (!VALID_LEVELS.includes(level)) {
		return Response.json({ error: '无效的测试等级' }, { status: 400 });
	}

	// 第三步：获取答题数据
	const { results: answerRows } = await env.DB.prepare(`
		SELECT * FROM test_answers
		 WHERE session_id = ?1
		 ORDER BY created_at ASC
	`).bind(auth.sessionId).all<Record<string, unknown>>();

	// 转换为 scoring 需要的格式
	const answers = answerRows.map((a) => ({
		part: Number(a.part) || 1,
		is_correct: a.is_correct === 1,
		reaction_time_ms: a.reaction_time_ms ? Number(a.reaction_time_ms) : undefined,
		question_content: a.question_content ? String(a.question_content) : undefined,
	}));

	// 安全校验：没有有效答案时拒绝生成结果
	const validAnswers = answers.filter(
		(a) => a.question_content && (a.part === 1 || a.part === 2),
	);
	if (validAnswers.length === 0) {
		return Response.json({ error: '没有有效答题记录，无法生成结果' }, { status: 400 });
	}

	// 第四步：计算得分
	const partScores = calculatePartScores(answers);
	let totalScore: number;
	let stableCharCount: number;
	let stableVocabCount: number;

	const isFormalTest = testType === 'formal'; // full 已在 sessions 创建时归一化为 formal

	if (isFormalTest) {
		// 正式测试：char 50% + vocab 50%
		totalScore = calculateFormalTotalScore(partScores);
		stableCharCount = calculateFormalStableCharCount(partScores, level);
		stableVocabCount = calculateFormalStableVocabCount(partScores, level);
	} else {
		// 趣味闯关：四部分加权 + 反应时间加成
		totalScore = calculateSamplingTotalScore(partScores);
		stableCharCount = calculateSamplingStableCharCount(totalScore, level, answers);
		stableVocabCount = calculateSamplingStableVocabCount(stableCharCount, level);
	}

	// 完成时间
	const startedAt = Number(session.started_at) || 0;
	const completedAt = Number(session.completed_at) || Math.floor(Date.now() / 1000);
	const completionTimeSeconds = Math.round(completedAt - startedAt);

	// 掌握率（与 Vercel 版一致）
	const characterMasteryRate = partScores.characterScore;
	const vocabMasteryRate = partScores.vocabScore;
	const readingComprehensionRate = Math.round(
		(partScores.readingScore + partScores.comprehensionScore) / 2,
	);

	// part_breakdown（存入 part_breakdown_json 字段（D1 无独立列，用 JSON 扩展）
	const partBreakdown = {
		character_mastery_rate: characterMasteryRate,
		vocab_mastery_rate: vocabMasteryRate,
		reading_comprehension_rate: readingComprehensionRate,
		part_scores: partScores,
	};

	// 认识的单字列表（长度为 1 的 question_content）
	const knownCharacters = validAnswers
		.filter((a) => a.is_correct && a.question_content && a.question_content.length === 1)
		.map((a) => a.question_content!);

	const nowUnix = Math.floor(Date.now() / 1000);
	const resultId = crypto.randomUUID();
	const totalQuestions = answers.length;
	const correctCount = answers.filter((a) => a.is_correct).length;

	// 第五步：保存结果（upsert，session_id 唯一）
	// 先查是否已存在
	const existing = await env.DB.prepare(
		'SELECT id FROM test_results WHERE session_id = ?1'
	).bind(auth.sessionId).first<{ id: string }>();

	try {
		if (existing) {
			// UPDATE
			await env.DB.prepare(`
				UPDATE test_results SET
					character_score = ?1,
					vocab_score = ?2,
					reading_score = ?3,
					comprehension_score = ?4,
					total_score = ?5,
					stable_char_count = ?6,
					stable_vocab_count = ?7,
					completion_time_seconds = ?8,
					total_questions = ?9,
					correct_count = ?10,
					known_characters_json = ?11,
					part_breakdown_json = ?12,
					completed_at = ?13
				WHERE session_id = ?14
			`).bind(
				partScores.characterScore,
				partScores.vocabScore,
				partScores.readingScore,
				partScores.comprehensionScore,
				totalScore,
				stableCharCount,
				stableVocabCount,
				completionTimeSeconds,
				totalQuestions,
				correctCount,
				knownCharacters.length > 0 ? JSON.stringify(knownCharacters) : null,
				JSON.stringify(partBreakdown),
				nowUnix,
				auth.sessionId,
			).run();
		} else {
			// INSERT
			await env.DB.prepare(`
				INSERT INTO test_results
				(id, session_id, child_id, level, test_type, status,
				 character_score, vocab_score, reading_score, comprehension_score,
				 total_score, stable_char_count, stable_vocab_count,
				 completion_time_seconds, total_questions, correct_count,
				 known_characters_json, part_breakdown_json, completed_at, created_at)
				VALUES
				(?1, ?2, ?3, ?4, ?5, 'completed',
				 ?6, ?7, ?8, ?9,
				 ?10, ?11, ?12,
				 ?13, ?14, ?15,
				 ?16, ?17, ?18, ?19)
			`).bind(
				resultId,
				auth.sessionId,
				childId,
				level,
				testType,
				partScores.characterScore,
				partScores.vocabScore,
				partScores.readingScore,
				partScores.comprehensionScore,
				totalScore,
				stableCharCount,
				stableVocabCount,
				completionTimeSeconds,
				totalQuestions,
				correctCount,
				knownCharacters.length > 0 ? JSON.stringify(knownCharacters) : null,
				JSON.stringify(partBreakdown),
				nowUnix,
				nowUnix,
			).run();
		}
	} catch (err) {
		console.error('save result error:', err);
		return Response.json({ error: '保存结果失败，请稍后重试' }, { status: 500 });
	}

	// 查询返回
	const row = await env.DB.prepare(
		'SELECT * FROM test_results WHERE session_id = ?1'
	).bind(auth.sessionId).first<Record<string, unknown>>();

	const data = row ? rowToResult(row) : null;
	return Response.json({ data });
}

// ===== V1 Wrappers =====

export async function handleV1ResultsGet(request: Request, env: Env): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handleGetResults(request, env, session.parent_id);
}

export async function handleV1ResultsPost(request: Request, env: Env): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handlePostResults(request, env, session.parent_id);
}
