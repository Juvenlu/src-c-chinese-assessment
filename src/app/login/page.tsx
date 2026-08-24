'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const router = useRouter();
  const { user, children, loading, sendOtp, verifyOtp } = useAuth();

  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [devCode, setDevCode] = useState('');

  // 已登录直接跳 hub
  useEffect(() => {
    if (!loading && user && children.length > 0) {
      router.push('/hub');
    }
  }, [user, children, loading, router]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendOtp = async () => {
    setError('');
    if (!email.trim()) { setError('请输入邮箱地址'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('请输入有效的Email地址');
      return;
    }

    const result = await sendOtp(email.trim());
    if (!result.success) {
      setError(result.error || '发送失败');
      return;
    }
    setMaskedEmail(result.maskedEmail || '');
    if (result.devCode) setDevCode(result.devCode);
    setStep('otp');
    setCountdown(60);
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setError('');
    const result = await sendOtp(email.trim());
    if (!result.success) {
      setError(result.error || '发送失败');
      return;
    }
    if (result.devCode) setDevCode(result.devCode);
    setCountdown(60);
  };

  const handleVerify = async () => {
    setError('');
    if (!/^\d{6,}$/.test(otp.trim())) {
      setError('请输入6位数字验证码');
      return;
    }

    setIsSubmitting(true);
    const result = await verifyOtp(email.trim(), otp.trim());
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error || '验证失败');
      return;
    }

    // 登录成功 → 跳 hub
    router.push('/hub');
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
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}>
            欢迎回来
          </h1>
          <p className="text-gray-600">
            使用邮箱验证码登录，继续孩子的中文成长
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
          {step === 'email' && (
            <>
              {error && (
                <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  家长 Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
                  placeholder="example@email.com"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
                  autoFocus
                />
              </div>

              <button
                onClick={handleSendOtp}
                className="w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all active:scale-98"
                style={{ backgroundColor: 'var(--color-src-primary)' }}
              >
                发送登录验证码
              </button>
            </>
          )}

          {step === 'otp' && (
            <>
              <button
                onClick={() => setStep('email')}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ← 修改邮箱
              </button>

              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-2">
                  请输入邮箱验证码
                </h2>
                <p className="text-sm text-gray-500">
                  验证码已发送至：<span className="font-medium text-gray-700">{maskedEmail}</span>
                </p>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm text-center">
                  {error}
                </div>
              )}

              <input
                type="text"
                value={otp}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setOtp(val);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && otp.length === 6 && !isSubmitting) handleVerify();
                }}
                placeholder="6位数字验证码"
                maxLength={6}
                className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none text-center text-2xl tracking-widest font-bold transition-colors"
                autoFocus
              />

              <button
                onClick={handleVerify}
                disabled={otp.length < 6 || isSubmitting}
                className="w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--color-src-primary)' }}
              >
                {isSubmitting ? '验证中...' : '登录'}
              </button>

              <div className="text-center">
                {countdown > 0 ? (
                  <span className="text-sm text-gray-400">
                    重新发送（{countdown}秒）
                  </span>
                ) : (
                  <button
                    onClick={handleResend}
                    className="text-sm font-medium hover:underline"
                    style={{ color: 'var(--color-src-primary)' }}
                  >
                    重新发送验证码
                  </button>
                )}
              </div>

              {/* 开发模式验证码提示 */}
              {devCode && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
                  <p className="text-xs text-yellow-700 mb-1">🛠 开发模式 · 测试验证码</p>
                  <p className="text-xl font-mono font-bold tracking-widest text-yellow-800">
                    {devCode}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          没有账号？<a href="/signup" className="font-medium" style={{ color: 'var(--color-src-primary)' }}>保存孩子的中文成长</a>
        </p>
      </div>
    </div>
  );
}
