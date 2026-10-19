/**
 * P3-H-12F-2M 零外发安全测试（纯 Mock，不发任何真实请求）
 *
 * 在 handler 层 mock 全局 fetch，断言：
 * - Preview 即使误配置 Production URL + 有效 Service Key，fetch 调用次数必须为 0；
 * - Preview 白名单外/缺失白名单 → 503 零外发；
 * - Preview 白名单内非生产 Worker → 放行到该主机；
 * - Production 保持原有透传行为；
 * - 本地/未知环境默认禁止 Production，opt-in 后才放行；
 * - reading 路由在仅配置 WORKER_BASE_URL（生产实际情况）时：Preview 阻断、Production 兼容。
 *
 * 运行：npx tsx src/app/api/lib/worker-egress.test.ts
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

  // 模块加载期常量（SERVICE_KEY / WORKER_ENABLED）需在动态 import 前设定。
  // Vercel Preview 与 Production 运行时 NODE_ENV 均为 'production'。
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  process.env.SRC_WORKER_SERVICE_KEY = SERVICE_KEY;
  delete process.env.VERCEL_ENV;
  delete process.env.WORKER_BASE_URL;
  delete process.env.SRC_WORKER_URL;
  delete process.env.SRC_PREVIEW_ALLOWED_WORKER_HOSTS;
  delete process.env.SRC_ALLOW_PROD_WORKER;

  const { proxyToWorker } = await import('./worker-proxy');
  const readingRecords = await import('../reading-records/route');

  // ---- 全局 fetch Mock（绝不发起真实网络请求）----
  const originalFetch = globalThis.fetch;
  let fetchCalls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const setEnv = (patch: Record<string, string | undefined>): void => {
    for (const k of [
      'VERCEL_ENV',
      'WORKER_BASE_URL',
      'SRC_WORKER_URL',
      'SRC_PREVIEW_ALLOWED_WORKER_HOSTS',
      'SRC_ALLOW_PROD_WORKER',
    ]) {
      delete process.env[k];
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fetchCalls = [];
  };

  const jsonRequest = (): NextRequest =>
    new NextRequest('http://localhost/api/reading-records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customBookId: 1, page: 1 }),
    });

  // 精确 URL 断言：完整匹配 + pathname 不得含意外双斜杠
  const checkExactUrl = (name: string, actual: string | undefined, expected: string): void => {
    check(`${name} exact url`, actual === expected, `expected=${expected} actual=${actual}`);
    if (actual) {
      const p = new URL(actual).pathname;
      check(`${name} pathname no '//'`, !p.includes('//'), `pathname=${p}`);
    }
  };

  try {
    // ============ proxyToWorker 矩阵 ============

    // E1: Preview + Production URL + 有效 Key → 503，fetch 0 次
    {
      setEnv({ VERCEL_ENV: 'preview', WORKER_BASE_URL: PROD_URL });
      const res = await proxyToWorker(
        new Request('http://localhost/api/books/versioning/rewrite/1/activate', { method: 'POST' }),
        '/v1/admin/rewrite/1/activate',
      );
      check('E1 preview+prodURL+key -> 503', res.status === 503, `status=${res.status}`);
      check('E1 preview+prodURL+key -> fetch 0 calls', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // E2: Preview + 非生产 URL 但无白名单 → 503，fetch 0 次
    {
      setEnv({ VERCEL_ENV: 'preview', WORKER_BASE_URL: STAGING_URL });
      const res = await proxyToWorker(
        new Request('http://localhost/api/books/writer/rewrites/1', { method: 'GET' }),
        '/v1/admin/rewrites/1',
      );
      check('E2 preview+stagingURL no allowlist -> 503', res.status === 503, `status=${res.status}`);
      check('E2 preview+stagingURL no allowlist -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // E3: Preview + 白名单内非生产 URL → 200，fetch 恰好 1 次且主机为 staging
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
      check('E3 preview+allowlisted staging -> 200', res.status === 200, `status=${res.status}`);
      check('E3 fetch exactly 1', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
      checkExactUrl('E3 staging', fetchCalls[0], `${STAGING_URL}/v1/admin/rewrites/2`);
    }

    // E4: Production + Production URL → 200 透传，fetch 1 次到生产主机
    {
      setEnv({ VERCEL_ENV: 'production', WORKER_BASE_URL: PROD_URL });
      const res = await proxyToWorker(
        new Request('http://localhost/api/admin/children', { method: 'GET' }),
        '/v1/admin/children',
      );
      check('E4 production+prodURL -> 200 passthrough', res.status === 200, `status=${res.status}`);
      check('E4 fetch exactly 1', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
      checkExactUrl('E4 prod proxy', fetchCalls[0], `${PROD_URL}/v1/admin/children`);
    }

    // E4b: Preview + 伪造相似域名（子串欺骗）→ 503 零外发
    {
      setEnv({
        VERCEL_ENV: 'preview',
        WORKER_BASE_URL: 'https://src-primary-api.quweizhongwen.workers.dev.evil.com',
        SRC_PREVIEW_ALLOWED_WORKER_HOSTS: 'src-primary-api.quweizhongwen.workers.dev',
      });
      const res = await proxyToWorker(
        new Request('http://localhost/api/admin/children', { method: 'GET' }),
        '/v1/admin/children',
      );
      check('E4b look-alike spoof domain rejected -> 503', res.status === 503, `status=${res.status}`);
      check('E4b spoof domain -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // ============ reading 路由矩阵（SRC_WORKER_URL → WORKER_BASE_URL 回退链）============

    // E5: Preview，生产真实配置（仅 WORKER_BASE_URL，无 SRC_WORKER_URL）→ 503 零外发
    {
      setEnv({ VERCEL_ENV: 'preview', WORKER_BASE_URL: PROD_URL });
      const res = await readingRecords.POST(jsonRequest());
      check('E5 preview reading only WORKER_BASE_URL(prod) -> 503', res.status === 503, `status=${res.status}`);
      check('E5 preview reading -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // E6: Production，生产真实配置（仅 WORKER_BASE_URL）→ 200，功能不回归
    {
      setEnv({ VERCEL_ENV: 'production', WORKER_BASE_URL: PROD_URL });
      const res = await readingRecords.POST(jsonRequest());
      check('E6 production reading fallback WORKER_BASE_URL -> 200', res.status === 200, `status=${res.status}`);
      check('E6 fetch exactly 1', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
      checkExactUrl('E6 prod reading', fetchCalls[0], `${PROD_URL}/v1/reading-records`);
    }

    // E7: 本地/未知环境 + Production URL，未 opt-in → 503 零外发
    {
      setEnv({ SRC_WORKER_URL: PROD_URL });
      const res = await readingRecords.POST(jsonRequest());
      check('E7 local+prodURL no opt-in -> 503', res.status === 503, `status=${res.status}`);
      check('E7 local -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // E8: 本地 + Production URL + SRC_ALLOW_PROD_WORKER=true → 放行
    {
      setEnv({ SRC_WORKER_URL: PROD_URL, SRC_ALLOW_PROD_WORKER: 'true' });
      const res = await readingRecords.POST(jsonRequest());
      check('E8 local+prodURL+opt-in -> 200', res.status === 200, `status=${res.status}`);
      check('E8 local opt-in -> fetch 1', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
      checkExactUrl('E8 local opt-in', fetchCalls[0], `${PROD_URL}/v1/reading-records`);
    }

    // E10: Preview + 非法 URL → 503 零外发
    {
      setEnv({ VERCEL_ENV: 'preview', SRC_WORKER_URL: 'not-a-valid-url' });
      const res = await readingRecords.POST(jsonRequest());
      check('E10 preview invalid URL -> 503', res.status === 503, `status=${res.status}`);
      check('E10 invalid URL -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // E9: Preview + 非 HTTPS 的 staging URL → 503 零外发
    {
      setEnv({
        VERCEL_ENV: 'preview',
        SRC_WORKER_URL: 'http://src-staging-api.prezone.example.com',
        SRC_PREVIEW_ALLOWED_WORKER_HOSTS: 'src-staging-api.prezone.example.com',
      });
      const res = await readingRecords.POST(jsonRequest());
      check('E9 preview non-https URL -> 503', res.status === 503, `status=${res.status}`);
      check('E9 non-https -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\nRESULT PASS=${passed} FAIL=${failed}`);
  if (failed > 0) process.exit(1);
}

void main();
