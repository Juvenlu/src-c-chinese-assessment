import { NextRequest, NextResponse } from "next/server";

/**
 * Admin Rewrite Finalize — Worker Proxy
 *
 * POST /api/books/rewrite/[id]/finalize  →  POST /v1/admin/rewrite/:id/finalize
 *
 * 鉴权：
 *   1. x-admin-password（Vercel 层不验证，直接转发给 Worker）
 *   2. X-SRC-Service-Key（Vercel → Worker 服务间鉴权）
 *
 * Production 必须走 Worker，绝不 fallback 到 Legacy PG。
 */

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const WORKER_ENABLED =
	process.env.WORKER_GUEST_API_ENABLED === 'true' ||
	process.env.WORKER_CHILDREN_ENABLED === 'true' ||
	IS_PRODUCTION;

if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
	console.error('[rewrite/finalize] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

/**
 * POST /api/books/rewrite/[id]/finalize
 */
export async function POST(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ error: 'Worker 未启用' }, { status: 503 });
	}

	try {
		// 读取 body 用于转发
		const bodyText = await req.text();
		const adminPwd = req.headers.get('x-admin-password') || '';

		const res = await fetch(`${WORKER_BASE_URL}/v1/admin/rewrite/${encodeURIComponent(id)}/finalize`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-admin-password': adminPwd,
				'X-SRC-Service-Key': SERVICE_KEY,
			},
			body: bodyText,
			cache: 'no-store',
		});

		const data = await res.json();
		return NextResponse.json(data, { status: res.status });
	} catch (e: any) {
		console.error('[rewrite/finalize] proxy error:', e);
		return NextResponse.json({ error: '网络错误' }, { status: 502 });
	}
}
