'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';

// ==================== 页面 ====================
export default function TeacherLoginPage() {
  const router = useRouter();
  const { login, authFetch } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notTeacher, setNotTeacher] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    setError('');
    setNotTeacher(false);
    if (!email.trim()) { setError('请输入邮箱地址'); return; }
    if (!password) { setError('请输入密码'); return; }

    setIsSubmitting(true);
    try {
      // 第一步：复用现有密码验证 + Session（与家长登录同一机制）
      const result = await login(email.trim(), password);
      if (!result.success) {
        setError(result.error || '登录失败');
        return;
      }

      // 第二步：服务端核验 teacher 角色（防止非教师仅靠 URL 进入教师中心）
      const meRes = await authFetch('/api/teacher/me');
      if (meRes.ok) {
        router.push('/teacher');
        return;
      }
      if (meRes.status === 403) {
        // 账号有效但不是教师：提示并保留家长登录态
        setNotTeacher(true);
        return;
      }
      setError('教师身份验证失败，请稍后重试');
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
            教师登录
          </h1>
          <p className="text-gray-600">
            登录进入教师中心
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

          {notTeacher && (
            <div className="bg-amber-50 border-2 border-amber-200 text-amber-700 px-4 py-3 rounded-xl text-sm font-medium leading-relaxed">
              该账号已登录成功，但尚未开通教师身份。教师身份开通功能即将开放；如需进入家长中文世界，
              <Link href="/hub" className="text-[var(--color-src-primary)] hover:underline ml-1">
                请点击这里
              </Link>
              。
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
              onChange={(e) => { setEmail(e.target.value); if (error) setError(''); setNotTeacher(false); }}
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
                onChange={(e) => { setPassword(e.target.value); if (error) setError(''); setNotTeacher(false); }}
                placeholder="请输入密码"
                onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
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

          {/* 提交按钮 */}
          <button
            onClick={handleLogin}
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-2xl bg-[var(--color-src-primary)] text-white font-bold text-lg shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
            {isSubmitting ? '登录中...' : '登录教师中心'}
          </button>

          {/* 底部链接 */}
          <div className="text-center text-sm text-gray-500 space-y-2">
            <p>
              还没有教师账号？
              <Link href="/teacher/signup" className="text-[var(--color-src-primary)] font-medium hover:underline ml-1">
                注册教师账号
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
