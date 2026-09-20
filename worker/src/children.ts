// Children CRUD — D1 实现
// GET / POST / PATCH，使用现有 HMAC Session + D1

import { getSessionFromRequest } from './session';

interface Env {
	DB: D1Database;
	SESSION_SECRET: string;
}

/** D1 children 行 → 前端 ChildInfo（timestamp → ISO string） */
function rowToChildInfo(row: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (k === 'created_at' || k === 'updated_at') {
			result[k] = v ? new Date((v as number) * 1000).toISOString() : null;
		} else {
			result[k] = v;
		}
	}
	return result;
}

/** 校验 POST body 必填字段 + age 范围 */
function validateCreateBody(body: Record<string, unknown>): string | null {
	const { nickname, age, grade, country } = body;
	if (!nickname || typeof nickname !== 'string') return 'nickname is required';
	if (age === undefined || age === null) return 'age is required';
	const ageNum = Number(age);
	if (isNaN(ageNum) || ageNum < 3 || ageNum > 18) return 'age must be between 3 and 18';
	if (!grade || typeof grade !== 'string') return 'grade is required';
	if (!country || typeof country !== 'string') return 'country is required';
	return null;
}

/** GET /v1/children */
export async function handleGetChildren(_request: Request, env: Env, parentId: string): Promise<Response> {
	const { results } = await env.DB
		.prepare(
			`SELECT * FROM children
			 WHERE parent_id = ?1 AND status = 'active'
			 ORDER BY created_at ASC`
		)
		.bind(parentId)
		.all<Record<string, unknown>>();

	const children = results.map(rowToChildInfo);
	return Response.json({ children });
}

/** POST /v1/children */
export async function handlePostChildren(request: Request, env: Env, parentId: string): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ success: false, error: 'Invalid request body' }, { status: 400 });
	}

	const validationError = validateCreateBody(body);
	if (validationError) {
		return Response.json({ success: false, error: validationError }, { status: 400 });
	}

	const childId = crypto.randomUUID();
	const nowUnix = Math.floor(Date.now() / 1000);
	const nickname = String(body.nickname).trim();
	const age = Number(body.age);
	const grade = String(body.grade);
	const country = String(body.country);
	const homeLanguage = body.home_language ? String(body.home_language) : null;
	const homeLanguageOther = body.home_language_other ? String(body.home_language_other) : null;

	try {
		await env.DB
			.prepare(
				`INSERT INTO children
				 (id, parent_id, nickname, age, grade, country, home_language, home_language_other,
				  status, assessment_status, created_at, updated_at)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', 'not_started', ?9, ?9)`
			)
			.bind(childId, parentId, nickname, age, grade, country, homeLanguage, homeLanguageOther, nowUnix)
			.run();
	} catch (err) {
		console.error('create child error:', err);
		return Response.json({ success: false, error: '创建失败，请稍后重试' }, { status: 500 });
	}

	// Guest session 绑定（可选，失败不影响 child 创建）
	const guestSessionId = body.guest_session_id ? String(body.guest_session_id) : null;
	if (guestSessionId) {
		try {
			await bindGuestTestToChild(env, guestSessionId, childId);
		} catch (bindErr) {
			console.error('bind guest test error (non-fatal):', bindErr);
		}
	}

	// 返回创建后的 child
	const { results } = await env.DB
		.prepare('SELECT * FROM children WHERE id = ?1')
		.bind(childId)
		.all<Record<string, unknown>>();

	const child = results[0] ? rowToChildInfo(results[0]) : null;
	return Response.json({ success: true, child });
}

/** PATCH /v1/children/:id */
export async function handlePatchChild(request: Request, env: Env, parentId: string, childId: string): Promise<Response> {
	// 归属校验
	const childRow = await env.DB
		.prepare('SELECT id FROM children WHERE id = ?1 AND parent_id = ?2')
		.bind(childId, parentId)
		.first<{ id: string }>();

	if (!childRow) {
		return Response.json({ success: false, error: '孩子不存在' }, { status: 404 });
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ success: false, error: 'Invalid request body' }, { status: 400 });
	}

	// 可更新字段白名单
	const allowedKeys = ['nickname', 'age', 'grade', 'country', 'home_language', 'home_language_other'];
	const updates: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	for (const key of allowedKeys) {
		if (body[key] === undefined) continue;
		updates.push(`${key} = ?${idx}`);
		values.push(body[key]);
		idx++;
	}

	if (updates.length === 0) {
		return Response.json({ success: false, error: '没有可更新的字段' }, { status: 400 });
	}

	// age 额外校验
	if (body.age !== undefined) {
		const ageNum = Number(body.age);
		if (isNaN(ageNum) || ageNum < 3 || ageNum > 18) {
			return Response.json({ success: false, error: 'age must be between 3 and 18' }, { status: 400 });
		}
	}

	const nowUnix = Math.floor(Date.now() / 1000);
	updates.push(`updated_at = ?${idx}`);
	values.push(nowUnix);
	idx++;
	values.push(childId); // WHERE id = ?

	try {
		await env.DB
			.prepare(`UPDATE children SET ${updates.join(', ')} WHERE id = ?${idx}`)
			.bind(...values)
			.run();
	} catch (err) {
		console.error('update child error:', err);
		return Response.json({ success: false, error: '更新失败，请稍后重试' }, { status: 500 });
	}

	const { results } = await env.DB
		.prepare('SELECT * FROM children WHERE id = ?1')
		.bind(childId)
		.all<Record<string, unknown>>();

	const child = results[0] ? rowToChildInfo(results[0]) : null;
	return Response.json({ success: true, child });
}

/**
 * Level string → number 转换（与 signup route 行为一致）
 * SRC100 → 100, SRC300 → 300, ... ; number → 原数; 空/非法 → null
 */
function extractLevelNum(val: unknown): number | null {
	if (val == null || val === '') return null;
	if (typeof val === 'number') return val;
	const m = String(val).match(/(\d+)/);
	return m ? parseInt(m[1], 10) : null;
}

/**
 * 绑定游客测试结果到孩子
 * 使用 env.DB.batch() 原子执行：INSERT quick_result + UPDATE guest_session
 * 失败时 throw，由调用方 catch（不影响 child 创建）
 */
async function bindGuestTestToChild(
	env: Env,
	guestSessionId: string,
	childId: string
): Promise<void> {
	// 1. 查询 guest session
	const guestSession = await env.DB
		.prepare(
			`SELECT id, status, claimed, result_data_json, created_at
			 FROM guest_test_sessions
			 WHERE id = ?1`
		)
		.bind(guestSessionId)
		.first<Record<string, unknown>>();

	if (!guestSession) return;
	if (guestSession.claimed !== 0) return;
	if (guestSession.status !== 'completed') return;
	if (!guestSession.result_data_json) return;

	let resultData: Record<string, unknown>;
	try {
		resultData = JSON.parse(String(guestSession.result_data_json));
	} catch {
		return;
	}

	const nowUnix = Math.floor(Date.now() / 1000);
	const completedAt = guestSession.created_at ? Number(guestSession.created_at) : nowUnix;

	// 字段映射（result_data → D1 quick_assessment_results）
	// 注意：D1 level 列是 INTEGER，需 extractLevelNum() 转换
	const charL = extractLevelNum(resultData.characterLevelLower) ?? 0;
	const charU = extractLevelNum(resultData.characterLevelUpper) ?? 0;
	const wordL = extractLevelNum(resultData.wordLevelLower) ?? 0;
	const wordU = extractLevelNum(resultData.wordLevelUpper) ?? 0;
	const readingBase = extractLevelNum(resultData.readingBaseLevel) ?? 0;
	const confidence = resultData.confidence ?? 'medium';
	const recommendedLevel = resultData.recommendedReadingLevel ?? resultData.readingBaseLevel;
	const totalQuestions = resultData.totalQuestions ?? resultData.total_questions ?? 0;
	const correctCount = resultData.correctCount ?? resultData.correct_count ?? 0;
	const rawResultJson = typeof resultData === 'object' ? JSON.stringify(resultData) : '';

	const resultId = crypto.randomUUID();

	// 2. 原子执行 INSERT + UPDATE
	const stmt1 = env.DB.prepare(
		`INSERT INTO quick_assessment_results
		 (id, child_id, guest_session_id, session_id, character_level_l, character_level_u,
		  word_level_l, word_level_u, reading_base, confidence, recommended_level,
		  total_questions, correct_count, completed_at, raw_result_json, created_at)
		 VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`
	).bind(
		resultId,
		childId,
		guestSessionId,
		charL,
		charU,
		wordL,
		wordU,
		readingBase,
		String(confidence),
		String(recommendedLevel),
		Number(totalQuestions),
		Number(correctCount),
		completedAt,
		rawResultJson,
		nowUnix
	);

	const stmt2 = env.DB.prepare(
		`UPDATE guest_test_sessions
		 SET claimed = 1, child_id = ?1, completed_at = ?2
		 WHERE id = ?3`
	).bind(childId, completedAt, guestSessionId);

	await env.DB.batch([stmt1, stmt2]);
}

// session wrapper helpers — index.ts 中注册路由时调用

export async function handleV1ChildrenGet(request: Request, env: Env): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handleGetChildren(request, env, session.parent_id);
}

export async function handleV1ChildrenPost(request: Request, env: Env): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handlePostChildren(request, env, session.parent_id);
}

export async function handleV1ChildPatch(request: Request, env: Env, childId: string): Promise<Response> {
	const session = await getSessionFromRequest(request, env.SESSION_SECRET);
	if (!session) return Response.json({ error: '未登录' }, { status: 401 });
	return handlePatchChild(request, env, session.parent_id, childId);
}
