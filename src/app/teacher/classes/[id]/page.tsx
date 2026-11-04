'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  UserRound,
  Users,
} from 'lucide-react';

interface ClassDetail {
  id: string;
  name: string;
  invite_code: string;
  status: string;
  created_at: number;
}

interface MemberItem {
  child_id: string;
  authorized_at: number;
  nickname: string;
  grade: string;
  confirmed_level: string | null;
}

type PageState = 'loading' | 'ok' | 'not-found' | 'forbidden' | 'error';

// ==================== 页面 ====================
export default function TeacherClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: classId } = use(params);
  const router = useRouter();
  const { user, loading, authFetch } = useAuth();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [classDetail, setClassDetail] = useState<ClassDetail | null>(null);
  const [members, setMembers] = useState<MemberItem[]>([]);

  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [actionError, setActionError] = useState('');

  // 未登录 → 教师登录页
  useEffect(() => {
    if (!loading && !user) {
      router.push('/teacher/login');
    }
  }, [user, loading, router]);

  // 加载班级详情 + 学生名单
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await authFetch(`/api/classes/${classId}`);
        if (cancelled) return;
        if (res.status === 401) {
          router.push('/teacher/login');
          return;
        }
        if (res.status === 403) {
          setPageState('forbidden');
          return;
        }
        if (res.status === 404) {
          setPageState('not-found');
          return;
        }
        if (!res.ok) {
          setPageState('error');
          return;
        }
        const data = await res.json().catch(() => null);
        if (!data?.class) {
          setPageState('error');
          return;
        }
        setClassDetail(data.class);
        setMembers(Array.isArray(data.members) ? data.members : []);
        setPageState('ok');
      } catch {
        if (!cancelled) setPageState('error');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user, loading, router, authFetch, classId]);

  const handleCopy = async () => {
    if (!classDetail) return;
    setActionError('');
    try {
      await navigator.clipboard.writeText(classDetail.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板 API 不可用（如非安全上下文）：降级为选中文本提示
      setActionError('复制失败，请手动长按选中邀请码复制');
    }
  };

  const handleRegenerate = async () => {
    if (!classDetail) return;
    setActionError('');
    setRegenerating(true);
    try {
      const res = await authFetch(`/api/classes/${classId}/invite-code`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push('/teacher/login');
        return;
      }
      if (!res.ok) {
        setActionError((data && data.error) || '重新生成失败，请稍后重试');
        return;
      }
      if (data?.invite_code) {
        setClassDetail({ ...classDetail, invite_code: data.invite_code });
        setConfirmRegen(false);
      } else {
        setActionError('返回异常，请刷新确认');
      }
    } catch {
      setActionError('网络异常，请稍后重试');
    } finally {
      setRegenerating(false);
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

  if (pageState === 'forbidden' || pageState === 'not-found') {
    return (
      <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 text-center space-y-4">
          <div className="flex justify-center">
            <AlertCircle className="w-10 h-10 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">
            {pageState === 'not-found' ? '班级不存在' : '无权查看该班级'}
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            {pageState === 'not-found'
              ? '班级可能已被删除，或链接有误。'
              : '只有教师账号可以查看班级。'}
          </p>
          <Link href="/teacher/classes" className="block">
            <button className="w-full px-4 py-3 rounded-2xl bg-[var(--color-src-primary)] text-white font-medium shadow-md transition-all duration-200 hover:shadow-lg active:scale-95">
              返回我的班级
            </button>
          </Link>
        </div>
      </div>
    );
  }

  if (pageState === 'error' || !classDetail) {
    return (
      <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="text-xl font-bold text-gray-800">加载失败</h1>
          <p className="text-sm text-gray-500">请稍后重试。</p>
          <Link href="/teacher/classes" className="block">
            <button className="w-full px-4 py-3 rounded-2xl bg-[var(--color-src-primary)] text-white font-medium shadow-md transition-all duration-200 hover:shadow-lg active:scale-95">
              返回我的班级
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
            href="/teacher/classes"
            className="inline-flex items-center justify-center w-9 h-9 bg-white/80 rounded-full shadow-sm text-gray-600 hover:bg-white hover:shadow-md transition-all"
            aria-label="返回我的班级"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1
            className="text-2xl sm:text-3xl font-bold truncate"
            style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}
          >
            {classDetail.name}
          </h1>
        </div>

        {/* 邀请码卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
          <h2 className="font-bold text-gray-800">班级邀请码</h2>
          <p className="text-xs text-gray-400 leading-relaxed">
            把邀请码发给家长，家长在「中文世界」中输入邀请码并授权孩子加入。
          </p>
          <div className="flex items-center justify-center gap-3">
            <span
              className="text-3xl sm:text-4xl font-bold tracking-[0.2em] px-6 py-3 rounded-2xl bg-[var(--color-src-accent)]/25 text-gray-800 select-all"
              style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}
            >
              {classDetail.invite_code}
            </span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCopy}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[var(--color-src-primary)] text-white font-bold shadow-md transition-all duration-200 hover:shadow-lg active:scale-95"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? '已复制' : '复制邀请码'}
            </button>
            {!confirmRegen ? (
              <button
                onClick={() => setConfirmRegen(true)}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white border-2 border-gray-200 text-gray-700 font-medium transition-all duration-200 hover:shadow-md active:scale-95"
              >
                <RefreshCw className="w-4 h-4" />
                重新生成
              </button>
            ) : (
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-amber-500 text-white font-bold shadow-md transition-all duration-200 hover:shadow-lg active:scale-95 disabled:opacity-50"
              >
                {regenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {regenerating ? '生成中...' : '确认换码（旧码失效）'}
              </button>
            )}
          </div>
          {actionError && (
            <p className="text-sm text-red-500 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {actionError}
            </p>
          )}
        </div>

        {/* 学生名单 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-[var(--color-src-primary)]" />
            班级学生（{members.length}）
          </h2>

          {members.length === 0 ? (
            <div className="text-center py-6 space-y-2">
              <UserRound className="w-10 h-10 text-gray-300 mx-auto" />
              <p className="text-sm text-gray-500">还没有学生加入</p>
              <p className="text-xs text-gray-400">分享邀请码给家长，等待家长授权孩子加入。</p>
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((m) => (
                <div
                  key={m.child_id}
                  className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50/60 p-4"
                >
                  <div className="w-10 h-10 rounded-full bg-[var(--color-src-secondary)]/15 flex items-center justify-center text-lg shrink-0">
                    🧒
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 truncate">{m.nickname}</p>
                    <p className="text-xs text-gray-400">
                      {m.grade || '未填写年级'}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${
                      m.confirmed_level
                        ? 'bg-[var(--color-src-secondary)]/15 text-teal-700'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {m.confirmed_level || '未测评'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
