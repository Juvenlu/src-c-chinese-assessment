import { NextRequest, NextResponse } from "next/server";

/**
 * Admin Episodes List (Master Story) — Worker Proxy
 *
 * GET /api/admin/episodes  →  GET /v1/admin/episodes
 *
 * 从 Production D1 读取 Master Story 列表，不走 Supabase。
 *
 * 鉴权：
 *   1. x-admin-password
 *   2. X-SRC-Service-Key
 */

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const WORKER_ENABLED =
	process.env.WORKER_GUEST_API_ENABLED === 'true' ||
	process.env.WORKER_CHILDREN_ENABLED === 'true' ||
	IS_PRODUCTION;

if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
	console.error('[admin/episodes] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

/**
 * GET /api/admin/episodes
 */
export async function GET(req: NextRequest) {
	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ data: [], error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ data: [], error: 'Worker 未启用' }, { status: 503 });
	}

	try {
		const adminPwd = req.headers.get('x-admin-password') || '';
		const { searchParams } = new URL(req.url);
		const status = searchParams.get('status');

		let url = `${WORKER_BASE_URL}/v1/admin/episodes`;
		if (status) {
			url += `?status=${encodeURIComponent(status)}`;
		}

		const res = await fetch(url, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				'x-admin-password': adminPwd,
				'X-SRC-Service-Key': SERVICE_KEY,
			},
			cache: 'no-store',
		});

		const data = await res.json();
		return NextResponse.json(data, { status: res.status });
	} catch (e: any) {
		console.error('[admin/episodes] proxy error:', e);
		return NextResponse.json({ data: [], error: '网络错误' }, { status: 502 });
	}
}
