import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * GET /api/admin/verify
 * 管理员身份验证（登录门禁专用）
 *
 * - 无数据库依赖：不访问 Supabase / D1 / Worker / 任何外部服务
 * - 预期口令仅来自服务端 process.env.ADMIN_PASSWORD，无硬编码兜底
 * - env 缺失 → 503（fail-closed）；凭据错/缺 → 401；正确 → 200 { ok: true }
 * - 恒定时间比较（SHA-256 预哈希归一化长度 + timingSafeEqual），避免时序侧信道
 * - 所有响应 Cache-Control: no-store，禁止缓存验证结果
 * - 不记录、不返回、不泄露口令
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export async function GET(request: Request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: '服务配置错误' },
      { status: 503, headers: NO_STORE }
    );
  }
  const provided = request.headers.get('x-admin-password');
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE }
    );
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}
