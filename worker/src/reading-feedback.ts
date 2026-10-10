import { Env } from './types';
import { getSessionFromRequest } from './session';

// ============================================================
// Reading Feedback — 绘本阅读反馈（兴趣 + 难度）
//
// 路由（外层 /v1/ 已统一校验 Service Key）:
//   GET  /v1/reading-feedback?child_id=&custom_book_id=   读取一组反馈
//   POST /v1/reading-feedback                            新增 / 更新（upsert）
//
// 每个 child_id + custom_book_id 至多一条反馈。
// 部分更新：字段缺失则保留原值；显式传 null 才清空。
// ============================================================

const INTEREST_VALUES = ['like', 'neutral', 'dislike'] as const;
const DIFFICULTY_VALUES = ['easy', 'just_right', 'hard'] as const;

type Interest = (typeof INTEREST_VALUES)[number];
type Difficulty = (typeof DIFFICULTY_VALUES)[number];

interface FeedbackRow {
  id: number;
  child_id: string;
  custom_book_id: number;
  interest: Interest | null;
  difficulty: Difficulty | null;
  created_at: number;
  updated_at: number;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/**
 * 校验枚举：
 * - undefined：字段缺失（部分更新时保留原值）
 * - null：显式清空
 * - 合法字符串：设置
 * - 其它：非法 → 抛错（调用方返回 400）
 */
function parseOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): { present: true; value: T | null } | { present: false } {
  if (value === undefined) return { present: false };
  if (value === null) return { present: true, value: null };
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return { present: true, value: value as T };
  }
  throw new Error(`Invalid ${field}`);
}

/** 校验 child 归属：children.parent_id 必须等于当前登录家长。 */
async function verifyChildOwnership(
  env: Env,
  parentId: string,
  childId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id, parent_id, status FROM children WHERE id = ?1`,
  ).bind(childId).first<Record<string, unknown>>();

  if (!row) return false;
  if (row.status !== 'active') return false;
  return row.parent_id === parentId;
}

/** 校验 custom book 存在且属于该 child。 */
async function verifyBookOwnership(
  env: Env,
  childId: string,
  customBookId: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id, child_id, status FROM custom_books WHERE id = ?1`,
  ).bind(customBookId).first<Record<string, unknown>>();

  if (!row || row.status !== 'active') return false;
  return row.child_id === childId;
}

async function getFeedback(
  env: Env,
  childId: string,
  customBookId: number,
): Promise<FeedbackRow | null> {
  return env.DB.prepare(
    `SELECT id, child_id, custom_book_id, interest, difficulty, created_at, updated_at
       FROM reading_feedback
      WHERE child_id = ?1 AND custom_book_id = ?2
      LIMIT 1`,
  ).bind(childId, customBookId).first<FeedbackRow>();
}

/**
 * GET /v1/reading-feedback?child_id=&custom_book_id=
 */
async function handleGet(request: Request, env: Env, sessionParentId: string): Promise<Response> {
  const url = new URL(request.url);
  const childId = url.searchParams.get('child_id') || '';
  const customBookRaw = url.searchParams.get('custom_book_id');
  const customBookId = Number(customBookRaw);

  if (!childId || !Number.isInteger(customBookId) || customBookId < 1) {
    return json({ success: false, error: 'child_id and custom_book_id required' }, 400);
  }

  if (!(await verifyChildOwnership(env, sessionParentId, childId))) {
    return json({ success: false, error: 'Forbidden' }, 403);
  }
  if (!(await verifyBookOwnership(env, childId, customBookId))) {
    return json({ success: false, error: 'Forbidden' }, 403);
  }

  const data = await getFeedback(env, childId, customBookId);
  return json({ success: true, data: data ?? null }, 200);
}

/**
 * POST /v1/reading-feedback
 * body: { child_id, custom_book_id, interest?, difficulty? }
 *
 * 用「字段是否存在」标志位驱动 upsert：
 * 缺失的字段在 DO UPDATE 分支保留原值，显式 null 才清空。
 */
async function handlePost(request: Request, env: Env, sessionParentId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, 400);
  }

  const childId = typeof body.child_id === 'string' ? body.child_id : '';
  const customBookId = Number(body.custom_book_id);

  if (!childId) {
    return json({ success: false, error: 'child_id required' }, 400);
  }
  if (!Number.isInteger(customBookId) || customBookId < 1) {
    return json({ success: false, error: 'custom_book_id required' }, 400);
  }

  let interest: { present: true; value: Interest | null } | { present: false };
  let difficulty: { present: true; value: Difficulty | null } | { present: false };
  try {
    interest = parseOptionalEnum(body.interest, INTEREST_VALUES, 'interest');
    difficulty = parseOptionalEnum(body.difficulty, DIFFICULTY_VALUES, 'difficulty');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid value';
    return json({ success: false, error: message }, 400);
  }

  // 至少提供一个字段，否则无意义（但不视为错误）
  if (!interest.present && !difficulty.present) {
    const existing = await getFeedback(env, childId, customBookId);
    return json({ success: true, data: existing ?? null }, 200);
  }

  if (!(await verifyChildOwnership(env, sessionParentId, childId))) {
    return json({ success: false, error: 'Forbidden' }, 403);
  }
  if (!(await verifyBookOwnership(env, childId, customBookId))) {
    return json({ success: false, error: 'Forbidden' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const insertInterest = interest.present ? interest.value : null;
  const insertDifficulty = difficulty.present ? difficulty.value : null;
  const hasInterest = interest.present ? 1 : 0;
  const hasDifficulty = difficulty.present ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO reading_feedback
       (child_id, custom_book_id, interest, difficulty, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(child_id, custom_book_id) DO UPDATE SET
       interest = CASE WHEN ?6 = 1 THEN excluded.interest ELSE reading_feedback.interest END,
       difficulty = CASE WHEN ?7 = 1 THEN excluded.difficulty ELSE reading_feedback.difficulty END,
       updated_at = excluded.updated_at`,
  )
    .bind(
      childId,
      customBookId,
      insertInterest,
      insertDifficulty,
      now,
      hasInterest,
      hasDifficulty,
    )
    .run();

  const data = await getFeedback(env, childId, customBookId);
  return json({ success: true, data }, 200);
}

/**
 * Reading Feedback 总入口。Service Key 由外层 /v1/ 统一校验，
 * 此处只负责 HMAC Session + 归属校验与分发。
 */
export async function handleReadingFeedback(request: Request, env: Env): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  if (request.method === 'GET') {
    return handleGet(request, env, session.parent_id);
  }
  if (request.method === 'POST') {
    return handlePost(request, env, session.parent_id);
  }
  return json({ success: false, error: 'Method not allowed' }, 405);
}
