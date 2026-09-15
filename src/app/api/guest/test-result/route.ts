import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/auth-utils';

const WORKER_BASE_URL = process.env.WORKER_BASE_URL;
const SRC_WORKER_SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY;
const WORKER_GUEST_API_ENABLED = process.env.WORKER_GUEST_API_ENABLED === 'true';

/**
 * POST /api/guest/test-result
 * 保存游客快速测试结果（无需登录）
 * body: { device_id, result_data, answers? }
 * 返回：{ guest_session_id }
 *
 * Production: Vercel → Worker → D1
 * Fallback: Supabase（当 Worker 未配置或未启用时）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 生产路径：Worker → D1
    if (WORKER_GUEST_API_ENABLED && WORKER_BASE_URL && SRC_WORKER_SERVICE_KEY) {
      const res = await fetch(`${WORKER_BASE_URL}/v1/guest/test-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SRC-Service-Key': SRC_WORKER_SERVICE_KEY,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json(data, { status: res.status });
      }

      return NextResponse.json(data);
    }

    // Fallback：Supabase
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
