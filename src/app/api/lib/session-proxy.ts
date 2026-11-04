/**
 * Session 用户 Worker 代理（P4-T4 教师班级）
 *
 * 与 admin 的 worker-proxy.ts 不同：
 * - 面向 Session 用户（教师/家长），透传浏览器 Cookie（src_auth_session），
 *   不透传 x-admin-password。
 * - Service Key 仅服务端注入，永不暴露给浏览器。
 * - 复用 worker-target 的 Preview/Production 隔离守卫（resolveWorkerUrl）。
 *
 * Worker 端仅识别 Cookie 通道（getSessionFromRequest 只读 Cookie），
 * 因此与 /api/teacher/me 一致：不透传 x-session header。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDeployEnv, resolveWorkerTarget, WORKER_FETCH_INIT } from './worker-target';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * 将 Session 用户请求代理到 Worker 班级端点。
 *
 * @param req        原始请求（Cookie 透传，body 原样转发）
 * @param workerPath Worker 端路径，如 /v1/classes、/v1/classes/join
 * @param tag        日志标签（不输出凭据）
 */
export async function proxySessionToWorker(
  req: NextRequest,
  workerPath: string,
  tag: string,
): Promise<NextResponse> {
  // 请求时解析（不依赖模块加载期快照），并执行 Preview/Production 隔离守卫。
  // 注意：真实 Vercel Preview 运行时 NODE_ENV 同为 'production'，
  // 因此 Preview 隔离检查必须先于 IS_PRODUCTION fail-fast 分支。
  const target = resolveWorkerTarget(process.env.WORKER_BASE_URL, process.env);
  const baseUrl = target.ok ? target.url : null;
  const serviceKey = process.env.SRC_WORKER_SERVICE_KEY;
  const deployEnv = getDeployEnv(process.env);
  const enabled = process.env.WORKER_GUEST_API_ENABLED === 'true';

  // Preview 强制隔离：目标被守卫拒绝（误配 Production URL / 不在白名单）→ 503 零外发
  if (deployEnv === 'preview' && (!target.ok || !serviceKey || !enabled)) {
    return NextResponse.json(
      {
        error:
          !target.ok && target.reason === 'not_in_preview_allowlist'
            ? 'Preview 环境 Worker 不在允许名单内'
            : !target.ok
              ? 'Preview 环境禁止访问该 Worker'
              : 'Preview 环境 Worker 未配置',
      },
      { status: 503 },
    );
  }

  const workerConfigured = enabled && baseUrl && serviceKey;

  // Production：必须走 Worker，配置缺失直接 fail-fast（绝不 fallback）
  if (IS_PRODUCTION && !workerConfigured) {
    console.error(
      `[${tag}] PRODUCTION ERROR: Worker is not configured. ` +
        'Required: WORKER_GUEST_API_ENABLED=true, WORKER_BASE_URL, SRC_WORKER_SERVICE_KEY.',
    );
    return NextResponse.json({ error: '服务配置错误' }, { status: 500 });
  }

  if (!workerConfigured) {
    return NextResponse.json({ error: '服务暂时不可用' }, { status: 503 });
  }

  // 透传浏览器 Cookie（src_auth_session）。Worker 端仅识别 Cookie 通道。
  const cookieHeader = req.headers.get('cookie') || '';

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await req.text();
    } catch {
      body = undefined;
    }
  }

  try {
    const res = await fetch(`${baseUrl}${workerPath}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-SRC-Service-Key': serviceKey as string,
        Cookie: cookieHeader,
      },
      body,
      cache: 'no-store',
      ...WORKER_FETCH_INIT,
    });

    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    });
  } catch (error) {
    // 不输出原始异常文本（可能含敏感信息），仅记录类别
    console.error(`[${tag}] Worker request failed:`, error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: '服务暂时不可用，请稍后重试' }, { status: 503 });
  }
}
