import { NextRequest, NextResponse } from "next/server";

/**
 * Custom Book Detail — Worker Proxy
 *
 * GET /api/books/custom/:id  → GET /v1/books/custom/:id
 *
 * 返回含 pages_json 的单本绘本详情。
 * Worker 端做 Session + ownership 校验。
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
	console.error('[books/custom/[id]] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

/**
 * GET /api/books/custom/:id
 */
export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ error: 'Book not found' }, { status: 404 });
	}

	try {
		const { id } = await params;

		const res = await fetch(`${WORKER_BASE_URL}/v1/books/custom/${encodeURIComponent(id)}`, {
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
		console.error('[books/custom/[id]] proxy error:', e);
		return NextResponse.json({ error: '网络错误' }, { status: 502 });
	}
}
