import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getSupabaseClient } from '@/lib/auth-utils';
import { requireChildOwnership, requireSessionOwnership } from '@/lib/auth/child-access';

/**
 * GET /api/sessions
 * 查询测试会话列表
 *
 * 权限链：user → child → ownership
 * 必须传 child_id，且 child 属于当前登录用户
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const childId = searchParams.get('child_id');

    if (!childId) {
      return NextResponse.json({ error: 'child_id required' }, { status: 400 });
    }

    // 校验 child 归属
    const auth = await requireChildOwnership(childId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('test_sessions')
      .select('*')
      .eq('child_id', auth.childId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('[sessions/GET] error:', error);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}

/**
 * POST /api/sessions
 * 创建测试会话
 *
 * 权限链：user → child → ownership
 * 必须传 child_id，且 child 属于当前登录用户
 */
export async function POST(request: NextRequest) {
  try {
    // 先鉴权（在 body 解析之前）
    const user = await getCurrentUser(request.headers.get('x-session') || '');
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { child_id, level, mode } = body;

    if (!child_id || !level) {
      return NextResponse.json({ error: 'child_id and level required' }, { status: 400 });
    }

    // 校验 child 归属（再次确认 body 中的 child_id 属于当前用户）
    const childAuth = await requireChildOwnership(child_id);
    if (!childAuth.ok) {
      return NextResponse.json({ error: childAuth.error }, { status: childAuth.status });
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('test_sessions')
      .insert({
        child_id: child_id,
        level,
        mode: mode || 'sampling',
        status: 'in_progress',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  } catch (error: any) {
    console.error('[sessions/POST] error:', error);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

/**
 * PATCH /api/sessions
 * 更新测试会话状态
 *
 * 权限链：user → session → child → ownership
 * 必须先查 session → child，校验归属后才能修改
 */
export async function PATCH(request: NextRequest) {
  try {
    // 先验证登录状态（鉴权优先于 body 解析）
    const user = await getCurrentUser(request.headers.get('x-session') || '');
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, status, score } = body;

    if (!id) {
      return NextResponse.json({ error: 'session id required' }, { status: 400 });
    }

    // 关键：通过 session_id 校验权限，确保 child 属于当前用户
    const auth = await requireSessionOwnership(id);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = getSupabaseClient();

    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (score !== undefined) updates.score = score;
    if (status === 'completed') updates.completed_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('test_sessions')
      .update(updates)
      .eq('id', auth.sessionId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('[sessions/PATCH] error:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
