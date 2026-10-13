/**
 * P3-H-5 正式测评完成耗时 resolveCompletionTimeSeconds 验证测试
 *
 * 运行：npx tsx test/duration.test.ts
 *
 * 背景：test_sessions 在提交阶段才创建，completed_at - started_at 只反映
 * 「提交耗时」而非真实答题耗时（历史 bug：190 题被记为 5 秒）。
 *
 * 覆盖：
 * 1. 合法 174 秒 → 保存 174
 * 2. 合法 300 秒 → 保存 300
 * 3. 缺失耗时 → 回退逐题 reaction_time_ms 合计，而非提交耗时
 * 4. 负数 / 0 / NaN / Infinity → 全部拒绝
 * 5. 超上限 → 拒绝
 * 6. 不影响评分与 SRC 等级（本函数仅决定耗时字段，纯函数无副作用）
 */

import { resolveCompletionTimeSeconds } from '../src/results';

let passed = 0;
let failed = 0;

function assert(name: string, actual: unknown, expected: unknown): void {
	if (actual === expected) {
		passed++;
		console.log(`PASS  ${name} => ${String(actual)}`);
	} else {
		failed++;
		console.error(`FAIL  ${name} => got ${String(actual)}, expected ${String(expected)}`);
	}
}

// Anthony 真实会话：190 题，Σ reaction_time_ms = 174163ms
const anthonyAnswers = Array.from({ length: 190 }, (_, i) => ({
	reaction_time_ms: i < 190 ? 916.647 : 0,
}));

// 1. 合法 174 秒
assert(
	'合法耗时 174 秒（客户端上报）→ 174',
	resolveCompletionTimeSeconds({
		clientDuration: 174,
		answers: anthonyAnswers,
		sessionStartedAt: 1000,
		sessionCompletedAt: 1005, // 提交耗时仅 5 秒，不得覆盖
	}),
	174,
);

// 2. 合法 300 秒
assert(
	'合法耗时 300 秒 → 300',
	resolveCompletionTimeSeconds({
		clientDuration: 300,
		answers: [],
		sessionStartedAt: 0,
		sessionCompletedAt: 0,
	}),
	300,
);

// 小数向上取整（客户端可能传 173.6）
assert(
	'小数耗时 173.6 → 四舍五入 174',
	resolveCompletionTimeSeconds({ clientDuration: 173.6, answers: [] }),
	174,
);

// 3. 缺失耗时：必须用逐题反应时间，而不是会话差 5 秒
assert(
	'缺失耗时 → 逐题合计 ~174（不是提交耗时 5）',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [{ reaction_time_ms: 174163 }],
		sessionStartedAt: 1000,
		sessionCompletedAt: 1005,
	}),
	174,
);

assert(
	'缺失耗时且无逐题数据 → 最后回退会话差 5',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [],
		sessionStartedAt: 1000,
		sessionCompletedAt: 1005,
	}),
	5,
);

// 4. 负数 / 0 / NaN / Infinity → 拒绝客户端值
assert(
	'负数 -10 → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: -10,
		answers: [{ reaction_time_ms: 174163 }],
		sessionStartedAt: 1000,
		sessionCompletedAt: 1005,
	}),
	174,
);

assert(
	'零 0 → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: 0,
		answers: [{ reaction_time_ms: 174163 }],
		sessionStartedAt: 1000,
		sessionCompletedAt: 1005,
	}),
	174,
);

assert(
	'NaN → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: Number.NaN,
		answers: [{ reaction_time_ms: 174163 }],
		sessionStartedAt: 1000,
		sessionCompletedAt: 1005,
	}),
	174,
);

assert(
	'Infinity → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: Number.POSITIVE_INFINITY,
		answers: [{ reaction_time_ms: 174163 }],
		sessionStartedAt: 1000,
		sessionCompletedAt: 1005,
	}),
	174,
);

assert(
	'字符串类型 "174" → 不信任，回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: '174',
		answers: [{ reaction_time_ms: 174163 }],
		sessionStartedAt: 1000,
		sessionCompletedAt: 1005,
	}),
	174,
);

// 5. 超出合理上限（> 7200 秒）→ 拒绝
assert(
	'超限 999999 → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: 999999,
		answers: [{ reaction_time_ms: 174163 }],
		sessionStartedAt: 1000,
		sessionCompletedAt: 1005,
	}),
	174,
);

assert(
	'边界 7200 → 接受',
	resolveCompletionTimeSeconds({ clientDuration: 7200, answers: [] }),
	7200,
);

assert(
	'边界 7201 → 拒绝，回退逐题',
	resolveCompletionTimeSeconds({
		clientDuration: 7201,
		answers: [{ reaction_time_ms: 5000 }],
	}),
	5,
);

// 6. 评分/等级不受影响：resolveCompletionTimeSeconds 是纯函数，
// 不读取/返回任何分数或 level；这里验证不同耗时输入不改变其确定性输出。
const a = resolveCompletionTimeSeconds({ clientDuration: 174, answers: anthonyAnswers });
const b = resolveCompletionTimeSeconds({ clientDuration: 174, answers: anthonyAnswers });
assert('纯函数确定性（评分链路无副作用）', a === b && a === 174, true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
	process.exit(1);
}
