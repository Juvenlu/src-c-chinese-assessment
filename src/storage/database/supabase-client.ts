import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

function getSupabaseCredentials(): SupabaseCredentials {
  const url = process.env.COZE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.COZE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('COZE_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is not set');
  }
  if (!anonKey) {
    throw new Error('COZE_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
  }

  return { url, anonKey };
}

// 惰性单例：build 阶段不执行，运行时首次调用才真正初始化
let _cachedClient: SupabaseClient | null = null;
let _cachedToken: string | undefined = undefined;

function getSupabaseClient(token?: string): SupabaseClient {
  // 同 token 复用实例；token 变化时重建
  if (_cachedClient && _cachedToken === token) {
    return _cachedClient;
  }

  const { url, anonKey } = getSupabaseCredentials();

  let key: string;
  if (token) {
    key = anonKey;
  } else {
    const serviceRoleKey = getSupabaseServiceRoleKey();
    key = serviceRoleKey ?? anonKey;
  }

  const globalOptions: Record<string, unknown> = {};
  if (token) {
    globalOptions.headers = { Authorization: `Bearer ${token}` };
  }

  const client = createClient(url, key, {
    global: globalOptions,
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  _cachedClient = client;
  _cachedToken = token;
  return client;
}

function getSupabaseServiceRoleKey(): string | undefined {
  return process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export { getSupabaseCredentials, getSupabaseServiceRoleKey, getSupabaseClient };
