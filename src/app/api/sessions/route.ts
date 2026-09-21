import { NextRequest, NextResponse } from 'next/server';

/**
 * Test Sessions — Worker Proxy
 *
 * GET   /api/sessions?child_id=   → GET   /v1/sessions?child_id=
 * POST  /api/sessions             → POST  /v1/sessions
 * PATCH /api/sessions             → PATCH /v1/sessions/:id  (id 从 body 提取)
 *
 * 所有请求通过 X-SRC-Service-Key 鉴权后，
 * Worker 内部再用 HMAC Session 校验登录态 + child/session ownership。
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
	console.error('[sessions] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

/**
 * GET /api/sessions?child_id=xxx
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
		const childId = searchParams.get('child_id');

		if (!childId) {
			return NextResponse.json({ error: 'child_id required' }, { status: 400 });
		}

		const res = await fetch(`${WORKER_BASE_URL}/v1/sessions?child_id=${encodeURIComponent(childId)}`, {
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
		console.error('[sessions GET] worker error:', err);
		return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
	}
}

/**
 * POST /api/sessions
 * 创建测试会话
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

		const res = await fetch(`${WORKER_BASE_URL}/v1/sessions`, {
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
		console.error('[sessions POST] worker error:', err);
		return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
	}
}

/**
 * PATCH /api/sessions
 * 更新测试会话状态
 *
 * 注意：Vercel 接口 id 在 body 里，Worker 接口 id 在 URL path 里，
 * 这里做路径转换：从 body 提取 id → 拼到 URL 上。
 */
export async function PATCH(req: NextRequest) {
	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ error: '开发模式请开启 Worker' }, { status: 500 });
	}

	try {
		const body = await req.json();
		const { id } = body;

		if (!id) {
			return NextResponse.json({ error: 'session id required' }, { status: 400 });
		}

		const res = await fetch(`${WORKER_BASE_URL}/v1/sessions/${encodeURIComponent(id)}`, {
			method: 'PATCH',
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
		console.error('[sessions PATCH] worker error:', err);
		return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
	}
}
