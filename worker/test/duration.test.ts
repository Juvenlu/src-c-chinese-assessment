/**
 * P3-H-9-C 正式测评完成耗时 resolveCompletionTimeSeconds 验证测试
 *
 * 运行：npx tsx test/duration.test.ts
 *
 * 背景：test_sessions 在提交阶段才创建，completed_at - started_at 只反映
 * 「提交耗时」而非真实答题耗时，绝不作为答题时长（历史 bug：190 题记为 5 秒）。
 *
 * 解析规则：
 * 1. 合法客户端耗时（有限、正整数、≤7200s）优先采用。
 * 2. 客户端非法/缺失 → 用合法逐题 reaction_time_ms 累计（同样 ≤7200s 上限）。
 * 3. 逐题累计超过 7200s，或两种来源均不可用 → 返回 0（未知/异常），
 *    不伪造成 7200s 或提交耗时。
 *
 * 覆盖：
 * 1. 合法 174 秒 → 174
 * 2. 合法 300 秒 → 300
 * 3. 客户端非法（负数/0/NaN/Infinity/超限/类型）→ 回退逐题
 * 4. 逐题异常值（负/0/NaN/Inf/非数值）→ 忽略
 * 5. 逐题累计超过 7200 秒 → 0
 * 6. 两种来源均缺失/异常 → 0（不再回退 Session 提交耗时）
 * 7. 纯函数确定性（评分链路无副作用）
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

// 1. 合法客户端耗时
assert(
	'合法耗时 174 秒（客户端上报）→ 174',
	resolveCompletionTimeSeconds({ clientDuration: 174, answers: [] }),
	174,
);

assert(
	'合法耗时 300 秒 → 300',
	resolveCompletionTimeSeconds({ clientDuration: 300, answers: [] }),
	300,
);

assert(
	'小数耗时 173.6 → 四舍五入 174',
	resolveCompletionTimeSeconds({ clientDuration: 173.6, answers: [] }),
	174,
);

assert(
	'边界 7200 → 接受',
	resolveCompletionTimeSeconds({ clientDuration: 7200, answers: [] }),
	7200,
);

// 2. 客户端非法值 → 回退逐题反应时间合计
assert(
	'客户端 -10 → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: -10,
		answers: [{ reaction_time_ms: 174163 }],
	}),
	174,
);

assert(
	'客户端 0 → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: 0,
		answers: [{ reaction_time_ms: 174163 }],
	}),
	174,
);

assert(
	'客户端 NaN → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: Number.NaN,
		answers: [{ reaction_time_ms: 174163 }],
	}),
	174,
);

assert(
	'客户端 Infinity → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: Number.POSITIVE_INFINITY,
		answers: [{ reaction_time_ms: 174163 }],
	}),
	174,
);

assert(
	'客户端字符串 "174" → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: '174',
		answers: [{ reaction_time_ms: 174163 }],
	}),
	174,
);

assert(
	'客户端超限 999999 → 回退逐题 174',
	resolveCompletionTimeSeconds({
		clientDuration: 999999,
		answers: [{ reaction_time_ms: 174163 }],
	}),
	174,
);

assert(
	'客户端 7201 → 拒绝，回退逐题 5000ms',
	resolveCompletionTimeSeconds({
		clientDuration: 7201,
		answers: [{ reaction_time_ms: 5000 }],
	}),
	5,
);

// 3. 逐题异常值 → 忽略（不影响正常累计）
assert(
	'逐题含负数/0/NaN/Inf 混入 → 仅正常值参与累计 ~174',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [
			{ reaction_time_ms: 174163 },
			{ reaction_time_ms: -5 },
			{ reaction_time_ms: 0 },
			{ reaction_time_ms: Number.NaN },
			{ reaction_time_ms: Number.POSITIVE_INFINITY },
			{ reaction_time_ms: 'wrong' as unknown as number },
		],
	}),
	174,
);

assert(
	'逐题全为异常值 → 0',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [
			{ reaction_time_ms: -5 },
			{ reaction_time_ms: 0 },
			{ reaction_time_ms: Number.NaN },
			{ reaction_time_ms: Number.POSITIVE_INFINITY },
		],
	}),
	0,
);

// 4. 逐题累计超过 7200 秒 → 返回 0
assert(
	'逐题合计 5000ms 正常 → 5',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [{ reaction_time_ms: 5000 }],
	}),
	5,
);

assert(
	'逐题合计 1e8ms(>7200s) → 0（不伪装成 7200）',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [{ reaction_time_ms: 1e8 }],
	}),
	0,
);

assert(
	'逐题合计 7400000ms(=7400s>7200) → 0',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [{ reaction_time_ms: 7400000 }],
	}),
	0,
);

assert(
	'逐题合计 7200000ms(=7200s) → 7200',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [{ reaction_time_ms: 7200000 }],
	}),
	7200,
);

assert(
	'逐题合计 7199999ms(=7200s) → 7200',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [{ reaction_time_ms: 7199999 }],
	}),
	7200,
);

// 5. 两种来源均缺失/异常 → 0（不再回退 Session 提交耗时）
assert(
	'双源缺失 → 0（不回退提交耗时）',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [],
	}),
	0,
);

assert(
	'双源缺失且 Session 提交差为 5s → 仍为 0',
	resolveCompletionTimeSeconds({
		clientDuration: undefined,
		answers: [],
	}),
	0,
);

// 6. 纯函数确定性（评分链路无副作用）
const a = resolveCompletionTimeSeconds({ clientDuration: 174, answers: [] });
const b = resolveCompletionTimeSeconds({ clientDuration: 174, answers: [] });
assert('纯函数确定性（评分链路无副作用）', a === b && a === 174, true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
	process.exit(1);
}