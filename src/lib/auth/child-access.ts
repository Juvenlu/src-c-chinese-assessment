/**
 * Child 数据访问鉴权 helper
 *
 * 统一权限链：User → Child (ownership) → Learning Data
 * 所有涉及 child_id / session_id 的 API 都必须经过这里校验。
 *
 * 当前版本使用 children.parent_id = currentUser.id 进行归属校验。
 * 未来引入 Teacher / Class 时，在此处扩展权限判定逻辑即可。
 */
import { getCurrentUser, getSupabaseClient } from '@/lib/auth-utils';
import { NextResponse } from 'next/server';

/**
 * 校验当前请求是否已登录，返回用户信息
 * 未登录返回 null（调用方决定返回 401）
 */
export async function requireAuthenticatedUser(): Promise<{ id: string; email: string } | null> {
  return getCurrentUser();
}

/**
 * 校验指定 child_id 是否属于当前登录用户
 * 未登录 → 返回 { error: 401 }
 * 无权限 → 返回 { error: 403 }
 * 有权限 → 返回 { user, childId }
 */
export async function requireChildOwnership(childId: string): Promise<
  | { ok: true; user: { id: string; email: string }; childId: string }
  | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  if (!childId) {
    return { ok: false, status: 403 as const, error: 'Forbidden' };
  }

  const supabase = getSupabaseClient();
  const { data: child } = await supabase
    .from('children')
    .select('id, parent_id')
    .eq('id', childId)
    .maybeSingle();

  if (!child) {
    // 不暴露具体存在性，统一返回 403
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if (child.parent_id !== user.id) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, user, childId };
}

/**
 * 通过 session_id 查找对应的 child_id，并校验归属
 * 权限链：user → session → child → ownership
 */
export async function requireSessionOwnership(sessionId: string): Promise<
  | { ok: true; user: { id: string; email: string }; childId: string; sessionId: string }
  | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  if (!sessionId) {
    return { ok: false, status: 403 as const, error: 'Forbidden' };
  }

  const supabase = getSupabaseClient();
  // 先查 session 对应的 child_id
  const { data: session } = await supabase
    .from('test_sessions')
    .select('id, child_id')
    .eq('id', sessionId)
    .maybeSingle();

  if (!session) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  // 再校验 child 归属
  const { data: child } = await supabase
    .from('children')
    .select('id, parent_id')
    .eq('id', session.child_id)
    .maybeSingle();

  if (!child || child.parent_id !== user.id) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, user, childId: session.child_id, sessionId };
}

/**
 * 便捷函数：返回 Next.js 标准错误响应
 */
export function authErrorResponse(status: 401 | 403, message?: string) {
  const messages: Record<number, string> = {
    401: 'Unauthorized',
    403: 'Forbidden',
  };
  return NextResponse.json(
    { error: message || messages[status] },
    { status }
  );
}
