'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';

function LoginContent() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      alert('请输入邮箱和密码');
      return;
    }

    setLoading(true);
    try {
      // 查询孩子档案
      const res = await fetch(`/api/children?email=${encodeURIComponent(email)}`);
      const { data, error } = await res.json();

      if (error || !data || data.length === 0) {
        alert('未找到该邮箱对应的账户');
        return;
      }

      // 登录成功，跳转到绘本选择页
      const child = data[0];
      router.push(`/book-select?childId=${child.id}`);
    } catch (err) {
      console.error(err);
      alert('登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-[var(--color-src-bg)]">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto bg-[var(--color-src-accent)] rounded-full flex items-center justify-center mb-4 shadow-md">
            <span className="text-4xl">🐵</span>
          </div>
          <h1 className="font-display text-3xl text-[var(--color-src-text)] mb-1">
            欢迎回来
          </h1>
          <p className="text-[var(--color-src-text-light)]">
            登录账户，继续阅读绘本
          </p>
        </div>

        <div className="card-game space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
               邮箱地址
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="parent@example.com"
              className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
              🔒 密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
            />
          </div>

          {/* Login button */}
          <div className="pt-2">
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full rounded-2xl px-8 py-4 font-display text-xl font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-src-primary)' }}
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </div>
        </div>

        {/* Register link */}
        <div className="text-center mt-6">
          <p className="text-sm text-[var(--color-src-text-light)]">
            还没有账户？{' '}
            <a href="/register" className="text-[var(--color-src-primary)] font-medium hover:underline">
              立即注册
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-2xl animate-bounce">🐵</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
