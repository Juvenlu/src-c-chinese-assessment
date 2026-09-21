import { NextRequest, NextResponse } from 'next/server';

/**
 * Test Answers — Worker Proxy
 *
 * GET  /api/answers?session_id=xxx    → GET  /v1/answers?session_id=xxx
 * GET  /api/answers?child_id=xxx      → GET  /v1/answers?child_id=xxx
 * POST /api/answers                   → POST /v1/answers
 *
 * 所有请求通过 X-SRC-Service-Key 鉴权后，
 * Worker 内部再用 HMAC Session 校验登录态 + session/child ownership。
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
	console.error('[answers] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

/**
 * GET /api/answers
 * 查询答案记录（支持 session_id 或 child_id）
 */
export async function GET(req: NextRequest) {
	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ data: [] });
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

		const res = await fetch(`${WORKER_BASE_URL}/v1/answers?${params.toString()}`, {
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
		console.error('[answers GET] worker error:', err);
		return NextResponse.json({ error: 'Failed to fetch answers' }, { status: 500 });
	}
}

/**
 * POST /api/answers
 * 提交答题记录（支持单条或批量）
 *
 * 单条格式：{ session_id, question_id?, question_content, part, selected_answer/answer, is_correct, reaction_time_ms }
 * 批量格式：{ session_id, answers: [ ... ] }
 *
 * Worker 侧已实现同样的单条/批量兼容逻辑。
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

		const res = await fetch(`${WORKER_BASE_URL}/v1/answers`, {
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
		console.error('[answers POST] worker error:', err);
		return NextResponse.json({ error: 'Failed to submit answer' }, { status: 500 });
	}
}
