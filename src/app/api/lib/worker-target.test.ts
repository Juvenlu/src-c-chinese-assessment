/**
 * P3-H-12F-2M 隔离守卫测试（纯逻辑，Mock，零真实网络请求）
 * 运行：npx tsx src/app/api/lib/worker-target.test.ts
 */
import {
  getDeployEnv,
  parsePreviewAllowlist,
  PRODUCTION_WORKER_HOSTS,
  resolveWorkerTarget,
  resolveWorkerUrl,
} from './worker-target';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROD_URL = 'https://src-primary-api.quweizhongwen.workers.dev';
const STAGING_URL = 'https://src-staging-api.quweizhongwen.workers.dev';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL: ${name} ${extra}`);
  }
}
function env(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...over } as NodeJS.ProcessEnv;
}

// ---------- 纯逻辑矩阵 ----------

// 1. Preview + Production URL（即使有有效 key 变量）→ 拒绝
{
  const r = resolveWorkerTarget(PROD_URL, env({ VERCEL_ENV: 'preview', SRC_WORKER_SERVICE_KEY: 'dummy-key' }));
  check('T1 preview+prod url => prod_blocked_preview', !r.ok && r.reason === 'prod_blocked_preview');
}

// 2. Preview 缺少 URL → 拒绝
{
  const r = resolveWorkerTarget(undefined, env({ VERCEL_ENV: 'preview' }));
  check('T2 preview missing url => missing_url', !r.ok && r.reason === 'missing_url');
}

// 3. Preview 无白名单但给非生产 URL → 拒绝（白名单缺失=全拒绝）
{
  const r = resolveWorkerTarget(STAGING_URL, env({ VERCEL_ENV: 'preview' }));
  check('T3 preview no allowlist => not_in_preview_allowlist', !r.ok && r.reason === 'not_in_preview_allowlist');
}

// 4. Preview + 白名单外域名 → 拒绝
{
  const r = resolveWorkerTarget('https://random.example.workers.dev', env({
    VERCEL_ENV: 'preview',
    SRC_PREVIEW_ALLOWED_WORKER_HOSTS: STAGING_URL ? new URL(STAGING_URL).hostname : '',
  }));
  check('T4 preview allowlist outsider => rejected', !r.ok && r.reason === 'not_in_preview_allowlist');
}

// 5. Preview + 白名单内非生产域名 → 允许
{
  const r = resolveWorkerTarget(STAGING_URL, env({
    VERCEL_ENV: 'preview',
    SRC_PREVIEW_ALLOWED_WORKER_HOSTS: new URL(STAGING_URL).hostname,
  }));
  check('T5 preview allowlisted staging => allowed', r.ok === true);
}

// 6. Production + 现有生产 URL → 保持原行为（允许）
{
  const r = resolveWorkerTarget(PROD_URL, env({ VERCEL_ENV: 'production' }));
  check('T6 production+prod url => allowed', r.ok === true && r.ok && r.isProduction === true);
}

// 7. 未知/本地环境默认禁止 Production
{
  const r1 = resolveWorkerTarget(PROD_URL, env({}));
  check('T7a unknown env + prod => prod_blocked_local', !r1.ok && r1.reason === 'prod_blocked_local');
  const r2 = resolveWorkerTarget(PROD_URL, env({ VERCEL_ENV: 'development' }));
  check('T7b development + prod => prod_blocked_local', !r2.ok && r2.reason === 'prod_blocked_local');
}

// 7b. 本地显式 opt-in 才放行
{
  const r = resolveWorkerTarget(PROD_URL, env({ SRC_ALLOW_PROD_WORKER: 'true' }));
  check('T7c local opt-in + prod => allowed', r.ok === true);
}

// 8. 非 HTTPS / 非法 URL / 伪造相似域名 → 拒绝
{
  check('T8a http => non_https', resolveWorkerTarget('http://src-primary-api.quweizhongwen.workers.dev', env({ VERCEL_ENV: 'production' })).ok === false);
  const badProto = resolveWorkerTarget('http://src-primary-api.quweizhongwen.workers.dev', env({ VERCEL_ENV: 'production' }));
  check('T8a reason non_https', !badProto.ok && badProto.reason === 'non_https');

  check('T8b invalid url => invalid_url', (() => { const r = resolveWorkerTarget('not-a-url', env({ VERCEL_ENV: 'production' })); return !r.ok && r.reason === 'invalid_url'; })());

  // 伪造相似域名（子串 includes 会误放行，精确 hostname 必须拦截）
  const spoof = resolveWorkerTarget('https://src-primary-api.quweizhongwen.workers.dev.evil.com', env({ VERCEL_ENV: 'production' }));
  check('T8c spoof suffix domain treated as non-prod but still https => allowed only if not prod host',
    spoof.ok === true && spoof.ok && spoof.isProduction === false);
  const spoofPreview = resolveWorkerTarget('https://src-primary-api.quweizhongwen.workers.dev.evil.com', env({
    VERCEL_ENV: 'preview',
    SRC_PREVIEW_ALLOWED_WORKER_HOSTS: 'src-primary-api.quweizhongwen.workers.dev',
  }));
  check('T8d spoof domain not in preview allowlist => rejected', !spoofPreview.ok && spoofPreview.reason === 'not_in_preview_allowlist');

  check('T8e javascript scheme => invalid/non_https', (() => { const r = resolveWorkerTarget('javascript:alert(1)', env({ VERCEL_ENV: 'production' })); return !r.ok; })());
}

// 9. getDeployEnv / parsePreviewAllowlist 边界
{
  check('T9a env production', getDeployEnv(env({ VERCEL_ENV: 'production' })) === 'production');
  check('T9b env preview', getDeployEnv(env({ VERCEL_ENV: 'preview' })) === 'preview');
  check('T9c env missing => local', getDeployEnv(env({})) === 'local');
  const al = parsePreviewAllowlist(' a.com , ,b.com, A.COM ');
  check('T9d allowlist trim/lowercase/dedup', al.size === 2 && al.has('a.com') && al.has('b.com'));
  check('T9e empty allowlist', parsePreviewAllowlist(undefined).size === 0);
}

// 10. resolveWorkerUrl 便捷封装
{
  check('T10a blocked => null', resolveWorkerUrl(PROD_URL, env({ VERCEL_ENV: 'preview' })) === null);
  check('T10b production => url string', typeof resolveWorkerUrl(PROD_URL, env({ VERCEL_ENV: 'production' })) === 'string');
}

// 11. 生产主机名常量精确性（防子串）
{
  check('T11 prod host present', PRODUCTION_WORKER_HOSTS.has('src-primary-api.quweizhongwen.workers.dev'));
  check('T11b spoof host not present', !PRODUCTION_WORKER_HOSTS.has('src-primary-api.quweizhongwen.workers.dev.evil.com'));
}

// ---------- 34 条调用路径静态覆盖检查 ----------
const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '../../../'); // src/app/api
function listRouteFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name === 'route.ts') out.push(full);
    }
  }
  walk(apiDir);
  return out;
}

const routes = listRouteFiles();
const workerCallerRoutes: string[] = [];
for (const f of routes) {
  const c = fs.readFileSync(f, 'utf8');
  const callsWorker =
    /WORKER_BASE_URL|SRC_WORKER_URL|proxyToWorker/.test(c) ||
    /\/v1\//.test(c);
  if (callsWorker) workerCallerRoutes.push(f);
}

let guarded = 0;
const unguarded: string[] = [];
for (const f of workerCallerRoutes) {
  const c = fs.readFileSync(f, 'utf8');
  const isProxyLib = f.endsWith(path.join('lib', 'worker-proxy.ts'));
  const usesGuard =
    c.includes("resolveWorkerUrl(process.env.WORKER_BASE_URL") ||
    c.includes("resolveWorkerUrl(process.env.SRC_WORKER_URL") ||
    c.includes('resolveWorkerTarget(process.env.WORKER_BASE_URL') ||
    /proxyToWorker\s*\(/.test(c) || // 经公共代理：守卫在 worker-proxy.ts 内统一执行
    isProxyLib;
  if (usesGuard) guarded++;
  else unguarded.push(path.relative(apiDir, f));
}

// 19 直连 + 11 proxyToWorker 消费路由（5 既有 manual/writer + 6 新增 versioning）+ 3 reading = 33
// 注：守卫本体 worker-proxy.ts 为 lib 文件，非 route.ts；故 12 个 proxyToWorker 引用中 11 个是路由
check(`T12 worker-caller routes count expected (=33)`,
  workerCallerRoutes.length === 33, `actual=${workerCallerRoutes.length}`);
check('T13 all worker-caller routes guarded (unguarded=0)', unguarded.length === 0,
  unguarded.length ? 'UNGUARDED: ' + unguarded.join(', ') : '');
console.log(`[coverage] worker caller routes = ${workerCallerRoutes.length}, guarded = ${guarded}`);

// 硬编码红线：业务路由不得出现生产 hostname（仅 worker-target.ts 允许）
{
  const offenders: string[] = [];
  for (const f of routes) {
    const c = fs.readFileSync(f, 'utf8');
    if (c.includes('quweizhongwen.workers.dev')) offenders.push(path.relative(apiDir, f));
  }
  check('T14 zero hardcoded prod host in route files', offenders.length === 0,
    offenders.length ? 'OFFENDERS: ' + offenders.join(', ') : '');
}

console.log(`\nRESULT PASS=${passed} FAIL=${failed}`);
if (failed > 0) process.exit(1);
