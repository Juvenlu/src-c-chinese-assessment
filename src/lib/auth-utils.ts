import { cookies } from 'next/headers';
import { getSupabaseClient, getSupabaseCredentials } from '@/storage/database/supabase-client';

export const SESSION_COOKIE_NAME = 'src_auth_session';
export const SESSION_DURATION_DAYS = 30;

/**
 * 从请求 Cookie 中获取 session token
 */
export async function getSessionTokenFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value || null;
}

/**
 * 验证 session token，返回用户信息
 * 使用 Supabase Auth 的 getUser 验证
 */
export async function getCurrentUser(token?: string) {
  try {
    const accessToken = token || await getSessionTokenFromCookie();
    if (!accessToken) return null;

    const supabase = getSupabaseClient(accessToken);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * 通过 service role 获取 supabase 客户端（后端专用）
 */
export function getAdminSupabase() {
  return getSupabaseClient();
}

/**
 * 生成 cookie 配置
 */
export function getSessionCookieOptions(maxAgeDays: number = SESSION_DURATION_DAYS) {
  const maxAge = maxAgeDays * 24 * 60 * 60;
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
    path: '/',
  };
}

/**
 * 基本 Email 格式校验
 */
export function isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim().toLowerCase());
}

/**
 * 模糊邮箱显示：j***@gmail.com
 */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const maskedName = name.length <= 1
    ? '*'
    : name[0] + '*'.repeat(Math.max(3, Math.min(name.length - 1, 10)));
  return `${maskedName}@${domain}`;
}
