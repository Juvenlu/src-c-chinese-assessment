/**
 * P4-T4 Session 班级代理安全测试（纯 Mock，不发任何真实请求）
 *
 * 在 handler 层 mock 全局 fetch，断言：
 * - Preview 即使误配置 Production URL + 有效 Service Key，fetch 调用次数必须为 0；
 * - Preview 白名单外 → 503 零外发；白名单内 → 放行；
 * - Service Key 仅服务端注入（请求头发往 Worker，浏览器不可见）；
 * - Cookie（src_auth_session）原样透传；x-session 不透传（Worker 仅识别 Cookie）；
 * - POST body 原样透传；Worker 401/403 状态码与错误文案原样透传；
 * - Production 缺配置（Key 或 enabled 开关缺失）fail-fast 500。
 *
 * 运行：npx tsx src/app/api/lib/session-proxy.test.ts
 */

import { NextRequest } from 'next/server';

const PROD_URL = 'https://src-primary-api.quweizhongwen.workers.dev';
const PREVIEW_URL = 'https://src-primary-api-preview.quweizhongwen.workers.dev';
const SERVICE_KEY = 'test-service-key-not-a-secret';
const SESSION_COOKIE = 'src_auth_session=test-session-token-not-a-secret';

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

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

  // 模块加载期常量（IS_PRODUCTION）需在动态 import 前设定。
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  delete process.env.VERCEL_ENV;
  delete process.env.WORKER_BASE_URL;
  delete process.env.SRC_WORKER_SERVICE_KEY;
  delete process.env.WORKER_GUEST_API_ENABLED;
  delete process.env.SRC_PREVIEW_ALLOWED_WORKER_HOSTS;

  const { proxySessionToWorker } = await import('./session-proxy');

  // ---- 全局 fetch Mock（绝不发起真实网络请求）----
  const originalFetch = globalThis.fetch;
  let fetchCalls: FetchCall[] = [];
  let mockStatus = 200;
  let mockBody = '{"ok":true}';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers as Record<string, string> | undefined;
    if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    fetchCalls.push({
      url: String(input),
      method: init?.method || 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(mockBody, {
      status: mockStatus,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const setEnv = (patch: Record<string, string | undefined>): void => {
    for (const k of [
      'VERCEL_ENV',
      'WORKER_BASE_URL',
      'SRC_WORKER_SERVICE_KEY',
      'WORKER_GUEST_API_ENABLED',
      'SRC_PREVIEW_ALLOWED_WORKER_HOSTS',
    ]) {
      delete process.env[k];
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fetchCalls = [];
    mockStatus = 200;
    mockBody = '{"ok":true}';
  };

  const authedRequest = (method = 'GET', body?: unknown): NextRequest =>
    new NextRequest('http://localhost/api/classes', {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: SESSION_COOKIE,
        'x-session': 'browser-x-session-should-not-forward',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const fullConfig = {
    WORKER_BASE_URL: PREVIEW_URL,
    SRC_WORKER_SERVICE_KEY: SERVICE_KEY,
    WORKER_GUEST_API_ENABLED: 'true',
  };

  try {
    // S1: Preview + Production URL + 有效 Key → 拒绝，fetch 0 次（隔离守卫）
    {
      setEnv({ VERCEL_ENV: 'preview', WORKER_BASE_URL: PROD_URL });
      process.env.SRC_WORKER_SERVICE_KEY = SERVICE_KEY;
      process.env.WORKER_GUEST_API_ENABLED = 'true';
      const res = await proxySessionToWorker(authedRequest(), '/v1/classes', 'test');
      check('S1 preview+prodURL -> 503', res.status === 503, `status=${res.status}`);
      check('S1 preview+prodURL -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // S2: Preview + 白名单缺失 → 503，fetch 0 次
    {
      setEnv({
        VERCEL_ENV: 'preview',
        ...fullConfig,
      });
      const res = await proxySessionToWorker(authedRequest(), '/v1/classes', 'test');
      check('S2 preview no allowlist -> 503', res.status === 503, `status=${res.status}`);
      check('S2 preview no allowlist -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // S3: Preview + 白名单内 Preview Worker → 放行；断言 URL/Key/Cookie
    {
      setEnv({
        VERCEL_ENV: 'preview',
        ...fullConfig,
        SRC_PREVIEW_ALLOWED_WORKER_HOSTS: 'src-primary-api-preview.quweizhongwen.workers.dev',
      });
      const res = await proxySessionToWorker(authedRequest(), '/v1/classes', 'test');
      check('S3 preview allowlisted -> 200', res.status === 200, `status=${res.status}`);
      check('S3 fetch 1 call', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
      const c = fetchCalls[0];
      check(
        'S3 exact url',
        c?.url === `${PREVIEW_URL}/v1/classes`,
        `url=${c?.url}`,
      );
      check(
        'S3 service key injected',
        c?.headers['x-src-service-key'] === SERVICE_KEY,
        `key=${c?.headers['x-src-service-key'] ? '[present]' : '[missing]'}`,
      );
      check(
        'S3 cookie forwarded',
        c?.headers['cookie'] === SESSION_COOKIE,
        `cookie=${c?.headers['cookie']}`,
      );
      check(
        'S3 x-session NOT forwarded',
        c?.headers['x-session'] === undefined,
        `x-session=${c?.headers['x-session']}`,
      );
      // redirect: manual 由 WORKER_FETCH_INIT 提供（防 3xx 转发泄露 Key）
    }

    // S4: Production(VERCEL_ENV=production) + 配置齐 → 透传 Worker 状态码与文案
    {
      setEnv({ VERCEL_ENV: 'production', ...fullConfig });
      mockStatus = 403;
      mockBody = '{"error":"无权访问"}';
      const res = await proxySessionToWorker(authedRequest(), '/v1/classes', 'test');
      check('S4 prod worker 403 passthrough', res.status === 403, `status=${res.status}`);
      const text = await res.text();
      check('S4 prod worker body passthrough', text.includes('无权访问'), `body=${text}`);
    }

    // S5: Production + 缺 Service Key → fail-fast 500，fetch 0 次
    {
      setEnv({ VERCEL_ENV: 'production', WORKER_BASE_URL: PROD_URL, WORKER_GUEST_API_ENABLED: 'true' });
      const res = await proxySessionToWorker(authedRequest(), '/v1/classes', 'test');
      check('S5 prod missing key -> 500', res.status === 500, `status=${res.status}`);
      check('S5 prod missing key -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // S6: Production + 缺 enabled 开关（WORKER_GUEST_API_ENABLED 缺失）→ fail-fast 500
    // （IS_PRODUCTION 为模块加载期常量，与 worker-proxy 一致；本地未配置 503 分支
    // 仅在 NODE_ENV !== 'production' 的进程启动方式下生效，本测试进程内不可测）
    {
      setEnv({ VERCEL_ENV: 'production', WORKER_BASE_URL: PROD_URL, SRC_WORKER_SERVICE_KEY: SERVICE_KEY });
      const res = await proxySessionToWorker(authedRequest(), '/v1/classes', 'test');
      check('S6 prod missing enabled flag -> 500', res.status === 500, `status=${res.status}`);
      check('S6 prod missing enabled -> fetch 0', fetchCalls.length === 0, `calls=${fetchCalls.length}`);
    }

    // S7: POST body 原样透传（join 场景）
    {
      setEnv({ VERCEL_ENV: 'production', ...fullConfig });
      const joinBody = { invite_code: 'ABC123', child_id: 'child-uuid' };
      await proxySessionToWorker(authedRequest('POST', joinBody), '/v1/classes/join', 'test');
      check('S7 POST fetch 1 call', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
      const c = fetchCalls[0];
      check('S7 POST method', c?.method === 'POST', `method=${c?.method}`);
      check('S7 POST body exact', c?.body === JSON.stringify(joinBody), `body=${c?.body}`);
      check('S7 join url exact', c?.url === `${PREVIEW_URL}/v1/classes/join`, `url=${c?.url}`);
    }

    // S8: Worker 401 原样透传（未登录）
    {
      setEnv({ VERCEL_ENV: 'production', ...fullConfig });
      mockStatus = 401;
      mockBody = '{"error":"未登录"}';
      const res = await proxySessionToWorker(authedRequest(), '/v1/classes', 'test');
      check('S8 worker 401 passthrough', res.status === 401, `status=${res.status}`);
    }

    // S9: Worker 不可达（fetch throw）→ 503，不泄露内部异常
    {
      setEnv({ VERCEL_ENV: 'production', ...fullConfig });
      const realMock = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error('network down with sensitive internal detail');
      }) as typeof fetch;
      const res = await proxySessionToWorker(authedRequest(), '/v1/classes', 'test');
      check('S9 fetch throw -> 503', res.status === 503, `status=${res.status}`);
      const text = await res.text();
      check(
        'S9 error body sanitized',
        !text.includes('sensitive internal detail'),
        `body=${text}`,
      );
      globalThis.fetch = realMock;
    }

    // S10: 无 Cookie 请求 → Cookie 头为空字符串（由 Worker 返回 401，代理不伪造）
    {
      setEnv({ VERCEL_ENV: 'production', ...fullConfig });
      const noCookieReq = new NextRequest('http://localhost/api/classes', { method: 'GET' });
      await proxySessionToWorker(noCookieReq, '/v1/classes', 'test');
      check(
        'S10 no-cookie -> empty cookie header',
        fetchCalls[0]?.headers['cookie'] === '',
        `cookie=${JSON.stringify(fetchCalls[0]?.headers['cookie'])}`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\n==== RESULT: ${passed} passed, ${failed} failed ====`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('TEST RUNNER ERROR:', e instanceof Error ? e.name : 'unknown');
  process.exit(1);
});
