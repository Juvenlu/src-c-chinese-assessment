'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 重置密码 — 凭一次性 Token 设置新密码（P5-R1B）
 *
 * 安全设计：
 *   - Token 仅从 URL 读取一次，立即 history.replaceState 擦除，不进入 localStorage
 *   - 页面以 no-referrer 渲染（见 metadata/referrer），降低 Referer 泄露风险
 *   - 提交 /api/auth/password-reset/commit，Worker 原子消费（一次性+30分钟有效）
 *   - 成功后引导重新登录（重置后全部旧 Session 失效）
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Token 一次性读取并擦除 URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token') || '';
    setToken(t);
    // 立即从地址栏清除 token，避免留在 URL 历史
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('重置链接无效或已失效，请联系管理员重新申请');
      return;
    }
    if (newPassword.length < 8) {
      setError('新密码至少需要8位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/password-reset/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPassword }),
      });
      const data = await res.json().catch(() => ({ success: false, error: '系统繁忙，请稍后再试' }));
      if (res.ok && data.success) {
        setSuccess(true);
      } else {
        setError(data.error || '重置失败，链接可能已失效，请联系管理员重新申请');
      }
    } catch {
      setError('网络异常，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* 降低 Referer 泄露风险：不向第三方发送前页 URL */}
      <meta name="referrer" content="no-referrer" />
      <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}
          >
            设置新密码
          </h1>
          <p className="text-gray-600">{success ? '密码已重置' : '请输入您的新密码'}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6">
          {!success ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="bg-blue-50 text-blue-800 px-4 py-3 rounded-xl text-sm">
                <p className="font-medium mb-1">🔑 一次性重置链接</p>
                <p className="text-blue-700 text-xs">
                  链接 30 分钟内有效，仅可使用一次。密码重置后，所有登录设备将自动退出，请使用新密码重新登录。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">新密码</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 8 位"
                  autoComplete="new-password"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">确认新密码</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  autoComplete="new-password"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={submitting || !token}
                className="w-full py-3 bg-[var(--color-src-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting ? '提交中…' : '确认重置'}
              </button>
            </form>
          ) : (
            <div className="text-center space-y-5 py-4">
              <div className="text-5xl">🎉</div>
              <div>
                <p className="text-lg font-medium text-gray-800">密码已重置成功</p>
                <p className="text-sm text-gray-500 mt-1">请使用新密码重新登录</p>
              </div>
              <button
                onClick={() => router.push('/login')}
                className="w-full py-3 bg-[var(--color-src-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-opacity"
              >
                前往登录
              </button>
            </div>
          )}
        </div>

        <p className="text-center mt-6 text-sm text-gray-600">
          <button onClick={() => router.push('/login')} className="text-[var(--color-src-primary)] hover:underline">
            ← 返回登录
          </button>
        </p>
        </div>
      </div>
    </>
  );
}