import { Env } from './types';
import { getSessionFromRequest } from './session';

// ============================================================
// Reading Records — 绘本阅读进度
//
// 路由（外层 /v1/ 已统一校验 Service Key）:
//   POST  /v1/reading-records            获取或初始化阅读记录
//   PATCH /v1/reading-records/:id        更新阅读位置 / 时长 / 完成状态
//   POST  /v1/reading-records/:id        同 PATCH，兼容 sendBeacon
//
// 时间单位：Unix 秒（与 D1 其它表一致）
// pages_read：1-based 当前阅读位置
// ============================================================

interface ReadingRecordRow {
  id: number;
  child_id: string;
  custom_book_id: number;
  start_time: number;
  end_time: number | null;
  duration_seconds: number;
  pages_read: number;
  total_pages: number;
  completed: number;
  created_at: number;
}

interface CustomBookRow {
  id: number;
  child_id: string;
  status: string;
  page_count: number;
}

interface OwnershipOk {
  ok: true;
  childId: string;
}
interface OwnershipErr {
  ok: false;
  error: string;
  status: number;
}
type OwnershipResult = OwnershipOk | OwnershipErr;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/**
 * 校验 child 归属：children.parent_id 必须等于当前登录家长。
 * 不存在返回 404，非激活/非本人返回 403，避免跨家庭数据泄露。
 */
async function verifyChildOwnership(
  env: Env,
  parentId: string,
  childId: string,
): Promise<OwnershipResult> {
  const row = await env.DB.prepare(
    `SELECT id, parent_id, status FROM children WHERE id = ?1`,
  ).bind(childId).first<Record<string, unknown>>();

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
 * 读取 active custom book + 服务端实际页数（json_array_length(pages_json)）。
 * 不信任前端传入的 total_pages。
 */
async function getCustomBook(
  env: Env,
  customBookId: number,
): Promise<CustomBookRow | null> {
  const row = await env.DB.prepare(
    `SELECT cb.id,
            cb.child_id,
            cb.status,
            json_array_length(brv.pages_json) AS page_count
       FROM custom_books cb
       JOIN book_rewrite_versions brv ON cb.rewrite_id = brv.id
      WHERE cb.id = ?1`,
  ).bind(customBookId).first<CustomBookRow>();

  if (!row || row.status !== 'active' || !row.page_count) return null;
  return row;
}

async function getRecord(
  env: Env,
  childId: string,
  customBookId: number,
): Promise<ReadingRecordRow | null> {
  return env.DB.prepare(
    `SELECT * FROM reading_records
      WHERE child_id = ?1 AND custom_book_id = ?2
      LIMIT 1`,
  ).bind(childId, customBookId).first<ReadingRecordRow>();
}

/**
 * POST /v1/reading-records
 * body: { child_id: string, custom_book_id: number }
 * 获取已有记录；不存在则创建（服务端页数为准，pages_read=1）。
 */
async function handleCreate(request: Request, env: Env): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  let body: { child_id?: unknown; custom_book_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, 400);
  }

  const childId = typeof body.child_id === 'string' ? body.child_id.trim() : '';
  const customBookId = Number(body.custom_book_id);
  if (!childId || !Number.isInteger(customBookId) || customBookId <= 0) {
    return json({ success: false, error: 'child_id and custom_book_id required' }, 400);
  }

  const ownership = await verifyChildOwnership(env, session.parent_id, childId);
  if (!ownership.ok) {
    return json({ success: false, error: ownership.error }, ownership.status);
  }

  const book = await getCustomBook(env, customBookId);
  if (!book) {
    return json({ success: false, error: 'Book not found' }, 404);
  }
  if (book.child_id !== childId) {
    return json({ success: false, error: 'Forbidden' }, 403);
  }

  // 先查后插：避免重复记录；命中则直接复用（不覆盖已有进度）
  const existing = await getRecord(env, childId, customBookId);
  if (existing) {
    return json({ success: true, data: existing }, 200);
  }

  const now = Math.floor(Date.now() / 1000);
  const insertResult = await env.DB.prepare(
    `INSERT INTO reading_records
       (child_id, custom_book_id, start_time, duration_seconds,
        pages_read, total_pages, completed, created_at)
     VALUES (?1, ?2, ?3, 0, 1, ?4, 0, ?5)`,
  ).bind(childId, customBookId, now, book.page_count, now).run();

  const recordId = Number(insertResult.meta.last_row_id);
  const created = await env.DB.prepare(
    `SELECT * FROM reading_records WHERE id = ?1`,
  ).bind(recordId).first<ReadingRecordRow>();

  // 并发兜底：若并发请求已抢先插入，删除本行后返回已有记录，保持每 child+book 单条
  if (!created) {
    const raced = await getRecord(env, childId, customBookId);
    return json({ success: true, data: raced }, 200);
  }

  return json({ success: true, data: created }, 201);
}

/**
 * PATCH/POST /v1/reading-records/:customBookId
 * body: { child_id: string, pages_read?, duration_seconds?, completed? }
 */
async function handleUpdate(
  request: Request,
  env: Env,
  customBookIdRaw: string,
): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  const customBookId = Number(customBookIdRaw);
  if (!Number.isInteger(customBookId) || customBookId <= 0) {
    return json({ success: false, error: 'Invalid custom book id' }, 400);
  }

  let body: {
    child_id?: unknown;
    pages_read?: unknown;
    duration_seconds?: unknown;
    completed?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, 400);
  }

  const childId = typeof body.child_id === 'string' ? body.child_id.trim() : '';
  if (!childId) {
    return json({ success: false, error: 'child_id required' }, 400);
  }

  const ownership = await verifyChildOwnership(env, session.parent_id, childId);
  if (!ownership.ok) {
    return json({ success: false, error: ownership.error }, ownership.status);
  }

  const book = await getCustomBook(env, customBookId);
  if (!book) {
    return json({ success: false, error: 'Book not found' }, 404);
  }
  if (book.child_id !== childId) {
    return json({ success: false, error: 'Forbidden' }, 403);
  }

  const record = await getRecord(env, childId, customBookId);
  if (!record) {
    return json({ success: false, error: 'Record not found' }, 404);
  }

  const setClauses: string[] = [];
  const binds: (number | string)[] = [];

  // pages_read：整数，限制在 [1, 服务端实际页数]
  if (body.pages_read !== undefined) {
    const page = Number(body.pages_read);
    if (!Number.isInteger(page) || page < 1) {
      return json({ success: false, error: 'Invalid pages_read' }, 400);
    }
    const clamped = Math.min(page, book.page_count);
    setClauses.push('pages_read = ?');
    binds.push(clamped);
  }

  // duration_seconds：非负整数
  if (body.duration_seconds !== undefined) {
    const duration = Number(body.duration_seconds);
    if (!Number.isInteger(duration) || duration < 0) {
      return json({ success: false, error: 'Invalid duration_seconds' }, 400);
    }
    setClauses.push('duration_seconds = ?');
    binds.push(duration);
  }

  // completed：单向（只能 0→1，绝不翻回 0）；仅在完成事件写 end_time
  if (body.completed !== undefined) {
    if (typeof body.completed !== 'boolean') {
      return json({ success: false, error: 'Invalid completed' }, 400);
    }
    if (body.completed) {
      setClauses.push('completed = 1');
      setClauses.push('pages_read = ?');
      binds.push(book.page_count);
      // 仅在尚未完成时补 end_time，保留首次完成时间
      if (!record.completed) {
        setClauses.push('end_time = ?');
        binds.push(Math.floor(Date.now() / 1000));
      }
    }
    // completed=false：忽略，不允许撤销完成
  }

  if (setClauses.length > 0) {
    binds.push(childId, customBookId);
    await env.DB.prepare(
      `UPDATE reading_records SET ${setClauses.join(', ')}
       WHERE child_id = ? AND custom_book_id = ?`,
    ).bind(...binds).run();
  }

  const updated = await getRecord(env, childId, customBookId);
  return json({ success: true, data: updated }, 200);
}

/**
 * Reading Records 总入口。Service Key 由外层 /v1/ 统一校验，
 * 此处只负责 HMAC Session + 归属校验与分发。
 */
export async function handleReadingRecords(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  // ['v1', 'reading-records'] 或 ['v1', 'reading-records', ':id']

  if (request.method === 'POST' && segments.length === 2) {
    return handleCreate(request, env);
  }

  if (segments.length === 3 && (request.method === 'PATCH' || request.method === 'POST')) {
    return handleUpdate(request, env, segments[2]);
  }

  return json({ success: false, error: 'Method not allowed' }, 405);
}
