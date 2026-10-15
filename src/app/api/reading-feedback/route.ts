import { NextRequest, NextResponse } from 'next/server';
import { resolveWorkerUrl } from '../lib/worker-target';

const WORKER_KEY = process.env.SRC_WORKER_SERVICE_KEY;

// GET /api/reading-feedback?child_id=&custom_book_id=
//   -> Worker GET /v1/reading-feedback
// Service Key 仅服务端转发，浏览器 Session Cookie 原样透传。
// Worker URL 经统一守卫解析：Preview 禁止 Production，缺失/非法时零外发拒绝。
export async function GET(req: NextRequest) {
  // SRC_WORKER_URL 未配置时回退 WORKER_BASE_URL（生产行为兼容）；两者均经统一守卫解析。
  const WORKER_URL = resolveWorkerUrl(process.env.SRC_WORKER_URL ?? process.env.WORKER_BASE_URL, process.env);
  if (!WORKER_URL || !WORKER_KEY) {
    return NextResponse.json({ success: false, error: 'Worker 未配置或当前环境禁止访问' }, { status: 503 });
  }
  try {
    const qs = req.nextUrl.search;
    const response = await fetch(`${WORKER_URL}/v1/reading-feedback${qs}`, {
      method: 'GET',
      headers: {
        'X-SRC-Service-Key': WORKER_KEY || '',
        'Cookie': req.headers.get('cookie') || '',
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST /api/reading-feedback
//   -> Worker POST /v1/reading-feedback（upsert，支持部分更新）
export async function POST(req: NextRequest) {
  // SRC_WORKER_URL 未配置时回退 WORKER_BASE_URL（生产行为兼容）；两者均经统一守卫解析。
  const WORKER_URL = resolveWorkerUrl(process.env.SRC_WORKER_URL ?? process.env.WORKER_BASE_URL, process.env);
  if (!WORKER_URL || !WORKER_KEY) {
    return NextResponse.json({ success: false, error: 'Worker 未配置或当前环境禁止访问' }, { status: 503 });
  }
  try {
    const body = await req.json();

    const response = await fetch(`${WORKER_URL}/v1/reading-feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SRC-Service-Key': WORKER_KEY || '',
        'Cookie': req.headers.get('cookie') || '',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
