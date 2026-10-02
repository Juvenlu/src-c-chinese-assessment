import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.SRC_WORKER_URL || 'https://src-primary-api.quweizhongwen.workers.dev';
const WORKER_KEY = process.env.SRC_WORKER_SERVICE_KEY;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const response = await fetch(`${WORKER_URL}/v1/reading-records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WORKER_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
