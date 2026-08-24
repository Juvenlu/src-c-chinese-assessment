'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// ==================== 页面 ====================
export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, children, loading, login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 如果已登录且有孩子，直接跳 hub
  useEffect(() => {
    if (!loading && user && children.length > 0) {
      router.push('/hub');
    }
  }, [user, children, loading, router]);

  // 从 URL 预填 email
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) setEmail(emailParam);
  }, [searchParams]);

  const handleLogin = async () => {
    setError('');
    if (!email.trim()) { setError('请输入邮箱地址'); return; }
    if (!password) { setError('请输入密码'); return; }

    setIsSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      if (!result.success) {
        setError(result.error || '登录失败');
        return;
      }

      const kids = result.children || [];
      if (kids.length <= 1) {
        router.push('/hub');
      } else {
        // 多个孩子暂时也直接进hub（取第一个active）
        router.push('/hub');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}>
            欢迎回来
          </h1>
          <p className="text-gray-600">
            登录进入孩子的中文世界
          </p>
        </div>

        {/* 表单卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          {/* 邮箱 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              家长 Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
            />
          </div>

          {/* 密码 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              密码
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full px-4 py-3 pr-12 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>
          </div>

          {/* 忘记密码 */}
          <div className="text-right">
            <button
              onClick={() => router.push('/forgot-password')}
              className="text-sm text-[var(--color-src-primary)] hover:underline"
            >
              忘记密码？
            </button>
          </div>

          {/* 登录按钮 */}
          <button
            onClick={handleLogin}
            disabled={isSubmitting}
            className="w-full py-3.5 bg-[var(--color-src-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? '登录中...' : '登录'}
          </button>
        </div>

        {/* 底部 */}
        <div className="text-center mt-6">
          <p className="text-sm text-gray-600">
            还没有账户？
            <button onClick={() => router.push('/signup')} className="text-[var(--color-src-primary)] font-medium ml-1 hover:underline">
              立即注册
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
