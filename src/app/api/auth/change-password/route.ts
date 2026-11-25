import { NextRequest, NextResponse } from "next/server";
import { resolveWorkerUrl, WORKER_FETCH_INIT } from '../../lib/worker-target';

/**
 * 修改密码（P5-R1B 修复：直连 Supabase/bcrypt → Worker → D1）
 *
 * POST /api/auth/change-password  →  POST /v1/auth/change-password
 *
 * 修复内容：
 *   - 原实现直连已废弃 Supabase 旧库 + bcryptjs，Production 密码必须只写入唯一权威 D1
 *   - 统一使用 Worker Argon2id 哈希
 *   - 修复前后端字段错配：前端发 old_password/new_password（snake_case），
 *     原 route 解构 oldPassword/newPassword（camelCase）导致 400/校验永远失败
 *   - Worker 内校验旧密码 → 原子递增 session_version（全部旧 Session 失效）→ 签发新 Session
 *
 * 鉴权：透传 Cookie（src_auth_session），Worker getAuthedSession 核验
 */
const WORKER_BASE_URL = resolveWorkerUrl(process.env.WORKER_BASE_URL, process.env);
const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
  console.error('[auth/change-password] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!WORKER_BASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ success: false, error: '服务配置错误' }, { status: 500 });
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const res = await fetch(`${WORKER_BASE_URL}/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SRC-Service-Key': SERVICE_KEY,
        Cookie: req.headers.get('cookie') || '',
      },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
      ...WORKER_FETCH_INIT,
    });

    const data = await res.json();
    const nextResponse = NextResponse.json(data, { status: res.status });

    // 透传 Set-Cookie（Worker 签发的新 Session Cookie）
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      nextResponse.headers.set('set-cookie', setCookie);
    }

    return nextResponse;
  } catch (e: unknown) {
    console.error('[auth/change-password] proxy error:', e);
    return NextResponse.json({ success: false, error: '网络错误' }, { status: 502 });
  }
}