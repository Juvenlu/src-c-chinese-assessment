import { NextRequest, NextResponse } from "next/server";

/**
 * Custom Books List — Worker Proxy
 *
 * GET /api/books/custom?child_id=xxx  → GET /v1/books/custom?child_id=xxx
 *
 * 所有请求通过 X-SRC-Service-Key 鉴权后，
 * Worker 内部再用 HMAC Session 校验登录态 + child ownership。
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
	console.error('[books/custom] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

/**
 * GET /api/books/custom?child_id=xxx
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

		const res = await fetch(`${WORKER_BASE_URL}/v1/books/custom?child_id=${encodeURIComponent(childId)}`, {
			method: 'GET',
			headers: {
				Cookie: req.headers.get('cookie') || '',
				'X-SRC-Service-Key': SERVICE_KEY,
			},
			cache: 'no-store',
		});

		const data = await res.json();
		return NextResponse.json(data, { status: res.status });
	} catch (e: any) {
		console.error('[books/custom] proxy error:', e);
		return NextResponse.json({ error: '网络错误' }, { status: 502 });
	}
}
