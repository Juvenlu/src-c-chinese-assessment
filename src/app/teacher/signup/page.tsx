'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';

// ==================== 页面 ====================
export default function TeacherSignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSignup = async () => {
    setError('');
    if (!email.trim()) { setError('请输入邮箱地址'); return; }
    if (!password) { setError('请输入密码'); return; }
    if (password.length < 8) { setError('密码至少需要8位'); return; }
    if (password !== confirmPassword) { setError('两次输入的密码不一致'); return; }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/teacher/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError((data && data.error) || '注册失败，请稍后重试');
        return;
      }

      // 注册成功：保存 Session（与家长登录同一双通道机制）
      if (data && data.session) {
        localStorage.setItem('src_session', data.session);
      }
      // 整页跳转，让 AuthProvider 重新初始化会话状态
      window.location.href = '/teacher';
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}>
            教师注册
          </h1>
          <p className="text-gray-600">
            创建教师账号，管理班级中文阅读
          </p>
        </div>

        {/* 表单卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border-2 border-red-200 text-red-600 px-4 py-3 rounded-xl flex items-start gap-3 animate-[fadeIn_0.3s_ease-out]">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="text-sm font-medium leading-relaxed">
                {error}
              </div>
            </div>
          )}

          {/* 邮箱 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              教师 Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
              placeholder="teacher@school.com"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-400 transition-colors"
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
                onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                placeholder="至少 8 位"
                className="w-full px-4 py-3 pr-12 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-400 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* 确认密码 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              确认密码
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(''); }}
                placeholder="再次输入密码"
                className="w-full px-4 py-3 pr-12 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-400 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showConfirmPassword ? '隐藏密码' : '显示密码'}
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* 提交按钮 */}
          <button
            onClick={handleSignup}
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-2xl bg-[var(--color-src-primary)] text-white font-bold text-lg shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
            {isSubmitting ? '注册中...' : '注册教师账号'}
          </button>

          {/* 底部链接 */}
          <div className="text-center text-sm text-gray-500 space-y-2">
            <p>
              已有教师账号？
              <Link href="/teacher/login" className="text-[var(--color-src-primary)] font-medium hover:underline ml-1">
                直接登录
              </Link>
            </p>
            <p>
              <Link href="/" className="text-gray-400 hover:text-gray-600">
                返回首页
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
