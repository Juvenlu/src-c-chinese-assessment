'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { AlertCircle, ArrowLeft, Loader2, Plus, Users } from 'lucide-react';

interface ClassItem {
  id: string;
  name: string;
  invite_code: string;
  status: string;
  created_at: number;
  member_count: number;
}

type PageState = 'loading' | 'ok' | 'forbidden' | 'error';

// ==================== 页面 ====================
export default function TeacherClassesPage() {
  const router = useRouter();
  const { user, loading, authFetch } = useAuth();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [classes, setClasses] = useState<ClassItem[]>([]);

  // 创建班级表单
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // 未登录 → 教师登录页
  useEffect(() => {
    if (!loading && !user) {
      router.push('/teacher/login');
    }
  }, [user, loading, router]);

  // 加载班级列表（Worker 端校验 teacher 角色：401 未登录 / 403 非教师）
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await authFetch('/api/classes');
        if (cancelled) return;
        if (res.status === 401) {
          router.push('/teacher/login');
          return;
        }
        if (res.status === 403) {
          setPageState('forbidden');
          return;
        }
        if (!res.ok) {
          setPageState('error');
          return;
        }
        const data = await res.json().catch(() => null);
        setClasses(Array.isArray(data?.classes) ? data.classes : []);
        setPageState('ok');
      } catch {
        if (!cancelled) setPageState('error');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user, loading, router, authFetch]);

  const handleCreate = async () => {
    setCreateError('');
    const name = newName.trim();
    if (!name) {
      setCreateError('请输入班级名称');
      return;
    }
    if (name.length > 50) {
      setCreateError('班级名称不能超过 50 个字符');
      return;
    }
    setCreating(true);
    try {
      const res = await authFetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push('/teacher/login');
        return;
      }
      if (!res.ok) {
        setCreateError((data && data.error) || '创建失败，请稍后重试');
        return;
      }
      const created = data?.class;
      if (created?.id) {
        // 创建成功：进入班级详情（展示邀请码，便于立即邀请家长）
        router.push(`/teacher/classes/${created.id}`);
        return;
      }
      setCreateError('创建成功但返回异常，请刷新查看');
    } catch {
      setCreateError('网络异常，请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  // ==================== 渲染 ====================
  if (loading || !user || pageState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="flex items-center gap-2 text-lg text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  if (pageState === 'forbidden') {
    return (
      <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 text-center space-y-4">
          <div className="flex justify-center">
            <AlertCircle className="w-10 h-10 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">该账号未开通教师身份</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            只有教师账号可以创建和管理班级。
          </p>
          <Link href="/teacher" className="block">
            <button className="w-full px-4 py-3 rounded-2xl bg-[var(--color-src-primary)] text-white font-medium shadow-md transition-all duration-200 hover:shadow-lg active:scale-95">
              返回教师中心
            </button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* 顶部：返回 + 标题 */}
        <div className="flex items-center gap-3">
          <Link
            href="/teacher"
            className="inline-flex items-center justify-center w-9 h-9 bg-white/80 rounded-full shadow-sm text-gray-600 hover:bg-white hover:shadow-md transition-all"
            aria-label="返回教师中心"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1
            className="text-2xl sm:text-3xl font-bold"
            style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}
          >
            我的班级
          </h1>
        </div>

        {/* 创建班级卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Plus className="w-5 h-5 text-[var(--color-src-primary)]" />
            创建新班级
          </h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：周六上午中文班"
              maxLength={50}
              className="flex-1 px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-[var(--color-src-primary)] focus:outline-none text-gray-800 transition-colors"
            />
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-6 py-3 rounded-2xl bg-[var(--color-src-primary)] text-white font-bold shadow-md transition-all duration-200 hover:shadow-lg active:scale-95 disabled:opacity-50 whitespace-nowrap"
            >
              {creating ? '创建中...' : '创建'}
            </button>
          </div>
          {createError && (
            <p className="text-sm text-red-500 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {createError}
            </p>
          )}
        </div>

        {/* 加载/错误提示 */}
        {pageState === 'error' && (
          <div className="bg-white rounded-2xl shadow-lg p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
            <p className="text-sm text-gray-500">班级列表加载失败，请稍后刷新重试。</p>
          </div>
        )}

        {/* 班级列表 */}
        {pageState === 'ok' && classes.length === 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center space-y-2">
            <Users className="w-10 h-10 text-gray-300 mx-auto" />
            <p className="text-gray-500">还没有班级</p>
            <p className="text-xs text-gray-400">创建班级后，把邀请码发给家长，家长授权孩子加入。</p>
          </div>
        )}

        {pageState === 'ok' &&
          classes.map((cls) => (
            <Link key={cls.id} href={`/teacher/classes/${cls.id}`} className="block">
              <div className="bg-white rounded-2xl shadow-lg p-5 flex items-center gap-4 transition-all duration-200 hover:shadow-xl hover:scale-[1.01] active:scale-[0.99]">
                <div className="w-12 h-12 rounded-xl bg-[var(--color-src-primary)]/10 flex items-center justify-center shrink-0">
                  <Users className="w-6 h-6 text-[var(--color-src-primary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-800 truncate">{cls.name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {cls.member_count} 名学生
                  </p>
                </div>
                <span className="text-sm text-gray-400">查看 ›</span>
              </div>
            </Link>
          ))}
      </div>
    </div>
  );
}
