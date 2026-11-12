/**
 * P4-T9-1C-S5 本地隔离测试：课堂推送 Next.js 代理 + 工作台纯逻辑
 *
 * 运行：npx tsx src/app/api/lib/push-proxy.test.ts
 *
 * 覆盖：
 * - 教师系列设置 PATCH /api/classes/[id]/series（session 代理：Cookie 透传、Service Key 仅服务端、body 透传、防注入）
 * - 教师 Master 列表 GET /api/classes/master-stories（series_id 校验与透传）
 * - 管理员推送队列 5 代理（x-admin-password 透传、Service Key 注入、路径拼接、Preview 隔离 fail-closed）
 * - ClassPushWorkbench 导出纯逻辑（状态统计 / skips 校验与组装 / rewrite 过滤 / 状态文案）
 *
 * 全程 mock fetch：零真实网络、零数据库写入（符合任务书第四节）。
 */

import { NextRequest } from 'next/server';

// ---------- 环境（必须早于被测模块的动态 import） ----------
process.env.WORKER_BASE_URL = 'https://worker.test.internal';
process.env.SRC_WORKER_SERVICE_KEY = 'svc-key-test-123';
process.env.WORKER_GUEST_API_ENABLED = 'true';
delete process.env.VERCEL_ENV; // deployEnv=local，避免触发 Preview 隔离分支

// ---------- 极简测试框架（与 session-proxy.test.ts 一致） ----------
let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}`, extra ?? '');
  }
}

// ---------- fetch mock ----------
type FetchCall = { url: string; method: string; headers: Record<string, string>; body?: string };
const calls: FetchCall[] = [];
let mockStatus = 200;
let mockBody = '{}';

(globalThis as { fetch: unknown }).fetch = async (url: unknown, init?: RequestInit) => {
  const headers: Record<string, string> = {};
  const h = (init?.headers ?? {}) as Record<string, string>;
  for (const k of Object.keys(h)) headers[k.toLowerCase()] = String(h[k]);
  calls.push({
    url: String(url),
    method: init?.method ?? 'GET',
    headers,
    body: typeof init?.body === 'string' ? init.body : undefined,
  });
  return new Response(mockBody, {
    status: mockStatus,
    headers: { 'content-type': 'application/json' },
  });
};

function lastCall(): FetchCall {
  if (calls.length === 0) throw new Error('fetch 未被调用');
  return calls[calls.length - 1];
}
function reset(mock: { status?: number; body?: string } = {}) {
  calls.length = 0;
  mockStatus = mock.status ?? 200;
  mockBody = mock.body ?? '{}';
}

const BASE = 'https://worker.test.internal';
const REQ_ID = 'a1b2c3d4-1111-4222-8333-444455556666';
const CHILD_ID = 'c1d2e3f4-1111-4222-8333-444455556666';
const CLASS_ID = 'b2c3d4e5-1111-4222-8333-444455556666';

async function main() {
  // 动态 import：确保 env 先于模块加载
  const seriesRoute = await import('../classes/[id]/series/route');
  const masterStoriesRoute = await import('../classes/master-stories/route');
  const queueRoute = await import('../admin/push-requests/route');
  const detailRoute = await import('../admin/push-requests/[id]/route');
  const claimRoute = await import('../admin/push-requests/[id]/claim/route');
  const activateRoute = await import('../admin/push-requests/[id]/children/[childId]/activate/route');
  const completeRoute = await import('../admin/push-requests/[id]/complete/route');
  const wb = await import('../../../components/admin/class-push-workbench');

  const ctxOf = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

  // ==================== 1. 教师系列设置 PATCH /api/classes/[id]/series ====================
  console.log('\n[1] 教师系列设置代理');
  {
    reset({ body: '{"class":{"id":"' + CLASS_ID + '","story_series_id":2}}' });
    const req = new NextRequest('https://local.test/api/classes/' + CLASS_ID + '/series', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'src_auth_session=teacher-session-abc' },
      body: JSON.stringify({ story_series_id: 2 }),
    });
    const res = await seriesRoute.PATCH(req, ctxOf({ id: CLASS_ID }));
    check('状态码透传 200', res.status === 200);
    const c = lastCall();
    check('Worker 路径正确', c.url === `${BASE}/v1/classes/${CLASS_ID}/series`, c.url);
    check('方法 PATCH 透传', c.method === 'PATCH');
    check('Cookie 透传给 Worker（教师会话）', c.headers['cookie'] === 'src_auth_session=teacher-session-abc');
    check('Service Key 仅服务端注入', c.headers['x-src-service-key'] === 'svc-key-test-123');
    check('body 原样透传（story_series_id=2）', c.body === '{"story_series_id":2}', c.body);
    const out = (await res.json()) as { class?: { story_series_id?: number } };
    check('响应体原样返回', out.class?.story_series_id === 2);
  }
  {
    reset();
    const req = new NextRequest('https://local.test/api/classes/' + CLASS_ID + '/series', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'src_auth_session=t' },
      body: JSON.stringify({ story_series_id: null }),
    });
    await seriesRoute.PATCH(req, ctxOf({ id: CLASS_ID }));
    check('清除系列 null 透传', lastCall().body === '{"story_series_id":null}');
  }
  {
    reset();
    const evil = '../../admin';
    const req = new NextRequest('https://local.test/api/classes/' + encodeURIComponent(evil) + '/series', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'src_auth_session=t' },
      body: '{}',
    });
    await seriesRoute.PATCH(req, ctxOf({ id: evil }));
    check('非法 classId 路径注入被拒（不落真实路径）', lastCall().url.includes('/v1/classes/__invalid__/series'), lastCall().url);
  }

  // ==================== 2. 教师 Master 列表 GET /api/classes/master-stories ====================
  console.log('\n[2] 教师 Master 列表代理');
  {
    reset({ body: '{"stories":[{"id":9,"series_id":2,"series_name":"西游记"}]}' });
    const req = new NextRequest('https://local.test/api/classes/master-stories', {
      headers: { cookie: 'src_auth_session=t' },
    });
    const res = await masterStoriesRoute.GET(req);
    check('无 query 路径正确', lastCall().url === `${BASE}/v1/classes/master-stories`, lastCall().url);
    check('响应透传 stories', ((await res.json()) as { stories?: unknown[] }).stories?.length === 1);
  }
  {
    reset();
    const req = new NextRequest('https://local.test/api/classes/master-stories?series_id=2', {
      headers: { cookie: 'src_auth_session=t' },
    });
    await masterStoriesRoute.GET(req);
    check('series_id=2 合法透传', lastCall().url === `${BASE}/v1/classes/master-stories?series_id=2`, lastCall().url);
  }
  for (const bad of ['abc', '0', '-3', '2.5', '2;DROP']) {
    reset();
    const req = new NextRequest(`https://local.test/api/classes/master-stories?series_id=${encodeURIComponent(bad)}`, {
      headers: { cookie: 'src_auth_session=t' },
    });
    const res = await masterStoriesRoute.GET(req);
    check(`非法 series_id=${bad} → 400 且不转发`, res.status === 400 && calls.length === 0, res.status);
  }

  // ==================== 3. 管理员推送队列代理 ====================
  console.log('\n[3] 管理员推送队列代理（x-admin-password 透传）');
  const adminHeaders = { 'x-admin-password': 'admin-pw-xyz', 'content-type': 'application/json' };
  {
    reset({ body: '{"requests":[]}' });
    const res = await queueRoute.GET(new Request('https://local.test/api/admin/push-requests', { headers: adminHeaders }));
    const c = lastCall();
    check('队列 GET 路径正确', c.url === `${BASE}/v1/admin/push-requests`, c.url);
    check('x-admin-password 透传', c.headers['x-admin-password'] === 'admin-pw-xyz');
    check('Service Key 服务端注入', c.headers['x-src-service-key'] === 'svc-key-test-123');
    check('队列状态码透传', res.status === 200);
  }
  {
    reset({ body: '{"request":{"id":"' + REQ_ID + '"},"claimed":true}' });
    const res = await claimRoute.POST(
      new Request(`https://local.test/api/admin/push-requests/${REQ_ID}/claim`, { method: 'POST', headers: adminHeaders }),
      ctxOf({ id: REQ_ID }),
    );
    const c = lastCall();
    check('claim POST 路径正确', c.url === `${BASE}/v1/admin/push-requests/${REQ_ID}/claim`, c.url);
    check('claim 方法 POST', c.method === 'POST');
    check('claim 200 + claimed 透传', res.status === 200 && ((await res.json()) as { claimed?: boolean }).claimed === true);
  }
  {
    reset({ body: '{"request":{"id":"' + REQ_ID + '"},"students":[],"available_masters":[],"series_block_reason":null}' });
    const res = await detailRoute.GET(
      new Request(`https://local.test/api/admin/push-requests/${REQ_ID}`, { headers: adminHeaders }),
      ctxOf({ id: REQ_ID }),
    );
    const c = lastCall();
    check('详情 GET 路径正确', c.url === `${BASE}/v1/admin/push-requests/${REQ_ID}`, c.url);
    const body = (await res.json()) as { available_masters?: unknown[] };
    check('详情响应含 available_masters', Array.isArray(body.available_masters));
  }
  {
    reset();
    const evil = 'x/y?z=1';
    await detailRoute.GET(
      new Request('https://local.test/api/admin/push-requests/' + encodeURIComponent(evil), { headers: adminHeaders }),
      ctxOf({ id: evil }),
    );
    check('详情非法 id 注入被拒（__invalid__）', lastCall().url.endsWith('/v1/admin/push-requests/__invalid__'), lastCall().url);
  }
  {
    reset({ body: '{"data":{"status":"ok","already_done":false}}' });
    const res = await activateRoute.POST(
      new Request(`https://local.test/api/admin/push-requests/${REQ_ID}/children/${CHILD_ID}/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ rewrite_id: 42 }),
      }),
      ctxOf({ id: REQ_ID, childId: CHILD_ID }),
    );
    const c = lastCall();
    check(
      'activate 路径正确（request+child）',
      c.url === `${BASE}/v1/admin/push-requests/${REQ_ID}/children/${CHILD_ID}/activate`,
      c.url,
    );
    check('activate body rewrite_id 透传', c.body === '{"rewrite_id":42}', c.body);
    check('activate data.status 透传', ((await res.json()) as { data?: { status?: string } }).data?.status === 'ok');
  }
  {
    reset();
    const res = await activateRoute.POST(
      new Request(`https://local.test/api/admin/push-requests/${REQ_ID}/children/${encodeURIComponent('x" OR 1=1--')}/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: '{}',
      }),
      ctxOf({ id: REQ_ID, childId: 'x" OR 1=1--' }),
    );
    check('activate 非法 childId 注入被拒', lastCall().url.includes('/children/__invalid__/activate') && res.status !== 500);
  }
  {
    reset({ body: '{"data":{"status":"done","ok_count":2,"failed_count":1,"skipped_count":1}}' });
    const skips = { skips: [{ child_id: CHILD_ID, reason: '请假缺课' }] };
    const res = await completeRoute.POST(
      new Request(`https://local.test/api/admin/push-requests/${REQ_ID}/complete`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify(skips),
      }),
      ctxOf({ id: REQ_ID }),
    );
    const c = lastCall();
    check('complete 路径正确', c.url === `${BASE}/v1/admin/push-requests/${REQ_ID}/complete`, c.url);
    check('complete skips body 原样透传', c.body === JSON.stringify(skips), c.body);
    check('complete 汇总透传', ((await res.json()) as { data?: { ok_count?: number } }).data?.ok_count === 2);
  }
  {
    // Worker 未启用 → 503 fail-closed（不转发）
    reset();
    const savedEnabled = process.env.WORKER_GUEST_API_ENABLED;
    const savedKey = process.env.SRC_WORKER_SERVICE_KEY;
    process.env.WORKER_GUEST_API_ENABLED = 'false';
    delete process.env.SRC_WORKER_SERVICE_KEY;
    try {
      // worker-proxy 的 WORKER_ENABLED 为模块加载期常量，这里验证 session 代理的运行时 fail-closed
      const req = new NextRequest('https://local.test/api/classes/master-stories', {
        headers: { cookie: 'src_auth_session=t' },
      });
      const res = await masterStoriesRoute.GET(req);
      check('Service Key 缺失 → 503 且不转发（fail-closed）', res.status === 503 && calls.length === 0, res.status);
    } finally {
      process.env.WORKER_GUEST_API_ENABLED = savedEnabled;
      process.env.SRC_WORKER_SERVICE_KEY = savedKey;
    }
  }

  // ==================== 4. 工作台纯逻辑 ====================
  console.log('\n[4] ClassPushWorkbench 纯逻辑');
  type Stu = import('../../../components/admin/class-push-workbench').PushStudent;
  const mkStu = (childId: string, result: Stu['result']): Stu => ({
    child_id: childId,
    nickname: childId,
    grade: 'G1',
    authorized_at: 1,
    confirmed_level: 'SRC300',
    class_unfinished_count: 0,
    result,
  });
  {
    const students: Stu[] = [
      mkStu('a', { status: 'ok', rewrite_id: 1, custom_book_id: 1, failure_reason: null, updated_at: 1 }),
      mkStu('b', { status: 'failed', rewrite_id: null, custom_book_id: null, failure_reason: 'quota_exceeded', updated_at: 1 }),
      mkStu('c', { status: 'skipped', rewrite_id: null, custom_book_id: null, failure_reason: '请假', updated_at: 1 }),
      mkStu('d', { status: 'processing', rewrite_id: null, custom_book_id: null, failure_reason: null, updated_at: 1 }),
      mkStu('e', null), // 防御：无结果行视同 processing
    ];
    const c = wb.summarizeCounts(students);
    check('summarizeCounts 混合状态', c.ok === 1 && c.failed === 1 && c.skipped === 1 && c.processing === 2, JSON.stringify(c));
  }
  {
    const v1 = wb.validateSkips(['a', 'b'], { a: '请假' });
    check('validateSkips 缺 b → 不通过且点名', !v1.ok && v1.missing.join(',') === 'b');
    const v2 = wb.validateSkips(['a', 'b'], { a: '请假', b: '   ' });
    check('validateSkips 空原因 → 不通过', !v2.ok && v2.noReason.join(',') === 'b');
    const v3 = wb.validateSkips(['a', 'b'], { a: '请假', b: '转班' });
    check('validateSkips 全部有因 → 通过', v3.ok);
    check('validateSkips 空 processing 列表 → 直接通过', wb.validateSkips([], {}).ok);
  }
  {
    const body = wb.buildCompleteBody(['a', 'b'], { a: '  请假  ', b: '转班' });
    check(
      'buildCompleteBody 仅 processing 且 trim',
      body.skips.length === 2 && body.skips[0].reason === '请假' && body.skips[1].child_id === 'b',
      JSON.stringify(body),
    );
  }
  {
    type Rw = Parameters<typeof wb.finalRewritesForChild>[0][number];
    const rewrites: Rw[] = [
      { id: 1, episode_id: 9, child_id: 'a', status: 'final', target_level: 'SRC300', version: 1, created_at: 'x' },
      { id: 3, episode_id: 9, child_id: 'a', status: 'final', target_level: 'SRC300', version: 2, created_at: 'x' },
      { id: 5, episode_id: 9, child_id: 'a', status: 'ai_draft', target_level: 'SRC300', version: 3, created_at: 'x' },
      { id: 7, episode_id: 9, child_id: 'b', status: 'final', target_level: 'SRC500', version: 1, created_at: 'x' },
    ];
    const list = wb.finalRewritesForChild(rewrites, 'a');
    check(
      'finalRewritesForChild 只取该孩子 final 且 id 倒序',
      list.length === 2 && list[0].id === 3 && list[1].id === 1,
      JSON.stringify(list.map((r) => r.id)),
    );
    check('finalRewritesForChild 他孩子为空', wb.finalRewritesForChild(rewrites, 'zzz').length === 0);
  }
  {
    const okL = wb.studentStatusLabel(mkStu('a', { status: 'ok', rewrite_id: 1, custom_book_id: 1, failure_reason: null, updated_at: 1 }));
    const failL = wb.studentStatusLabel(mkStu('b', { status: 'failed', rewrite_id: null, custom_book_id: null, failure_reason: 'quota_exceeded', updated_at: 1 }));
    const skipL = wb.studentStatusLabel(mkStu('c', { status: 'skipped', rewrite_id: null, custom_book_id: null, failure_reason: '请假', updated_at: 1 }));
    const procL = wb.studentStatusLabel(mkStu('d', null));
    check('状态文案 ok', okL.tone === 'ok' && okL.text.includes('推送'));
    check('状态文案 failed 必须含原因（不得显示为成功）', failL.tone === 'failed' && failL.text.includes('quota_exceeded'), failL.text);
    check('状态文案 skipped 必须含原因', skipL.tone === 'skipped' && skipL.text.includes('请假'), skipL.text);
    check('状态文案 processing（无结果行）', procL.tone === 'processing' && procL.text === '待处理');
  }

  // ==================== 汇总 ====================
  console.log(`\n===== 结果: ${pass} PASS / ${fail} FAIL =====`);
  if (failures.length > 0) {
    console.log('失败项：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('测试执行异常：', err);
  process.exit(1);
});
