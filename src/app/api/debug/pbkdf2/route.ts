import { NextRequest, NextResponse } from 'next/server';

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const DIAG_PASSWORD = process.env.DIAG_PASSWORD || '';

/**
 * GET /api/debug/pbkdf2?iterations=200000
 * GET /api/debug/pbkdf2/batch?list=1000,10000,100000,200000
 *
 * 只读诊断端点 — 通过 Vercel → Worker 链路，
 * 测试 Cloudflare Worker Production 中 PBKDF2 deriveBits 表现。
 *
 * 不修改任何数据，不涉及真实用户密码。
 * 仅用于排查 Production NotSupportedError 根因。
 *
 * 鉴权：需要 X-Diag-Password header = DIAG_PASSWORD 环境变量
 * （不是正式业务接口，简化鉴权，用完即删）
 */
export async function GET(req: NextRequest) {
  // 鉴权：诊断密码
  const provided = req.headers.get('x-diag-password');
  if (!DIAG_PASSWORD || provided !== DIAG_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!WORKER_GUEST_API_ENABLED || !WORKER_BASE_URL || !SRC_WORKER_SERVICE_KEY) {
    return NextResponse.json(
      { error: 'Worker not configured' },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    let workerPath = '/debug/pbkdf2';
    if (path.includes('/batch')) {
      workerPath = `/debug/pbkdf2/batch?list=${url.searchParams.get('list') || '1000,10000,100000,200000'}`;
    } else {
      workerPath = `/debug/pbkdf2?iterations=${url.searchParams.get('iterations') || '1000'}`;
    }

    const res = await fetch(`${WORKER_BASE_URL}${workerPath}`, {
      method: 'GET',
      headers: {
        'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY,
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { error: 'Diagnostic failed', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 },
    );
  }
}
