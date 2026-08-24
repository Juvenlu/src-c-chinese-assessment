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
 * 别名兼容
 */
export function hashOtp(code: string): string {
  // 开发环境用简单 hash，生产环境应使用 bcrypt/argon2
  return Buffer.from(code + ':src_salt_v1').toString('base64');
}

/**
 * 哈希验证码（别名，供 send-otp 使用）
 */
export async function hashOtpCode(code: string): Promise<string> {
  return hashOtp(code);
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

/**
 * 检查 OTP 发送频率限制
 * - 60 秒内不能重复发送
 * - 1 小时内最多 5 次
 * 返回 null 表示可以发送，返回字符串表示错误信息
 */
export async function checkOtpRateLimit(
  supabase: ReturnType<typeof getSupabaseClient>,
  email: string
): Promise<string | null> {
  const now = new Date();

  // 检查 60 秒内是否已发送
  const sixtySecondsAgo = new Date(now.getTime() - 60 * 1000);
  const { data: recent } = await supabase
    .from('otp_codes')
    .select('id, created_at')
    .eq('email', email)
    .gte('created_at', sixtySecondsAgo.toISOString())
    .limit(1);

  if (recent && recent.length > 0) {
    return '发送过于频繁，请稍后再试';
  }

  // 检查 1 小时内发送次数
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const { count } = await supabase
    .from('otp_codes')
    .select('*', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', oneHourAgo.toISOString());

  if (count && count >= 5) {
    return '发送次数过多，请稍后再试';
  }

  return null;
}
