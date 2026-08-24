import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/auth-utils';

/**
 * POST /api/guest/test-result
 * 保存游客快速测试结果（无需登录）
 * body: { device_id, result_data }
 * 返回：{ guest_session_id }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { device_id, result_data } = body;

    if (!result_data) {
      return NextResponse.json({ error: '缺少测试结果数据' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // 创建或更新游客会话
    const { data: session, error } = await supabase
      .from('guest_test_sessions')
      .insert({
        device_id: device_id || null,
        test_status: 'completed',
        result_status: 'completed',
        result_data: result_data,
        claimed: false,
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !session) {
      console.error('[guest test result] error:', error);
      return NextResponse.json({ error: '保存失败' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      guest_session_id: session.id,
    });
  } catch (err) {
    console.error('[guest test result] error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

/**
 * GET /api/guest/test-result?id=xxx
 * 获取游客测试结果（无需登录）
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
