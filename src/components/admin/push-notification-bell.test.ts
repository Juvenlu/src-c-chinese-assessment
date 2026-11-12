/**
 * S5G-8B 管理员小铃铛纯逻辑测试（自包含，无外部服务）
 *
 * 覆盖任务书 §四 中可在无浏览器环境验证的项目：
 *  1. pending 数量统计正确，不计入 processing（countPending）
 *  2. pending=0 时不显示红色数字（badgeView → none）
 *  3. 多条 pending 申请列表正确且保持顺序（filterPending，不修改原数组）
 *  5. 60 秒刷新周期常量（POLL_INTERVAL_MS）
 *  6. 查看不减少计数：无已读状态，filterPending/countPending 均为纯函数
 *  7. 失败与恢复：badgeView 各分支（失败不伪装清零、恢复后回到正常视图）
 *  9.（旁证）未认证 401 由 Worker 既有测试覆盖（worker/test/class-push.test.ts）
 * 10. 辅助函数：badgeText 折叠、formatRequestTime 确定性、statusLabel
 *
 * 浏览器交互项（点击定位/下拉开合/定时器装配/卸载清理）无法在本沙箱
 * 真实运行 React DOM，按任务书要求标记 UI E2E 为 BLOCKED，详见交付报告。
 *
 * 运行：npx tsx src/components/admin/push-notification-bell.test.ts
 */

import {
  POLL_INTERVAL_MS,
  badgeText,
  badgeView,
  countPending,
  filterPending,
  formatRequestTime,
  statusLabel,
  type BellQueueItem,
} from './push-notification-bell';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`PASS: ${name}`);
  } else {
    failed++;
    console.log(`FAIL: ${name} ${detail}`);
  }
}

function makeItem(
  id: string,
  status: 'pending' | 'processing',
  createdAt = 1762992666,
): BellQueueItem {
  return {
    id,
    class_id: `class-${id}`,
    status,
    story_series_id: 1,
    created_at: createdAt,
    updated_at: null,
    class_name: `测试班-${id}`,
    series_name: '西游记',
    member_count: 1,
    ok_count: 0,
    failed_count: 0,
    skipped_count: 0,
    processing_count: 0,
  };
}

// ---------- 1. pending 数量统计（不计入 processing） ----------
check(
  '1.1 混合列表只统计 pending（3 pending + 2 processing → 3）',
  countPending([
    makeItem('a', 'pending'),
    makeItem('b', 'processing'),
    makeItem('c', 'pending'),
    makeItem('d', 'processing'),
    makeItem('e', 'pending'),
  ]) === 3,
);
check('1.2 全 processing → 0', countPending([makeItem('a', 'processing')]) === 0);
check('1.3 空列表 → 0', countPending([]) === 0);

// ---------- 2. pending=0 不显示红色数字 ----------
check('2.1 pending=0 且无错误 → 徽标 none', badgeView(0, '').kind === 'none');
check(
  '2.2 pending>0 → 徽标 count 且数值正确',
  (() => {
    const v = badgeView(5, '');
    return v.kind === 'count' && v.count === 5;
  })(),
);

// ---------- 3. 多条 pending 列表正确（顺序保持、不修改原数组） ----------
{
  const src = [makeItem('p1', 'pending', 100), makeItem('x', 'processing', 200), makeItem('p2', 'pending', 300), makeItem('p3', 'pending', 400)];
  const out = filterPending(src);
  check(
    '3.1 多条 pending 全部保留且顺序与 API 一致（FIFO）',
    out.length === 3 && out[0].id === 'p1' && out[1].id === 'p2' && out[2].id === 'p3',
  );
  check(
    '6.1 纯函数不修改原数组（查看/过滤不产生已读副作用）',
    src.length === 4 && src[1].status === 'processing',
  );
}

// ---------- 5. 60 秒刷新周期 ----------
check('5.1 轮询周期 = 60000ms', POLL_INTERVAL_MS === 60_000);

// ---------- 7. 失败与恢复 ----------
check(
  '7.1 从未加载成功且出错 → 琥珀 error 徽标（失败不伪装清零）',
  badgeView(0, '网络异常').kind === 'error',
);
check(
  '7.2 有最后已知计数时出错 → 仍显示计数（错误另在下拉明示，不伪装成功）',
  (() => {
    const v = badgeView(3, '加载失败（HTTP 500）');
    return v.kind === 'count' && v.count === 3;
  })(),
);
check('7.3 错误清空且计数归零 → 恢复为 none', badgeView(0, '').kind === 'none');
check(
  '7.4 恢复后有新 pending → 恢复为 count',
  (() => {
    const v = badgeView(1, '');
    return v.kind === 'count' && v.count === 1;
  })(),
);

// ---------- 10. 辅助函数 ----------
check('10.1 badgeText 常规数值', badgeText(7) === '7');
check('10.2 badgeText >99 折叠为 99+', badgeText(100) === '99+' && badgeText(12345) === '99+');
{
  // 时区无关的确定性断言：用本地时间构造基准再格式化应回读同一时刻
  const base = new Date(2026, 10, 12, 6, 31, 6); // 本地 2026-11-12 06:31:06
  const sec = Math.floor(base.getTime() / 1000);
  check('10.3 formatRequestTime 确定性（本地时区无关）', formatRequestTime(sec) === '2026-11-12 06:31', formatRequestTime(sec));
}
check('10.4 formatRequestTime 非法输入安全兜底', formatRequestTime(NaN) === '时间未知');
check('10.5 statusLabel pending → 待处理', statusLabel('pending') === '待处理');
check('10.6 statusLabel processing → 处理中', statusLabel('processing') === '处理中');
check('10.7 statusLabel 未知状态原样透传', statusLabel('done') === 'done');

// ---------- 汇总 ----------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
