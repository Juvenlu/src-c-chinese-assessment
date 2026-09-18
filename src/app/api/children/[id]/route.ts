import { NextRequest, NextResponse } from 'next/server';

/**
 * Child detail/update — Worker Proxy
 *
 * GET   /api/children/[id] → GET   /v1/children/[id]  (当前前端未直接调用 GET by id)
 * PATCH /api/children/[id] → PATCH /v1/children/[id]
 *
 * Worker 内部用 HMAC Session 校验 + child 归属校验。
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
	console.error('[children/[id]] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ success: false, error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ success: false, error: '开发模式请开启 Worker' });
	}

	try {
		const res = await fetch(`${WORKER_BASE_URL}/v1/children/${id}`, {
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
		console.error('[children/[id] GET] worker error:', err);
		return NextResponse.json({ success: false, error: '查询失败，请稍后重试' }, { status: 500 });
	}
}

export async function PATCH(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ success: false, error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ success: false, error: '开发模式请开启 Worker' });
	}

	try {
		const body = await req.json();

		const res = await fetch(`${WORKER_BASE_URL}/v1/children/${id}`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				Cookie: req.headers.get('cookie') || '',
				'X-SRC-Service-Key': SERVICE_KEY,
			},
			body: JSON.stringify(body),
		});

		const data = await res.json();
		// Worker 返回 { success, child }，与前端期望一致，直接透传
		return NextResponse.json(data, { status: res.status });
	} catch (err) {
		console.error('[children/[id] PATCH] worker error:', err);
		return NextResponse.json({ success: false, error: '更新失败，请稍后重试' }, { status: 500 });
	}
}
