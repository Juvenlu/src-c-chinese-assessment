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
  latestResult: QuickResult | null;  // 兼容旧字段（快速测评原始数据）
  /** 当前激活孩子的统一测评状态（后端派生，前端只读） */
  assessmentStatus: ChildAssessmentStatus | null;
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

/**
 * 孩子测评状态（统一字段，后端派生）
 *
 * - confirmed_level:    正式测试确认的级别（null = 未完成正式测试）
 * - estimated_level:    快速测评预估级别（null = 未完成快速测评）
 * - recommended_test_level: 推荐的正式测试级别
 * - assessment_status:  not_started / estimated / confirmed
 *
 * ⚠️  前端只读，不计算。所有 Level 业务规则由后端统一。
 */
export interface ChildAssessmentStatus {
  confirmed_level: string | null;
  estimated_level: string | null;
  recommended_test_level: string;
  current_level: string | null;
  next_level: string | null;
  assessment_status: 'not_started' | 'estimated' | 'confirmed';
  // 原始数据（供展示用）
  quickResult: QuickResult | null;
  formalResult: {
    level: string;
    character_mastery_rate: number;
    vocab_mastery_rate: number;
    stable_char_count: number;
    created_at: string;
  } | null;
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
  const [assessmentStatus, setAssessmentStatus] = useState<ChildAssessmentStatus | null>(null);
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
        setAssessmentStatus(null);
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
      // 加载当前孩子的测评状态（统一来源：成长地图 API）
      // ⚠️ 前端不做 Level 计算，只读取后端返回的架构字段
      if (childList.length > 0) {
        const firstChildId = activeChildId || childList[0].id;
        try {
          const gres = await authFetch(`/api/growth-map?child_id=${firstChildId}`);
          if (gres.ok) {
            const gdata = await gres.json();
            if (gdata.success && gdata.data) {
              const d = gdata.data;
              // 从后端返回的统一字段中提取测评状态
              // ⚠️ 前端不做 Level 计算，所有等级直接读取后端语义化字段
              // ⚠️ estimated_level = Quick Assessment 估算等级（character_level_u 推导）
              // ⚠️ current_level = confirmed优先，estimated兜底
              // ⚠️ recommended_test_level = 推荐正式测试起点（reading_base 推导）
              setAssessmentStatus({
                confirmed_level: d.confirmed_level,
                estimated_level: d.estimated_level,
                recommended_test_level: d.recommended_test_level,
                assessment_status: d.assessment_status,
                current_level: d.current_level,
                next_level: d.next_level,
                // quickResult 仅保留后端原始字段，前端不再自行推算
                quickResult: d.assessmentType !== 'formal' && d.quickConfidence
                  ? {
                      reading_base: d.recommended_test_level === 'SRC100' ? 100 : d.recommended_test_level === 'SRC300' ? 300 : d.recommended_test_level === 'SRC500' ? 500 : 800,
                      // character_level/word_level 等原始 l/u 不硬编码，
                      // Hub 统一使用 estimated_level / current_level 作为等级来源
                      character_level_l: 0,
                      character_level_u: 0,
                      word_level_l: 0,
                      word_level_u: 0,
                      confidence: d.quickConfidence,
                    }
                  : null,
                formalResult: d.assessmentType === 'formal'
                  ? {
                      level: d.currentLevel,
                      character_mastery_rate: d.srcMastery.masteryRate,
                      vocab_mastery_rate: d.vocabMastery.masteryRate,
                      stable_char_count: d.srcMastery.mastered,
                      created_at: '',
                    }
                  : null,
              });
              // 兼容旧字段 latestResult
              // ⚠️ 兼容层保留，但 Hub 应优先使用 assessmentStatus.current_level
              if (d.assessment_status === 'estimated' && d.estimated_level) {
                const el = d.estimated_level;
                setLatestResult({
                  reading_base: el === 'SRC100' ? 100 : el === 'SRC300' ? 300 : el === 'SRC500' ? 500 : 800,
                  character_level_l: 0,
                  character_level_u: 0,
                  word_level_l: 0,
                  word_level_u: 0,
                  confidence: d.quickConfidence || 'medium',
                });
              }
            }
          }
        } catch (e) {
          console.warn('[Auth] load assessment status failed:', e);
        }
      }
    } catch (err) {
      console.error('[Auth] refresh error:', err);
      setUser(null);
      setKids([]);
      setActiveChildId(null);
      setLatestResult(null);
      setAssessmentStatus(null);
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
    setLatestResult(null);
    setAssessmentStatus(null);
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
      assessmentStatus,
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
    [user, kids, activeChildId, latestResult, assessmentStatus, loading, error, sendOtp, verifyOtp, logout, refreshUser, createChild, updateChild, changePassword]
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
