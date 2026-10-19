/**
 * P3-H-12F-2O Preview 缺 Key 零外发测试（纯 Mock，独立进程）
 *
 * proxyToWorker 与 reading 路由的 Service Key 为模块级常量，「缺 Key」场景
 * 必须在不设置 SRC_WORKER_SERVICE_KEY 的独立进程中验证。
 *
 * 覆盖：Preview + 生产 URL + 缺 Service Key → 503，fetch 调用次数 = 0。
 *
 * 运行：npx tsx src/app/api/lib/worker-egress-nokey.test.ts
 */

import { NextRequest } from 'next/server';

const PROD_URL = 'https://src-primary-api.quweizhongwen.workers.dev';

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

  // Vercel Preview 运行时特征：NODE_ENV=production，但不设置 Service Key
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  process.env.VERCEL_ENV = 'preview';
  process.env.WORKER_BASE_URL = PROD_URL;
  delete process.env.SRC_WORKER_SERVICE_KEY;
  delete process.env.SRC_WORKER_URL;
  delete process.env.SRC_PREVIEW_ALLOWED_WORKER_HOSTS;

  const { proxyToWorker } = await import('./worker-proxy');
  const readingRecords = await import('../reading-records/route');

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount++;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    // K1: proxyToWorker —— Preview + 生产 URL + 缺 Key → 503 零外发
    {
      const res = await proxyToWorker(
        new Request('http://localhost/api/books/writer/rewrites/1', { method: 'GET' }),
        '/v1/admin/rewrites/1',
      );
      check('K1 proxy preview+prodURL+no key -> 503', res.status === 503, `status=${res.status}`);
      check('K1 fetch 0', fetchCount === 0, `calls=${fetchCount}`);
    }

    // K2: reading —— Preview + 生产 URL（WORKER_BASE_URL 回退）+ 缺 Key → 503 零外发
    {
      const req = new NextRequest('http://localhost/api/reading-records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customBookId: 1, page: 1 }),
      });
      const res = await readingRecords.POST(req);
      check('K2 reading preview+prodURL+no key -> 503', res.status === 503, `status=${res.status}`);
      check('K2 fetch 0', fetchCount === 0, `calls=${fetchCount}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\nRESULT PASS=${passed} FAIL=${failed}`);
  if (failed > 0) process.exit(1);
}

void main();
