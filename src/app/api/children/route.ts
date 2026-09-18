import { NextRequest, NextResponse } from 'next/server';

/**
 * Children CRUD — Worker Proxy
 *
 * GET  /api/children            → GET  /v1/children
 * POST /api/children            → POST /v1/children
 *
 * 所有请求通过 X-SRC-Service-Key 鉴权后，
 * Worker 内部再用 HMAC Session 校验登录态。
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

// 开发环境允许关闭，方便本地调试
if (IS_PRODUCTION && (!WORKER_BASE_URL || !SERVICE_KEY)) {
	console.error('[children] Production 缺少 WORKER_BASE_URL 或 SRC_WORKER_SERVICE_KEY 配置');
}

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ children: [] }, { status: 500 });
		}
		return NextResponse.json({ children: [] });
	}

	try {
		const res = await fetch(`${WORKER_BASE_URL}/v1/children`, {
			method: 'GET',
			headers: {
				Cookie: req.headers.get('cookie') || '',
				'X-SRC-Service-Key': SERVICE_KEY,
			},
			cache: 'no-store',
		});

		const data = await res.json();
		// Worker 返回 { children: [...] }，与前端期望一致，直接透传
		return NextResponse.json(data, { status: res.status });
	} catch (err) {
		console.error('[children GET] worker error:', err);
		return NextResponse.json({ children: [] }, { status: 500 });
	}
}

export async function POST(req: NextRequest) {
	if (!WORKER_ENABLED || !WORKER_BASE_URL || !SERVICE_KEY) {
		if (IS_PRODUCTION) {
			return NextResponse.json({ success: false, error: '服务配置错误' }, { status: 500 });
		}
		return NextResponse.json({ success: false, error: '开发模式请开启 Worker' });
	}

	try {
		const body = await req.json();

		const res = await fetch(`${WORKER_BASE_URL}/v1/children`, {
			method: 'POST',
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
		console.error('[children POST] worker error:', err);
		return NextResponse.json({ success: false, error: '创建失败，请稍后重试' }, { status: 500 });
	}
}
