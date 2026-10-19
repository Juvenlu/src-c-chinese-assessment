/**
 * P3-H-12F-2O Production 精确 URL 测试（纯 Mock，零真实请求）
 *
 * 19 个直连路由在模块加载期解析 Worker URL（模块级 const），因此本文件在
 * 独立进程中运行：import 之前固定 VERCEL_ENV=production 等环境，确保模块级
 * 快照为 Production 语义。
 *
 * 覆盖：
 * - Production Auth：GET /v1/auth/me 精确 URL
 * - Production Growth Map：GET /v1/growth-map 精确 URL（含 child_id 查询）
 * - 直连路由代表：GET /v1/children 精确 URL
 * - 全部断言完整 URL 相等，且 pathname 不含意外的 '//'
 * - 认证头 X-SRC-Service-Key 与 Cookie 透传保持不变
 *
 * 运行：npx tsx src/app/api/lib/worker-egress-production.test.ts
 */

import { NextRequest } from 'next/server';

const PROD_URL = 'https://src-primary-api.quweizhongwen.workers.dev';
const SERVICE_KEY = 'test-service-key-not-a-secret';

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean, detail = ''): void => {
    if (cond) {
      passed++;
      console.log(`PASS: ${name}`);
    } else {
      failed++;
      console.log(`FAIL: ${name} ${detail}`);
    }
  };

  // ---- 模块 import 前固定 Production 环境（模块级快照）----
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  process.env.VERCEL_ENV = 'production';
  process.env.WORKER_BASE_URL = PROD_URL;
  process.env.SRC_WORKER_SERVICE_KEY = SERVICE_KEY;
  process.env.WORKER_GUEST_API_ENABLED = 'true';
  delete process.env.SRC_WORKER_URL;
  delete process.env.SRC_PREVIEW_ALLOWED_WORKER_HOSTS;
  delete process.env.SRC_ALLOW_PROD_WORKER;

  const authMe = await import('../auth/me/route');
  const growthMap = await import('../growth-map/route');
  const children = await import('../children/route');

  // ---- 全局 fetch Mock ----
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ ok: true, children: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const checkExactUrl = (name: string, actual: string | undefined, expected: string): void => {
    check(`${name} exact url`, actual === expected, `expected=${expected} actual=${actual}`);
    if (actual) {
      const p = new URL(actual).pathname;
      check(`${name} pathname no '//'`, !p.includes('//'), `pathname=${p}`);
    }
  };

  try {
    // P1: Production Auth —— GET /v1/auth/me 精确 URL + 认证头保持
    {
      const req = new NextRequest('http://localhost/api/auth/me', {
        method: 'GET',
        headers: { cookie: 'src_auth_session=test-session' },
      });
      const res = await authMe.GET(req);
      check('P1 auth/me -> 200', res.status === 200, `status=${res.status}`);
      check('P1 fetch exactly 1', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
      checkExactUrl('P1', fetchCalls[0]?.url, `${PROD_URL}/v1/auth/me`);
      check(
        'P1 X-SRC-Service-Key passthrough',
        fetchCalls[0]?.headers.get('x-src-service-key') === SERVICE_KEY,
        `got=${fetchCalls[0]?.headers.get('x-src-service-key')}`,
      );
      check(
        'P1 Cookie passthrough',
        fetchCalls[0]?.headers.get('cookie') === 'src_auth_session=test-session',
        `got=${fetchCalls[0]?.headers.get('cookie')}`,
      );
      fetchCalls.length = 0;
    }

    // P2: Production Growth Map —— GET /v1/growth-map?child_id=... 精确 URL
    {
      const req = new NextRequest('http://localhost/api/growth-map?child_id=child-123', { method: 'GET' });
      const res = await growthMap.GET(req);
      check('P2 growth-map -> 200', res.status === 200, `status=${res.status}`);
      check('P2 fetch exactly 1', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
      checkExactUrl('P2', fetchCalls[0]?.url, `${PROD_URL}/v1/growth-map?child_id=child-123`);
      fetchCalls.length = 0;
    }

    // P3: 直连路由代表 —— GET /v1/children 精确 URL
    {
      const req = new NextRequest('http://localhost/api/children', { method: 'GET' });
      const res = await children.GET(req);
      check('P3 children -> 200', res.status === 200, `status=${res.status}`);
      check('P3 fetch exactly 1', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
      checkExactUrl('P3', fetchCalls[0]?.url, `${PROD_URL}/v1/children`);
      fetchCalls.length = 0;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\nRESULT PASS=${passed} FAIL=${failed}`);
  if (failed > 0) process.exit(1);
}

void main();
