import { NextRequest, NextResponse } from "next/server";
import { resolveWorkerUrl, WORKER_FETCH_INIT } from '../../../../lib/worker-target';

/**
 * 管理员 — 拒绝密码重置申请（P5-R1B）
 *
 * POST /api/admin/password-resets/[id]/reject  →  POST /v1/admin/password-resets/:id/reject
 *
 * 鉴权：x-admin-password（Vercel 层不验证，转发给 Worker）。
 * 安全：必须提供 reject_reason，记录操作人与时间；未核实身份不得批准。
 */
const WORKER_BASE_URL = resolveWorkerUrl(process.env.WORKER_BASE_URL, process.env);
const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
  console.error('[admin/password-resets/reject] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!WORKER_BASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ success: false, error: '服务配置错误' }, { status: 500 });
  }

  try {
    const { id } = await params;
    const adminPwd = req.headers.get('x-admin-password') || '';

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const res = await fetch(`${WORKER_BASE_URL}/v1/admin/password-resets/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPwd,
        'X-SRC-Service-Key': SERVICE_KEY,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      ...WORKER_FETCH_INIT,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    console.error('[admin/password-resets/reject] proxy error:', e);
    return NextResponse.json({ success: false, error: '网络错误' }, { status: 502 });
  }
}