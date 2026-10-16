/**
 * P3-H-12F-2O Redirect 防护 + 纯 Origin 非法 base 测试（纯 Mock，零真实请求）
 *
 * 核心验证：
 * - 所有发往 Worker 的 fetch 都带 redirect:'manual'；
 * - 上游返回 302 + Location 指向 Production 时，handler 不发起第二次外发，
 *   请求目标永不变成 Production，且不向调用方暴露 Location；
 * - path-prefix / query 等非纯 Origin base 被守卫拒绝，503 且 fetch=0。
 *
 * 运行：npx tsx src/app/api/lib/worker-egress-redirect.test.ts
 */

import { NextRequest } from 'next/server';

const PROD_URL = 'https://src-primary-api.quweizhongwen.workers.dev';
const STAGING_URL = 'https://src-staging-api.prezone.example.com';
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

  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  process.env.SRC_WORKER_SERVICE_KEY = SERVICE_KEY;
  delete process.env.VERCEL_ENV;
  delete process.env.WORKER_BASE_URL;
  delete process.env.SRC_WORKER_URL;
  delete process.env.SRC_PREVIEW_ALLOWED_WORKER_HOSTS;

  const { proxyToWorker } = await import('./worker-proxy');
  const readingRecords = await import('../reading-records/route');

  const originalFetch = globalThis.fetch;
  let calls: Array<{ url: string; redirect?: string }> = [];
  let nextStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), redirect: init?.redirect });
    if (nextStatus === 302) {
      // 模拟 Staging 恶意/异常地把请求重定向到 Production
      return new Response('', {
        status: 302,
        headers: { location: `${PROD_URL}/v1/admin/rewrites/2`, 'content-type': 'text/plain' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const setEnv = (patch: Record<string, string | undefined>): void => {
    for (const k of ['VERCEL_ENV', 'WORKER_BASE_URL', 'SRC_WORKER_URL', 'SRC_PREVIEW_ALLOWED_WORKER_HOSTS']) {
      delete process.env[k];
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    calls = [];
    nextStatus = 200;
  };

  const jsonRequest = (): NextRequest =>
    new NextRequest('http://localhost/api/reading-records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customBookId: 1, page: 1 }),
    });

  try {
    // R1: Preview → 白名单 Staging 正常请求，且 init 强制 redirect:'manual'
    {
      setEnv({
        VERCEL_ENV: 'preview',
        WORKER_BASE_URL: STAGING_URL,
        SRC_PREVIEW_ALLOWED_WORKER_HOSTS: 'src-staging-api.prezone.example.com',
      });
      const res = await proxyToWorker(
        new Request('http://localhost/api/books/writer/rewrites/2', { method: 'GET' }),
        '/v1/admin/rewrites/2',
      );
      check('R1 preview->staging 200', res.status === 200, `status=${res.status}`);
      check('R1 fetch exactly 1', calls.length === 1, `calls=${calls.length}`);
      check("R1 init.redirect === 'manual'", calls[0]?.redirect === 'manual', `got=${calls[0]?.redirect}`);
    }

    // R2: Staging 返回 302 + Location 指向 Production → 不得二次外发，目标不变
    {
      setEnv({
        VERCEL_ENV: 'preview',
        WORKER_BASE_URL: STAGING_URL,
        SRC_PREVIEW_ALLOWED_WORKER_HOSTS: 'src-staging-api.prezone.example.com',
      });
      nextStatus = 302;
      const res = await proxyToWorker(
        new Request('http://localhost/api/books/writer/rewrites/2', { method: 'GET' }),
        '/v1/admin/rewrites/2',
      );
      check('R2 302 -> fetch exactly 1 (no follow)', calls.length === 1, `calls=${calls.length}`);
      check('R2 fetch target stayed staging (never prod)', calls[0]?.url.startsWith(STAGING_URL), `url=${calls[0]?.url}`);
      check('R2 no fetch to production host', !calls.some((c) => c.url.startsWith(PROD_URL)));
      check("R2 init.redirect === 'manual'", calls[0]?.redirect === 'manual');
      // manual 模式下 302 状态透传，且不暴露 Location
      check('R2 response status 302 (not followed)', res.status === 302, `status=${res.status}`);
      check('R2 response has no Location header', !res.headers.get('location'), `loc=${res.headers.get('location')}`);
    }

    // R3: reading 路由 302 → 不二次外发（直连代表）
    {
      setEnv({
        VERCEL_ENV: 'preview',
        SRC_WORKER_URL: STAGING_URL,
        SRC_PREVIEW_ALLOWED_WORKER_HOSTS: 'src-staging-api.prezone.example.com',
      });
      nextStatus = 302;
      await readingRecords.POST(jsonRequest());
      check('R3 reading 302 -> fetch exactly 1', calls.length === 1, `calls=${calls.length}`);
      check('R3 reading target stayed staging', calls[0]?.url.startsWith(STAGING_URL), `url=${calls[0]?.url}`);
      check("R3 reading init.redirect === 'manual'", calls[0]?.redirect === 'manual');
    }

    // R4: path-prefix 非法 base → 拒绝，fetch=0
    {
      setEnv({ VERCEL_ENV: 'production', WORKER_BASE_URL: `${STAGING_URL}/api/` });
      const res = await readingRecords.POST(jsonRequest());
      check('R4 path-prefix base rejected -> 503', res.status === 503, `status=${res.status}`);
      check('R4 fetch 0', calls.length === 0, `calls=${calls.length}`);
    }

    // R5: query 非法 base → 拒绝，fetch=0
    {
      setEnv({ VERCEL_ENV: 'production', WORKER_BASE_URL: `${STAGING_URL}/?x=1` });
      const res = await readingRecords.POST(jsonRequest());
      check('R5 query base rejected -> 503', res.status === 503, `status=${res.status}`);
      check('R5 fetch 0', calls.length === 0, `calls=${calls.length}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\nRESULT PASS=${passed} FAIL=${failed}`);
  if (failed > 0) process.exit(1);
}

void main();
