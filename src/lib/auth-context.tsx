'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';

// ============== 类型 ==============
export interface UserInfo {
  id: string;
  email: string;
  emailVerified: boolean;
  subscription_status?: string;
  plan_type?: string;
}

export interface ChildInfo {
  id: string;
  parent_id: string;
  nickname: string;
  age: number;
  grade: string;
  country: string;
  home_language: string | null;
  home_language_other: string | null;
  created_at: string;
  status: string;
}

interface AuthContextValue {
  user: UserInfo | null;
  children: ChildInfo[];
  kids: ChildInfo[];  // 同 children，语义化别名
  activeChild: ChildInfo | null;
  latestResult: QuickResult | null;
  loading: boolean;
  error: string | null;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  // 操作
  signup: (data: SignupData) => Promise<{ success: boolean; child?: ChildInfo; error?: string }>;
  login: (email: string, password: string) => Promise<{ success: boolean; children?: ChildInfo[]; error?: string }>;
  sendOtp: (email: string) => Promise<{
    success: boolean;
    maskedEmail?: string;
    isExistingAccount?: boolean;
    devCode?: string;
    error?: string;
  }>;
  verifyOtp: (email: string, code: string) => Promise<{ success: boolean; isNewUser?: boolean; children?: ChildInfo[]; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  createChild: (data: CreateChildData) => Promise<{ success: boolean; child?: ChildInfo; error?: string }>;
  updateChild: (childId: string, data: Partial<CreateChildData>) => Promise<{ success: boolean; child?: ChildInfo; error?: string }>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  setActiveChild: (childId: string) => void;
}

export interface SignupData {
  email: string;
  password: string;
  nickname: string;
  age: number;
  grade: string;
  country: string;
  home_language?: string;
  home_language_other?: string;
  guest_session_id?: string;
}

interface QuickResult {
  id?: string;
  child_id?: string;
  reading_base: number;
  character_level_l: number;
  character_level_u: number;
  word_level_l: number;
  word_level_u: number;
  confidence: string;
  created_at?: string;
}

export interface CreateChildData {
  nickname: string;
  age: number;
  grade: string;
  country: string;
  home_language?: string;
  home_language_other?: string;
  guest_session_id?: string;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ============== Provider ==============
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [kids, setKids] = useState<ChildInfo[]>([]);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<QuickResult | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 带身份的 fetch
  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (sessionToken) {
      headers.set('x-session', sessionToken);
    }
    return fetch(url, { ...options, headers });
  }, [sessionToken]);

  // 获取当前用户
  const refreshUser = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch('/api/auth/me');
      if (res.status === 401) {
        setUser(null);
        setKids([]);
        setActiveChildId(null);
        setLatestResult(null);
        return;
      }
      if (!res.ok) throw new Error('获取用户信息失败');
      const data = await res.json();
      setUser(data.user);
      const childList = data.children || [];
      setKids(childList);
      // 默认选第一个孩子作为 activeChild
      if (childList.length > 0 && !activeChildId) {
        setActiveChildId(childList[0].id);
      } else if (childList.length === 0) {
        setActiveChildId(null);
      }
      // 加载最新结果
      if (childList.length > 0) {
        const firstChildId = activeChildId || childList[0].id;
        try {
          const rres = await authFetch(`/api/quick-results?child_id=${firstChildId}&limit=1`);
          if (rres.ok) {
            const rdata = await rres.json();
            if (rdata.results && rdata.results.length > 0) {
              const r = rdata.results[0];
              setLatestResult({
                id: r.id,
                child_id: r.child_id,
                reading_base: r.reading_base,
                character_level_l: r.character_level_l,
                character_level_u: r.character_level_u,
                word_level_l: r.word_level_l,
                word_level_u: r.word_level_u,
                confidence: r.confidence,
                created_at: r.created_at,
              });
            }
          }
        } catch (e) {
          console.warn('[Auth] load latest result failed:', e);
        }
      }
    } catch (err) {
      console.error('[Auth] refresh error:', err);
      setUser(null);
      setKids([]);
      setActiveChildId(null);
      setLatestResult(null);
    } finally {
      setLoading(false);
    }
  }, [activeChildId]);

  // 初始化时加载
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // 注册
  const signup = useCallback(async (data: SignupData) => {
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) return { success: false, error: result.error || '注册失败' };

      // 保存 session token
      if (result.session) {
        localStorage.setItem('src_session', result.session);
        setSessionToken(result.session);
      }

      // 直接设置用户和孩子状态（不等 refreshUser 异步）
      if (result.user) {
        setUser(result.user);
      }
      const childList: ChildInfo[] = result.children || (result.child ? [result.child] : []);
      setKids(childList);
      if (childList.length > 0) {
        setActiveChildId(childList[0].id);
      }
      setLoading(false);

      return { success: true, child: result.child, children: childList };
    } catch {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, []);

  // 登录
  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || '登录失败' };

      // 保存 session token
      if (data.session) {
        localStorage.setItem('src_session', data.session);
        setSessionToken(data.session);
      }

      // 直接设置用户和孩子状态，确保跳转时状态已就绪
      if (data.user) {
        setUser(data.user);
      }
      if (data.children && Array.isArray(data.children)) {
        setKids(data.children);
        if (data.children.length > 0) {
          setActiveChildId(data.children[0].id);
        }
      }
      setLoading(false);

      return { success: true, children: data.children || [] };
    } catch {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, []);

  // 发送验证码
  const sendOtp = useCallback(async (email: string) => {
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || '发送失败' };
      return {
        success: true,
        maskedEmail: data.maskedEmail,
        isExistingAccount: data.isExistingAccount,
        devCode: data.dev_code,
      };
    } catch {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, []);

  // 验证验证码并登录
  const verifyOtp = useCallback(async (email: string, code: string) => {
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || '验证失败' };
      
      // 保存 session token
      if (data.session) {
        localStorage.setItem('src_session', data.session);
      }
      
      // 登录成功，刷新用户信息
      await refreshUser();
      return { success: true, isNewUser: data.isNewUser, children: data.children };
    } catch {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, [refreshUser]);

  // 退出登录
  const logout = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 忽略
    }
    localStorage.removeItem('src_session');
    setUser(null);
    setKids([]);
    setActiveChildId(null);
  }, []);

  // 修改密码
  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: err.error || '修改失败' };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || '网络错误' };
    }
  }, [authFetch]);

  // 创建孩子
  const createChild = useCallback(async (childData: CreateChildData) => {
    try {
      const res = await fetch('/api/children', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(childData),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || '创建失败' };
      
      // 刷新孩子列表
      await refreshUser();
      return { success: true, child: data.child };
    } catch {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, [refreshUser]);

  // 更新孩子
  const updateChild = useCallback(async (childId: string, childData: Partial<CreateChildData>) => {
    try {
      const res = await fetch(`/api/children/${childId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(childData),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || '更新失败' };
      
      await refreshUser();
      return { success: true, child: data.child };
    } catch {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, [refreshUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      children: kids,
      kids,  // 同 children，语义化别名
      activeChild: kids.find(c => c.id === activeChildId) || null,
      latestResult,
      loading,
      error,
      signup,
      login,
      sendOtp,
      verifyOtp,
      logout,
      refreshUser,
      createChild,
      updateChild,
      changePassword,
      setActiveChild: (id: string) => setActiveChildId(id),
      authFetch,
    }),
    [user, kids, activeChildId, latestResult, loading, error, sendOtp, verifyOtp, logout, refreshUser, createChild, updateChild, changePassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth 必须在 AuthProvider 内使用');
  }
  return ctx;
}
