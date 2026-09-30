import { NextRequest, NextResponse } from "next/server";

/**
 * Admin Episode Pages (Master Pages) — Worker Proxy
 *
 * GET /api/admin/episodes/:id/pages  →  GET /v1/admin/episodes/:id/pages
 *
 * 从 Production D1 读取 Master Pages（与 Manual Rewrite 创建时同一数据源）。
 * 返回 RewritePage[] 兼容结构，前端可复用渲染组件。
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
	console.error('[admin/episodes/[id]/pages] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

/**
 * GET /api/admin/episodes/:id/pages
 */
export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;

	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ data: { pages: [] }, error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ data: { pages: [] }, error: 'Worker 未启用' }, { status: 503 });
	}

	try {
		const adminPwd = req.headers.get('x-admin-password') || '';

		const res = await fetch(`${WORKER_BASE_URL}/v1/admin/episodes/${id}/pages`, {
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
		console.error('[admin/episodes/[id]/pages] proxy error:', e);
		return NextResponse.json({ data: { pages: [] }, error: '网络错误' }, { status: 502 });
	}
}
