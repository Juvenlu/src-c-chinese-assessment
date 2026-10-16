/**
 * Worker 目标地址统一访问守卫（P3-H-12F-2L-R1）
 *
 * 目标：保证 Vercel Preview 即使被误配置了 Production Worker URL 和有效
 * Service Key，也无法向 Production Worker / Production D1 发出请求。
 *
 * 设计原则：
 * - 部署环境只以 Vercel 系统注入的 `VERCEL_ENV` 判定，禁止使用 NODE_ENV
 *   区分 Production / Preview（Preview 运行时 NODE_ENV 同样为 'production'）。
 * - 默认拒绝（deny by default）：未知/本地环境默认无权访问 Production Worker。
 * - URL 使用 WHATWG `new URL()` 解析并做精确 hostname 校验（禁止 includes 子串匹配）。
 * - 仅允许 https；非法 URL / 非法协议一律拒绝。
 *
 * 注意：Preview 白名单只能证明「目标主机名被管理员显式批准」，不能证明该
 * Worker 绑定的是独立（非 Production）D1。数据库级隔离仍需在 staging Worker
 * 侧使用独立 D1 Binding 与凭据来保证。
 */

/** 已知 Production Worker 的精确 hostname 集合（单点维护，新主机名在此追加）。 */
export const PRODUCTION_WORKER_HOSTS: ReadonlySet<string> = new Set([
  'src-primary-api.quweizhongwen.workers.dev',
]);

export type DeployEnv = 'production' | 'preview' | 'local';

/**
 * 识别部署环境。
 * - VERCEL_ENV=production → Vercel Production
 * - VERCEL_ENV=preview    → Vercel Preview / PR Deployment
 * - VERCEL_ENV=development 或缺失 → 本地 / 自托管 / 未知（按 local 处理，默认拒绝生产）
 */
export function getDeployEnv(env: NodeJS.ProcessEnv = process.env): DeployEnv {
  const v = env.VERCEL_ENV;
  if (v === 'production') return 'production';
  if (v === 'preview') return 'preview';
  return 'local';
}

/**
 * 解析 Preview 强制白名单（逗号分隔）。空白项忽略，全部小写。
 * 白名单为空时，Preview 不允许访问任何 Worker（安全默认）。
 */
export function parsePreviewAllowlist(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const h = part.trim().toLowerCase();
    if (h) out.add(h);
  }
  return out;
}

/**
 * 发往 Worker 的 fetch 必须禁止自动跟随重定向：
 * 防止 Preview 白名单内的 Staging Worker 经 3xx 把请求（含 Service Key）
 * 自动转发到 Production。所有 Worker 调用路径统一使用此 init。
 */
export const WORKER_FETCH_INIT = { redirect: 'manual' } as const satisfies RequestInit;

export type ResolveResult =
  | { ok: true; url: string; hostname: string; isProduction: boolean }
  | { ok: false; reason: 'missing_url' | 'invalid_url' | 'non_https' | 'not_pure_origin' | 'prod_blocked_preview' | 'prod_blocked_local' | 'not_in_preview_allowlist' };

/**
 * 按当前部署环境校验并解析 Worker 目标地址。
 *
 * 规则：
 * - Production（VERCEL_ENV=production）：保持现有行为，允许 Production Worker。
 * - Preview（VERCEL_ENV=preview）：永远禁止 Production 精确 hostname；
 *   且目标 hostname 必须在 SRC_PREVIEW_ALLOWED_WORKER_HOSTS 白名单内，
 *   否则一律拒绝（无白名单 = 全部拒绝）。
 * - 本地/未知：默认禁止 Production Worker；显式 SRC_ALLOW_PROD_WORKER=true
 *   才放行（开发者 opt-in）。
 */
export function resolveWorkerTarget(
  rawUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolveResult {
  if (!rawUrl || !rawUrl.trim()) {
    return { ok: false, reason: 'missing_url' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'non_https' };
  }

  // 仅允许纯 HTTPS Origin：`https://hostname` 或 `https://hostname/`。
  // 拒绝路径前缀、query、hash、username、password——避免下游 `${base}/v1/...`
  // 拼出畸形路径，并杜绝凭证等非 Origin 组成部分混入请求目标。
  if (
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return { ok: false, reason: 'not_pure_origin' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isProduction = PRODUCTION_WORKER_HOSTS.has(hostname);
  const deployEnv = getDeployEnv(env);

  // 合法 base 统一为无尾斜杠的纯 Origin，确保下游 `${base}/v1/...`
  // 拼出单斜杠路径（`new URL('https://host').toString()` 会自动补 '/'）。
  const normalizedUrl = parsed.origin;

  if (deployEnv === 'preview') {
    if (isProduction) {
      return { ok: false, reason: 'prod_blocked_preview' };
    }
    const allowlist = parsePreviewAllowlist(env.SRC_PREVIEW_ALLOWED_WORKER_HOSTS);
    if (!allowlist.has(hostname)) {
      return { ok: false, reason: 'not_in_preview_allowlist' };
    }
    return { ok: true, url: normalizedUrl, hostname, isProduction };
  }

  if (deployEnv === 'local' && isProduction) {
    if (env.SRC_ALLOW_PROD_WORKER !== 'true') {
      return { ok: false, reason: 'prod_blocked_local' };
    }
  }

  // production：保持现有行为
  return { ok: true, url: normalizedUrl, hostname, isProduction };
}

/**
 * 便捷封装：仅返回可用 URL 字符串，被拦截/无效时返回 null。
 * 路由可用它替代 `process.env.WORKER_BASE_URL` / `process.env.SRC_WORKER_URL`，
 * 复用各路由既有的「未配置」fail-fast 分支，保证零外发请求。
 */
export function resolveWorkerUrl(
  rawUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const r = resolveWorkerTarget(rawUrl, env);
  return r.ok ? r.url : null;
}
