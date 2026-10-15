/**
 * Admin Worker Proxy Helper
 *
 * 将 Vercel Admin 相关的 API 请求代理到 Worker（D1 数据源）。
 * 统一处理 Service Key 鉴权、Header 透传、错误响应。
 *
 * 使用方式：
 *   import { proxyToWorker } from './worker-proxy'
 *   return proxyToWorker(request, `/v1/admin/xxx/${id}`)
 */

import { getDeployEnv, resolveWorkerTarget } from './worker-target';

const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const WORKER_ENABLED =
  process.env.WORKER_GUEST_API_ENABLED === 'true' ||
  process.env.WORKER_CHILDREN_ENABLED === 'true' ||
  IS_PRODUCTION;

// 经统一守卫解析后的 Worker Base URL（请求时动态求值，避免模块加载期缓存环境）。
// 非 Production 环境解析失败时为 null，调用方按既有「未配置」分支 fail-fast。
function getResolvedWorkerBaseUrl(): string | null {
  const result = resolveWorkerTarget(process.env.WORKER_BASE_URL, process.env);
  return result.ok ? result.url : null;
}

// 向后兼容导出：值在当前环境下可用时给出，否则为 null（消费方均有空值检查）。
const WORKER_BASE_URL = getResolvedWorkerBaseUrl();

if (IS_PRODUCTION && (!process.env.WORKER_BASE_URL || !SERVICE_KEY)) {
  console.error('[worker-proxy] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export { WORKER_BASE_URL, SERVICE_KEY, WORKER_ENABLED, IS_PRODUCTION };

export interface ProxyOptions {
  /** 目标 Worker 路径，如 /v1/admin/rewrite/manual */
  path?: string;
  /** 是否透传 body（默认 true） */
  passBody?: boolean;
  /** 是否透传 x-admin-password（默认 true） */
  passAdminPassword?: boolean;
  /** 请求方法，默认跟随源请求 */
  method?: string;
}

/**
 * 代理当前 request 到 Worker。
 * @param request 原始请求
 * @param workerPath 目标 Worker 路径（以 /v1/... 开头）；不传则使用 request.url 的 pathname
 */
export async function proxyToWorker(request: Request, workerPath: string, options: ProxyOptions = {}): Promise<Response> {
  const { NextResponse } = await import('next/server');

  // 请求时解析（不依赖模块加载期快照），并执行 Preview/Production 隔离守卫。
  const target = resolveWorkerTarget(process.env.WORKER_BASE_URL, process.env);
  const resolvedBaseUrl = target.ok ? target.url : null;
  const deployEnv = getDeployEnv(process.env);

  // Preview 强制隔离：即使误配置了生产 URL + 有效 Service Key，也必须零外发拒绝。
  if (deployEnv === 'preview' && (!target.ok || !SERVICE_KEY)) {
    return NextResponse.json(
      {
        error:
          target.ok === false && target.reason === 'not_in_preview_allowlist'
            ? 'Preview 环境 Worker 不在允许名单内'
            : 'Preview 环境禁止访问 Production Worker',
      },
      { status: 503 },
    );
  }

  if (!WORKER_ENABLED || !resolvedBaseUrl || !SERVICE_KEY) {
    if (IS_PRODUCTION) {
      return NextResponse.json({ error: '服务配置错误' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Worker 未启用，本地请使用 Legacy PG API' }, { status: 503 });
  }

  try {
    const adminPwd = options.passAdminPassword !== false
      ? request.headers.get('x-admin-password') || ''
      : '';
    const contentType = request.headers.get('content-type') || 'application/json';

    const method = options.method || request.method;
    const passBody = options.passBody !== false;
    const shouldHaveBody = method !== 'GET' && method !== 'HEAD' && passBody;

    let body: string | undefined;
    if (shouldHaveBody) {
      try {
        body = await request.text();
      } catch {
        body = undefined;
      }
    }

    const targetUrl = `${resolvedBaseUrl}${workerPath}`;

    const res = await fetch(targetUrl, {
      method,
      headers: {
        'Content-Type': contentType,
        'x-admin-password': adminPwd,
        'X-SRC-Service-Key': SERVICE_KEY,
      },
      body: shouldHaveBody ? body : undefined,
      cache: 'no-store',
    });

    const text = await res.text();
    const resultHeaders = new Headers();
    resultHeaders.set('Content-Type', res.headers.get('content-type') || 'application/json');
    return new NextResponse(text, { status: res.status, headers: resultHeaders });
  } catch (error: any) {
    console.error('[worker-proxy] proxy error:', error);
    return NextResponse.json(
      { error: 'Worker proxy error', message: error?.message || String(error) },
      { status: 502 }
    );
  }
}
