import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getSupabaseClient } from '@/lib/auth-utils';
import { requireChildOwnership, requireSessionOwnership } from '@/lib/auth/child-access';

/**
 * GET /api/answers
 * 查询答案记录
 *
 * 权限链：user → session → child → ownership
 * 允许通过 session_id 或 child_id 查询
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  const childId = searchParams.get('child_id');

  // 必须传 session_id 或 child_id 之一
  if (!sessionId && !childId) {
    return NextResponse.json({ error: 'session_id or child_id required' }, { status: 400 });
  }

  let targetChildId: string;

  if (sessionId) {
    // 通过 session_id 访问：走 session → child 权限链
    const auth = await requireSessionOwnership(sessionId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    targetChildId = auth.childId;
  } else {
    // 通过 child_id 访问：直接校验 child 归属
    const auth = await requireChildOwnership(childId!);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    targetChildId = auth.childId;
  }

  const supabase = getSupabaseClient();

  try {
    let query = supabase
      .from('test_answers')
      .select('*')
      .order('created_at', { ascending: true });

    if (sessionId) {
      query = query.eq('session_id', sessionId);
    } else {
      // 通过 child_id + join session 来过滤（保证数据属于该 child）
      // 但 test_answers 没有 child_id 字段，所以通过 session_id 关联
      // 先拿该 child 的所有 session_id
      const { data: sessions } = await supabase
        .from('test_sessions')
        .select('id')
        .eq('child_id', targetChildId);

      if (!sessions || sessions.length === 0) {
        return NextResponse.json({ data: [] });
      }

      const sessionIds = sessions.map(s => s.id);
      query = query.in('session_id', sessionIds);
    }

    const { data, error } = await query;

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('[answers/GET] error:', error);
    return NextResponse.json({ error: 'Failed to fetch answers' }, { status: 500 });
  }
}

/**
 * POST /api/answers
 * 提交答题记录
 *
 * 权限链：user → session → child → ownership
 * 必须校验 session_id 对应的 child 属于当前用户
 */
export async function POST(request: NextRequest) {
  try {
    // 鉴权优先：先验证用户身份（在 body 解析之前
    const user = await getCurrentUser(request.headers.get('x-session') || '');
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { session_id, question_id, part, answer, is_correct, reaction_time_ms } = body;

    if (!session_id || !question_id) {
      return NextResponse.json({ error: 'session_id and question_id required' }, { status: 400 });
    }

    // 关键：通过 session_id 校验权限，确保 child 属于当前用户
    const auth = await requireSessionOwnership(session_id);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('test_answers')
      .insert({
        session_id,
        question_id,
        part: part || null,
        answer: answer || null,
        is_correct: is_correct ?? null,
        reaction_time_ms: reaction_time_ms || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  } catch (error: any) {
    console.error('[answers/POST] error:', error);
    return NextResponse.json({ error: 'Failed to submit answer' }, { status: 500 });
  }
}
