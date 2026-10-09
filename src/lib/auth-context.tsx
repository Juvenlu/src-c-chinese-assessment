'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react';

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
    stable_vocab_count: number;
    total_char_tested: number;
    total_vocab_tested: number;
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

  // 严格递增的 activeChild 加载序列号：旧/错孩子的 growth-map 响应不得覆盖当前孩子
  const activeChildSeqRef = useRef(0);
  // 是否已确定身份（用于让同步 effect 与身份就绪绑定，避免依赖 loading 造成循环）
  const identityReadyRef = useRef(false);

  // 带身份的 fetch
  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (sessionToken) {
      headers.set('x-session', sessionToken);
    }
    return fetch(url, { ...options, headers });
  }, [sessionToken]);

  // 获取当前用户（仅身份 + 孩子列表 + 确定 activeChild；测评状态由独立 effect 同步）
  const refreshUser = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch('/api/auth/me');
      if (res.status === 401) {
        identityReadyRef.current = false;
        setUser(null);
        setKids([]);
        setActiveChildId(null);
        setLatestResult(null);
        setAssessmentStatus(null);
        return;
      }
      if (!res.ok) throw new Error('获取用户信息失败');
      const data = await res.json();
      identityReadyRef.current = true;
      setUser(data.user);
      const childList: ChildInfo[] = data.children || [];
      setKids(childList);

      // 确定当前 active child。
      // 关键：用已 set 的 childList 直接判定，不依赖 React 本轮尚未更新的 state，
      // 避免首挂载读到上一轮闭包里的 null/旧值而错选孩子。
      setActiveChildId((prevId) => {
        if (childList.length === 0) return null;
        if (prevId && childList.some((c) => c.id === prevId)) return prevId;
        return childList[0].id;
      });
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
  }, [authFetch]);

  // 初始化时加载
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // ===== 测评状态严格跟随 activeChildId：切换孩子即重新拉取，旧响应由序列号拦截 =====
  // useLayoutEffect：切换孩子时在浏览器绘制前同步置 loading=true，避免画出上一孩子的等级
  useLayoutEffect(() => {
    // 身份/孩子尚未确定：不放行，避免错显
    if (!identityReadyRef.current) return;
    if (!activeChildId) {
      setAssessmentStatus(null);
      setLatestResult(null);
      setLoading(false);
      return;
    }

    const seq = ++activeChildSeqRef.current;
    let cancelled = false;
    // 同步门控：在绘制前进入加载，Hub 不会显示上一孩子的旧等级
    setLoading(true);

    (async () => {
      try {
        const gres = await authFetch(`/api/growth-map?child_id=${activeChildId}`);

        // 旧/错孩子的响应（已切换或卸载）：丢弃，不得覆盖当前状态
        if (cancelled || seq !== activeChildSeqRef.current) return;

        if (!gres.ok) {
          // 请求失败：清空，绝不沿用上一孩子或旧数据作为当前孩子结果
          setAssessmentStatus(null);
          setLatestResult(null);
          return;
        }

        const gdata = await gres.json();
        if (cancelled || seq !== activeChildSeqRef.current) return;

        if (gdata.success && gdata.data) {
          const d = gdata.data;
          setAssessmentStatus({
            confirmed_level: d.confirmed_level,
            estimated_level: d.estimated_level,
            recommended_test_level: d.recommended_test_level,
            assessment_status: d.assessment_status,
            current_level: d.current_level,
            next_level: d.next_level,
            quickResult: d.assessmentType !== 'formal' && d.quickConfidence
              ? {
                  reading_base: d.recommended_test_level === 'SRC100' ? 100 : d.recommended_test_level === 'SRC300' ? 300 : d.recommended_test_level === 'SRC500' ? 500 : 800,
                  character_level_l: d.quick_char_level ?? 0,
                  character_level_u: d.quick_char_level_u ?? 0,
                  word_level_l: d.quick_word_level_l ?? 0,
                  word_level_u: d.quick_word_level_u ?? 0,
                  confidence: d.quickConfidence,
                }
              : null,
            formalResult: d.assessmentType === 'formal'
              ? {
                  level: d.currentLevel,
                  character_mastery_rate: d.srcMastery.masteryRate,
                  vocab_mastery_rate: d.vocabMastery.masteryRate,
                  stable_char_count: d.srcMastery.mastered,
                  stable_vocab_count: d.vocabMastery.mastered,
                  total_char_tested: d.srcMastery.tested ?? 0,
                  total_vocab_tested: d.vocabMastery.tested ?? 0,
                  created_at: '',
                }
              : null,
          });

          if (d.assessment_status === 'estimated' && d.estimated_level) {
            const el = d.estimated_level;
            setLatestResult({
              reading_base: el === 'SRC100' ? 100 : el === 'SRC300' ? 300 : el === 'SRC500' ? 500 : 800,
              character_level_l: d.quick_char_level ?? 0,
              character_level_u: d.quick_char_level_u ?? 0,
              word_level_l: d.quick_word_level_l ?? 0,
              word_level_u: d.quick_word_level_u ?? 0,
              confidence: d.quickConfidence || 'medium',
            });
          } else {
            setLatestResult(null);
          }
        } else {
          setAssessmentStatus(null);
          setLatestResult(null);
        }
      } catch (e) {
        if (cancelled || seq !== activeChildSeqRef.current) return;
        // 网络失败：清空，不沿用旧孩子数据
        console.warn('[Auth] growth-map sync failed:', e);
        setAssessmentStatus(null);
        setLatestResult(null);
      } finally {
        if (!cancelled && seq === activeChildSeqRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeChildId, authFetch]);

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
      // 身份已就绪（同 login）：确保注册成功后默认孩子的 growth-map 能正常触发
      identityReadyRef.current = true;
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
      // 身份已就绪：否则 useLayoutEffect 的 identityReadyRef 门控会拦截默认孩子的 growth-map
      // 首次登录请求，导致 /hub 回退显示 SRC100（与手动切换孩子时的行为不一致）。
      identityReadyRef.current = true;
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
