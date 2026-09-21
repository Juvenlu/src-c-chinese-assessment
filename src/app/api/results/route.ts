import { NextRequest, NextResponse } from 'next/server';

/**
 * Test Results — Worker Proxy
 *
 * GET  /api/results?session_id=xxx  → GET  /v1/results?session_id=xxx
 * GET  /api/results?child_id=xxx    → GET  /v1/results?child_id=xxx
 * POST /api/results                 → POST /v1/results
 *
 * 所有请求通过 X-SRC-Service-Key 鉴权后，
 * Worker 内部再用 HMAC Session 校验登录态 + session/child ownership。
 *
 * ⚠️  关键安全原则（由 Worker 保证）：
 * 1. confirmed_level 只能来自 test_sessions.level（服务器端权威）
 * 2. 绝对不能信任客户端 body 传的 level
 * 3. 必须完成 session → child → parent ownership 全链路校验
 * 4. scoring 逻辑在 Worker 侧实现，Vercel 侧不再计算
 *
 * Production 必须走 Worker，绝不 fallback 到 Supabase。
 */

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const WORKER_ENABLED =
	process.env.WORKER_GUEST_API_ENABLED === 'true' ||
	process.env.WORKER_CHILDREN_ENABLED === 'true' ||
	IS_PRODUCTION;

if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
	console.error('[results] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

/**
 * GET /api/results
 * 查询测试结果（支持 session_id 或 child_id）
 */
export async function GET(req: NextRequest) {
	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ data: null });
	}

	try {
		const { searchParams } = new URL(req.url);
		const sessionId = searchParams.get('session_id');
		const childId = searchParams.get('child_id');

		if (!sessionId && !childId) {
			return NextResponse.json({ error: 'session_id or child_id required' }, { status: 400 });
		}

		const params = new URLSearchParams();
		if (sessionId) params.set('session_id', sessionId);
		if (childId) params.set('child_id', childId);

		const res = await fetch(`${WORKER_BASE_URL}/v1/results?${params.toString()}`, {
			method: 'GET',
			headers: {
				Cookie: req.headers.get('cookie') || '',
				'X-SRC-Service-Key': SERVICE_KEY,
			},
			cache: 'no-store',
		});

		const data = await res.json();
		return NextResponse.json(data, { status: res.status });
	} catch (err) {
		console.error('[results GET] worker error:', err);
		return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
	}
}

/**
 * POST /api/results
 * 计算并保存测试结果
 *
 * Vercel 侧只是 proxy，不做任何计算。
 * scoring、level authority、ownership 校验全部在 Worker 侧完成。
 */
export async function POST(req: NextRequest) {
	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ error: '开发模式请开启 Worker' }, { status: 500 });
	}

	try {
		const body = await req.json();

		const res = await fetch(`${WORKER_BASE_URL}/v1/results`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: req.headers.get('cookie') || '',
				'X-SRC-Service-Key': SERVICE_KEY,
			},
			body: JSON.stringify(body),
		});

		const data = await res.json();
		return NextResponse.json(data, { status: res.status });
	} catch (err) {
		console.error('[results POST] worker error:', err);
		return NextResponse.json({ error: '保存结果失败' }, { status: 500 });
	}
}
