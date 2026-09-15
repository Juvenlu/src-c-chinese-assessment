import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/auth-utils';

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * POST /api/guest/test-result
 * 保存游客快速测试结果（无需登录）
 * body: { device_id, result_data, answers? }
 * 返回：{ guest_session_id }
 *
 * Production: Vercel → Worker → D1（fail-fast，绝不 fallback 到 Supabase）
 * Development: 优先 Worker，未配置时 fallback Supabase（仅限本地开发）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const workerConfigured =
      WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY;

    // Production：必须走 Worker，配置缺失直接 fail-fast
    if (IS_PRODUCTION && !workerConfigured) {
      console.error(
        '[guest test result POST] PRODUCTION ERROR: Worker is not configured. ' +
          'Required: WORKER_GUEST_API_ENABLED=true, WORKER_BASE_URL, SRC_WORKER_SERVICE_KEY.',
      );
      return NextResponse.json(
        { error: '服务配置错误' },
        { status: 500 },
      );
    }

    // Worker 已配置：走 Vercel → Worker → D1
    if (workerConfigured) {
      const res = await fetch(`${WORKER_BASE_URL}/v1/guest/test-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY as string,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json(data, { status: res.status });
      }

      return NextResponse.json(data);
    }

    // Development fallback：Supabase（仅开发环境，Production 不会到达此处）
    const supabase = getSupabaseClient();
    const { device_id, result_data } = body;

    if (!device_id || !result_data) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { data: session, error } = await supabase
      .from('guest_test_sessions')
      .insert({
        id: sessionId,
        device_id,
        test_status: 'completed',
        result_data,
        claimed: false,
        completed_at: now,
        created_at: now,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[guest test result POST] supabase error:', error);
      return NextResponse.json({ error: '保存失败' }, { status: 500 });
    }

    return NextResponse.json({
      guest_session_id: session.id,
    });
  } catch (err) {
    console.error('[guest test result POST] error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

/**
 * GET /api/guest/test-result?id=xxx
 * 获取游客测试结果（无需登录）
 * 暂保留 Supabase 路径（后续迁移）
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少会话ID' }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: session } = await supabase
      .from('guest_test_sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ error: '测试结果不存在' }, { status: 404 });
    }

    return NextResponse.json({
      session_id: session.id,
      test_status: session.test_status,
      result_data: session.result_data,
      claimed: session.claimed,
      created_at: session.created_at,
    });
  } catch (err) {
    console.error('[guest test result GET] error:', err);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}
