'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 忘记密码 — 提交重置申请（P5-R1B）
 *
 * 安全设计：
 *   - 邮箱存在/不存在/禁用统一返回成功提示（防枚举），由 Worker 保证
 *   - 双维限流（email 60s/1、1h/5；IP 1h/10）由 Worker 执行
 *   - 提交成功后引导联系管理员核实身份（重置链接不会自动发放）
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('请输入注册邮箱');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      // 无论账户是否存在，均不区分响应；网络错误才提示
      const data = await res.json().catch(() => ({ success: false }));
      if (res.ok && data.success) {
        setSubmitted(true);
      } else {
        setError('系统繁忙，请稍后再试');
      }
    } catch {
      setError('网络异常，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}
          >
            忘记密码
          </h1>
          <p className="text-gray-600">
            {submitted ? '申请已提交' : '提交申请后由管理员核实身份'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6">
          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="bg-yellow-50 text-yellow-800 px-4 py-3 rounded-xl text-sm">
                <p className="font-medium mb-1">🔐 账户安全提示</p>
                <p className="text-yellow-700">
                  为保护账户安全，重置密码需经管理员核实身份。
                  提交申请后，请通过您事先与平台建立联系的可信方式（如客服微信、已备案的家长群等）
                  说明情况，管理员核实后会将一次性重置链接交付给您。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">您的注册邮箱</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-[var(--color-src-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting ? '提交中…' : '提交申请'}
              </button>
            </form>
          ) : (
            <div className="text-center space-y-5 py-4">
              <div className="text-5xl">📬</div>
              <div>
                <p className="text-lg font-medium text-gray-800">申请已提交</p>
                <p className="text-sm text-gray-500 mt-1">{email}</p>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                请通过您与平台建立联系的可信方式联系管理员核实身份。
                <br />
                管理员核实通过后，会将一次性重置链接安全地交付给您。
                <br />
                <span className="text-xs text-gray-500">链接 30 分钟内有效，仅可使用一次。</span>
              </p>
              <button
                onClick={() => router.push('/login')}
                className="w-full py-3 bg-[var(--color-src-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-opacity mt-2"
              >
                返回登录
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
  );
}