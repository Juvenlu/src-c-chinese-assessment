'use client';

import { useState } from 'react';
import { useAuth, type ChildInfo } from '@/lib/auth-context';
import { AlertCircle, CheckCircle2, Loader2, School } from 'lucide-react';

type JoinState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string };

/**
 * 加入老师教室卡片（P4-T4）
 *
 * 家长输入教师提供的邀请码 → 选择名下孩子 → 明确授权确认 → 提交。
 * 孩子归属校验由 Worker 端强制（只能授权自己名下的孩子）；
 * 本组件仅从服务端返回的孩子列表中选择，不接受外部传入的 child_id。
 */
export function JoinClassCard() {
  const { user, kids, authFetch } = useAuth();

  const [expanded, setExpanded] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<JoinState>({ phase: 'idle' });

  if (!user) return null;

  const activeKids = kids.filter((k) => k.status === 'active');
  const selectedChild: ChildInfo | undefined =
    activeKids.find((k) => k.id === selectedChildId) ??
    (activeKids.length === 1 ? activeKids[0] : undefined);

  const handleOpen = () => {
    setExpanded(true);
    setState({ phase: 'idle' });
    // 默认选中：仅一个孩子时自动选中
    if (activeKids.length === 1) setSelectedChildId(activeKids[0].id);
  };

  const handleSubmit = async () => {
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setState({ phase: 'error', message: '请输入邀请码' });
      return;
    }
    if (!selectedChild) {
      setState({ phase: 'error', message: '请选择要加入班级的孩子' });
      return;
    }
    if (!confirmed) {
      setState({ phase: 'error', message: '请先确认授权说明' });
      return;
    }

    setState({ phase: 'submitting' });
    try {
      const res = await authFetch('/api/classes/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: code, child_id: selectedChild.id }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 401) {
        setState({ phase: 'error', message: '登录已过期，请重新登录后再试' });
        return;
      }
      if (res.status === 429) {
        setState({ phase: 'error', message: '操作过于频繁，请稍后再试' });
        return;
      }
      if (res.ok && data?.success) {
        setState({
          phase: 'success',
          message: data.already_member
            ? `${selectedChild.nickname} 已在该班级中，无需重复加入`
            : `已成功授权 ${selectedChild.nickname} 加入班级`,
        });
        setInviteCode('');
        setConfirmed(false);
        return;
      }
      // Worker 统一错误文案（不区分码不存在/已归档，防枚举；不暴露内部信息）
      const message =
        typeof data?.error === 'string' && data.error
          ? data.error
          : '加入失败，请稍后重试';
      setState({ phase: 'error', message });
    } catch {
      setState({ phase: 'error', message: '网络异常，请稍后重试' });
    }
  };

  // 折叠态入口卡片
  if (!expanded) {
    return (
      <button
        onClick={handleOpen}
        className="mt-8 w-full rounded-3xl border border-border bg-card p-6 text-left transition-all hover:scale-[1.01] hover:shadow-lg active:scale-[0.99]"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted">
            <School className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-foreground">加入老师教室</h3>
            <p className="text-sm text-muted-foreground">
              输入老师给的邀请码，授权孩子加入班级
            </p>
          </div>
          <span className="text-sm font-medium text-muted-foreground">展开 ›</span>
        </div>
      </button>
    );
  }

  return (
    <div className="mt-8 w-full rounded-3xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <School className="h-5 w-5 text-muted-foreground" />
          加入老师教室
        </h3>
        <button
          onClick={() => setExpanded(false)}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          收起
        </button>
      </div>

      {activeKids.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          请先创建孩子档案，再授权加入老师的班级。
        </p>
      ) : (
        <div className="space-y-4">
          {/* 邀请码输入 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              邀请码
            </label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="输入老师提供的邀请码"
              maxLength={12}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-center text-lg font-bold tracking-[0.2em] text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* 选择孩子（多孩子时展示列表；单孩子自动选中） */}
          {activeKids.length > 1 && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                选择孩子
              </label>
              <div className="space-y-2">
                {activeKids.map((kid) => (
                  <button
                    key={kid.id}
                    onClick={() => setSelectedChildId(kid.id)}
                    className={`w-full rounded-2xl border-2 px-4 py-3 text-left transition-all ${
                      selectedChild?.id === kid.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <span className="font-medium text-foreground">{kid.nickname}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {kid.grade || `${kid.age} 岁`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 授权确认 */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-muted/50 p-4">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#FF6B35]"
            />
            <span className="text-sm leading-relaxed text-muted-foreground">
              我确认授权
              <span className="font-bold text-foreground">
                {selectedChild ? ` ${selectedChild.nickname} ` : ' 所选孩子 '}
              </span>
              加入该班级，老师可以查看孩子的中文等级和阅读状态。
            </span>
          </label>

          {/* 提交 */}
          <button
            onClick={handleSubmit}
            disabled={state.phase === 'submitting'}
            className="w-full rounded-2xl bg-primary px-4 py-3 font-bold text-primary-foreground shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            {state.phase === 'submitting' ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加入...
              </span>
            ) : (
              '确认加入班级'
            )}
          </button>

          {/* 结果反馈 */}
          {state.phase === 'success' && (
            <p className="flex items-start gap-2 rounded-2xl bg-green-50 p-4 text-sm text-green-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              {state.message}
            </p>
          )}
          {state.phase === 'error' && (
            <p className="flex items-start gap-2 rounded-2xl bg-red-50 p-4 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {state.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
