import { Env } from './types';

// D1 reading_records 逻辑处理
export async function handleReadingRecords(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathSegments = url.pathname.split('/').filter(Boolean); // e.g. ['v1', 'reading-records', ':customBookId']

  // 校验 Auth 头（确认来自 Vercel 内部 API Proxy 的合法请求）
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${env.SRC_WORKER_SERVICE_KEY}`) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /v1/reading-records -> 获取或初始化阅读记录
  if (request.method === 'POST' && pathSegments.length === 2) {
    try {
      const body = await request.json() as { child_id: number; custom_book_id: number; total_pages: number };
      const { child_id, custom_book_id, total_pages } = body;

      if (!child_id || !custom_book_id || typeof total_pages !== 'number') {
        return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 查询是否已有记录
      const existing = await env.DB.prepare(
        'SELECT * FROM reading_records WHERE child_id = ? AND custom_book_id = ?'
      ).bind(child_id, custom_book_id).first();

      if (existing) {
        return new Response(JSON.stringify({ success: true, data: existing }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 插入新记录
      const now = new Date().toISOString();
      const insertResult = await env.DB.prepare(
        `INSERT INTO reading_records 
        (child_id, custom_book_id, start_time, duration_seconds, pages_read, total_pages, completed, created_at)
        VALUES (?, ?, ?, 0, 1, ?, 0, ?)`
      ).bind(child_id, custom_book_id, now, total_pages, now).run();

      const newRecord = await env.DB.prepare(
        'SELECT * FROM reading_records WHERE id = ?'
      ).bind(insertResult.meta.last_row_id).first();

      return new Response(JSON.stringify({ success: true, data: newRecord }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // PATCH /v1/reading-records/:customBookId -> 更新进度/完成状态
  if ((request.method === 'PATCH' || request.method === 'POST') && pathSegments.length === 3) {
    try {
      const customBookId = parseInt(pathSegments[2], 10);
      const body = await request.json() as {
        child_id: number;
        pages_read?: number;
        duration_seconds?: number;
        completed?: boolean;
      };
      const { child_id, pages_read, duration_seconds, completed } = body;

      const record = await env.DB.prepare(
        'SELECT * FROM reading_records WHERE child_id = ? AND custom_book_id = ?'
      ).bind(child_id, customBookId).first();

      if (!record) {
        return new Response(JSON.stringify({ success: false, error: 'Record not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const updates: string[] = [];
      const params: any[] = [];

      if (typeof pages_read === 'number') {
        updates.push('pages_read = ?');
        params.push(pages_read);
      }
      if (typeof duration_seconds === 'number') {
        updates.push('duration_seconds = ?');
        params.push(duration_seconds);
      }
      if (typeof completed === 'boolean') {
        updates.push('completed = ?');
        params.push(completed ? 1 : 0);
        if (completed) {
          updates.push('end_time = ?');
          params.push(new Date().toISOString());
        }
      }

      if (updates.length === 0) {
        return new Response(JSON.stringify({ success: true, data: record }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      params.push(child_id, customBookId);
      await env.DB.prepare(
        `UPDATE reading_records SET ${updates.join(', ')} WHERE child_id = ? AND custom_book_id = ?`
      ).bind(...params).run();

      const updatedRecord = await env.DB.prepare(
        'SELECT * FROM reading_records WHERE child_id = ? AND custom_book_id = ?'
      ).bind(child_id, customBookId).first();

      return new Response(JSON.stringify({ success: true, data: updatedRecord }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}
