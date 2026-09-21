/**
 * Questions — 题库查询（Worker 版本）
 *
 * GET /v1/questions
 * 从 D1 question_bank 读取，支持 level 过滤（累积式）。
 *
 * 与现有 Supabase /api/questions 行为一致：
 * - SRC500 = SRC100 + SRC300 + SRC500
 * - 按 created_at 升序排列
 */

import type { Env, Level } from './types';

/** 累积式 level 映射：SRC500 包含 SRC300+SRC100 等 */
const LEVEL_STACK: Record<Level, Level[]> = {
	SRC100: ['SRC100'],
	SRC300: ['SRC100', 'SRC300'],
	SRC500: ['SRC100', 'SRC300', 'SRC500'],
	SRC800: ['SRC100', 'SRC300', 'SRC500', 'SRC800'],
};

const VALID_LEVELS: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];

/** D1 question_bank 行 → 前端 QuestionItem（字段名 + 类型转换） */
function rowToQuestion(row: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (k === 'options_json') {
			// TEXT JSON → string[]
			result.options = v ? JSON.parse(String(v)) : [];
		} else if (k === 'story_options_json') {
			result.story_options = v ? JSON.parse(String(v)) : null;
		} else if (k === 'created_at' || k === 'updated_at') {
			result[k] = v ? new Date((v as number) * 1000).toISOString() : null;
		} else if (k === 'difficulty') {
			// D1 有 difficulty，但 QuestionItem 接口没有，保留在数据中
			result[k] = v;
		} else if (k === 'char_system') {
			result.char_system = v;
		} else {
			result[k] = v;
		}
	}
	return result;
}

/**
 * GET /v1/questions?level=SRC300
 *
 * 不需要登录（公开读），但需要 X-SRC-Service-Key 服务端鉴权（外层已校验）。
 */
export async function handleGetQuestions(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const levelParam = url.searchParams.get('level');

	let levels: Level[] = VALID_LEVELS;
	if (levelParam) {
		const stack = LEVEL_STACK[levelParam as Level];
		if (!stack) {
			return Response.json(
				{ error: `Invalid level: ${levelParam}. Must be one of: ${VALID_LEVELS.join(', ')}` },
				{ status: 400 },
			);
		}
		levels = stack;
	}

	const placeholders = levels.map((_, i) => `?${i + 1}`).join(', ');
	const sql = `
		SELECT * FROM question_bank
		 WHERE level IN (${placeholders})
		 ORDER BY created_at ASC
	`;

	const stmt = env.DB.prepare(sql);
	const bound = stmt.bind(...levels);
	const { results } = await bound.all<Record<string, unknown>>();

	const data = results.map(rowToQuestion);
	return Response.json({ data });
}
