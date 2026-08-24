import { cookies, headers } from 'next/headers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
export { getSupabaseClient };

export const SESSION_COOKIE_NAME = 'src_auth_session';
export const SESSION_HEADER_NAME = 'x-session';
export const SESSION_DURATION_DAYS = 30;

/**
 * 从请求 Cookie 中获取 session token
 */
export async function getSessionTokenFromCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(SESSION_COOKIE_NAME)?.value || null;
  } catch {
    return null;
  }
}

/**
 * 从请求 Header 中获取 session token
 */
export async function getSessionTokenFromHeader(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get(SESSION_HEADER_NAME) || null;
  } catch {
    return null;
  }
}

/**
 * 验证 session token，返回用户信息
 * 支持两种模式：
 * 1. Supabase 原生 JWT access_token（生产环境）
 * 2. 自建 base64 session token（开发模式，因无 SMTP 无法走原生 OTP）
 */
export async function getCurrentUser(token?: string): Promise<{ id: string; email: string } | null> {
  let accessToken: string | undefined | null = token;

  if (!accessToken) {
    accessToken = await getSessionTokenFromHeader();
  }

  if (!accessToken) {
    accessToken = await getSessionTokenFromCookie();
  }

  if (!accessToken) {
    return null;
  }

  try {
    const supabase = getSupabaseClient(accessToken);
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      // 尝试解析为自建 session token
      try {
        const decoded = JSON.parse(Buffer.from(accessToken, 'base64').toString('utf-8'));
        if (decoded.uid && decoded.email) {
          // 通过 service role 查询 profile 表
          const adminSb = getSupabaseClient();
          const { data: profile } = await adminSb
            .from('parents_profiles')
            .select('id, email')
            .eq('id', decoded.uid)
            .maybeSingle();

          if (profile) {
            return { id: profile.id, email: profile.email };
          }
        }
      } catch {
        // token 解析失败，返回 null
      }
      return null;
    }

    return { id: user.id, email: user.email || '' };
  } catch {
    return null;
  }
}

/**
 * 生成自建 session token（开发环境，无 SMTP 时使用）
 */
export function generateSessionToken(userId: string, email: string): string {
  const payload = {
    uid: userId,
    iat: Date.now(),
    email,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * 生成6位数字验证码
 */
export function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 简单哈希验证码（保存时使用）
 */
export function hashOtp(code: string): string {
  // 开发环境用简单 hash，生产环境应使用 bcrypt/argon2
  return Buffer.from(code + ':src_salt_v1').toString('base64');
}

/**
 * 验证验证码是否匹配
 */
export function verifyOtpHash(code: string, hash: string): boolean {
  return hashOtp(code) === hash;
}

/**
 * 邮箱掩码显示
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  if (local.length <= 2) {
    return local[0] + '***@' + domain;
  }
  return local[0] + '***' + local[local.length - 1] + '@' + domain;
}

/**
 * 验证邮箱格式
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
