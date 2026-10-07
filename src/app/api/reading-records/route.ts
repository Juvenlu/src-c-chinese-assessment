import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.SRC_WORKER_URL || 'https://src-primary-api.quweizhongwen.workers.dev';
const WORKER_KEY = process.env.SRC_WORKER_SERVICE_KEY;

// POST /api/reading-records -> Worker POST /v1/reading-records
// Service Key 仅在服务端持有并转发，浏览器 Session Cookie 原样透传。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const response = await fetch(`${WORKER_URL}/v1/reading-records`, {
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
