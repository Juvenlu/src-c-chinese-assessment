'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { AlertCircle, Loader2, LogOut, Users, BookOpen, TrendingUp } from 'lucide-react';

type TeacherCheckState = 'checking' | 'ok' | 'not-teacher' | 'error';

// ==================== 页面 ====================
export default function TeacherHomePage() {
  const router = useRouter();
  const { user, loading, logout, authFetch } = useAuth();

  const [checkState, setCheckState] = useState<TeacherCheckState>('checking');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // 未登录 → 教师登录页
  useEffect(() => {
    if (!loading && !user) {
      router.push('/teacher/login');
    }
  }, [user, loading, router]);

  // 已登录 → 服务端核验 teacher 角色（权限判断以 Worker 为准，不依赖前端角色字段）
  useEffect(() => {
    if (loading || !user) return;

    let cancelled = false;
    const checkTeacherRole = async () => {
      try {
        const res = await authFetch('/api/teacher/me');
        if (cancelled) return;
        if (res.ok) {
          setCheckState('ok');
        } else if (res.status === 401) {
          router.push('/teacher/login');
        } else if (res.status === 403) {
          setCheckState('not-teacher');
        } else {
          setCheckState('error');
        }
      } catch {
        if (!cancelled) setCheckState('error');
      }
    };
    checkTeacherRole();
    return () => { cancelled = true; };
  }, [user, loading, router, authFetch]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    router.push('/');
  };

  // 加载 / 核验中
  if (loading || !user || checkState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="flex items-center gap-2 text-lg text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  // 非教师账号：明确拒绝，不展示教师中心内容
  if (checkState === 'not-teacher') {
    return (
      <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 text-center space-y-4">
          <div className="flex justify-center">
            <AlertCircle className="w-10 h-10 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">该账号未开通教师身份</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            当前账号（{user.email}）是家长账号。现有账号开通教师身份的功能即将开放，敬请期待。
          </p>
          <div className="flex gap-3 pt-2">
            <Link href="/" className="flex-1">
              <button className="w-full px-4 py-3 rounded-2xl bg-white border-2 border-gray-200 text-gray-700 font-medium transition-all duration-200 hover:shadow-md active:scale-95">
                返回首页
              </button>
            </Link>
            <Link href="/hub" className="flex-1">
              <button className="w-full px-4 py-3 rounded-2xl bg-[var(--color-src-primary)] text-white font-medium shadow-md transition-all duration-200 hover:shadow-lg active:scale-95">
                进入中文世界
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (checkState === 'error') {
    return (
      <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 text-center space-y-4">
          <div className="flex justify-center">
            <AlertCircle className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">教师身份验证失败</h1>
          <p className="text-sm text-gray-500">请稍后重试，或重新登录。</p>
          <div className="flex gap-3 pt-2">
            <Link href="/teacher/login" className="flex-1">
              <button className="w-full px-4 py-3 rounded-2xl bg-[var(--color-src-primary)] text-white font-medium shadow-md transition-all duration-200 hover:shadow-lg active:scale-95">
                重新登录
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 教师中心主页
  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* 顶部：标题 + 退出 */}
        <div className="flex items-center justify-between">
          <h1
            className="text-2xl sm:text-3xl font-bold"
            style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}
          >
            教师中心
          </h1>
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white/80 rounded-full shadow-sm text-sm font-medium text-gray-600 hover:bg-white hover:shadow-md transition-all disabled:opacity-50"
          >
            {isLoggingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            退出登录
          </button>
        </div>

        {/* 账号信息卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[var(--color-src-primary)]/10 flex items-center justify-center text-2xl">
              👩‍🏫
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-800 truncate">{user.email}</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--color-src-secondary)]/15 text-teal-700">
                  教师
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-1">
                教师账号已激活
              </p>
            </div>
          </div>
        </div>

        {/* 功能入口（占位，即将开放） */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl shadow p-5 opacity-60 cursor-not-allowed select-none">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-src-primary)]/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-[var(--color-src-primary)]" />
              </div>
              <h3 className="font-bold text-gray-800">我的班级</h3>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed mb-3">
              创建班级，邀请学生加入，查看学生阅读状态
            </p>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-400">
              即将开放
            </span>
          </div>

          <div className="bg-white rounded-2xl shadow p-5 opacity-60 cursor-not-allowed select-none">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-src-accent)]/20 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="font-bold text-gray-800">推送绘本</h3>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed mb-3">
              为班级申请推送定制绘本，由平台管理员审核处理
            </p>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-400">
              即将开放
            </span>
          </div>

          <div className="bg-white rounded-2xl shadow p-5 opacity-60 cursor-not-allowed select-none">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-src-secondary)]/15 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-teal-600" />
              </div>
              <h3 className="font-bold text-gray-800">成长地图</h3>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed mb-3">
              查看班级学生的中文阅读成长曲线与识字进展
            </p>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-400">
              即将开放
            </span>
          </div>
        </div>

        {/* 返回首页 */}
        <div className="text-center">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
