'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';

function RegisterContent() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 家长信息
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [sentCode, setSentCode] = useState(''); // 实际发送的验证码（演示用）

  // 孩子信息
  const [nickname, setNickname] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [country, setCountry] = useState('');
  const [languageEnv, setLanguageEnv] = useState('bilingual');

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - 5 - i);

  // 密码验证
  const validatePassword = (pwd: string): boolean => {
    return pwd.length >= 8 && /[a-zA-Z]/.test(pwd) && /[0-9]/.test(pwd);
  };

  const getPasswordError = (): string => {
    if (!password) return '';
    if (password.length < 8) return '密码至少 8 个字符';
    if (!/[a-zA-Z]/.test(password)) return '密码必须包含字母';
    if (!/[0-9]/.test(password)) return '密码必须包含数字';
    return '';
  };

  const getConfirmPasswordError = (): string => {
    if (!confirmPassword) return '';
    if (password !== confirmPassword) return '两次输入的密码不一致';
    return '';
  };

  // 发送验证码
  const handleSendCode = async () => {
    if (!email) {
      alert('请先输入邮箱地址');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('请输入有效的邮箱地址');
      return;
    }

    setSendingCode(true);
    try {
      // 生成随机 6 位验证码
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      setSentCode(code);

      // 调用发送验证码 API
      const res = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });

      if (!res.ok) throw new Error('发送失败');

      // 开始倒计时
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      alert(`验证码已发送到 ${email}\n（演示模式，验证码：${code}）`);
    } catch (err) {
      console.error(err);
      alert('验证码发送失败，请重试');
    } finally {
      setSendingCode(false);
    }
  };

  // 第一步：验证邮箱
  const handleStep1 = () => {
    if (!email) {
      alert('请输入邮箱地址');
      return;
    }
    if (!validatePassword(password)) {
      alert('密码格式不正确');
      return;
    }
    if (password !== confirmPassword) {
      alert('两次输入的密码不一致');
      return;
    }
    if (!verificationCode) {
      alert('请输入验证码');
      return;
    }
    if (verificationCode !== sentCode) {
      alert('验证码不正确');
      return;
    }
    setStep(2);
  };

  // 第二步：创建账户
  const handleRegister = async () => {
    if (!nickname) {
      alert('请输入孩子昵称');
      return;
    }
    if (!birthYear) {
      alert('请选择出生年份');
      return;
    }

    setLoading(true);
    try {
      const age = currentYear - parseInt(birthYear);

      // 创建孩子档案
      const res = await fetch('/api/children', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nickname,
          age,
          grade: `${age}年级`,
          country: country || '未填写',
          language_env: languageEnv,
          parent_email: email,
        }),
      });

      const { data, error } = await res.json();
      if (error) throw new Error(error);

      // 注册成功，跳转到绘本选择页
      alert('注册成功！');
      router.push(`/book-select?childId=${data.id}`);
    } catch (err) {
      console.error(err);
      alert('注册失败，请重试');
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
            {step === 1 ? '家长注册' : '孩子信息'}
          </h1>
          <p className="text-[var(--color-src-text-light)]">
            {step === 1 ? '创建账户，开启中文学习之旅' : '请填写孩子的基本信息'}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {[1, 2].map((i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-colors ${
                step === i ? 'bg-[var(--color-src-primary)]' : 'bg-[var(--color-src-primary)]/30'
              }`}
            />
          ))}
        </div>

        {step === 1 ? (
          <div className="card-game space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                📧 邮箱地址 <span className="text-red-500">*</span>
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
                🔒 密码 <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位，包含字母和数字"
                className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
              />
              {getPasswordError() && (
                <p className="text-sm text-red-500 mt-1">{getPasswordError()}</p>
              )}
              <p className="text-xs text-[var(--color-src-text-light)] mt-1">
                至少 8 个字符，包含字母和数字
              </p>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                🔒 确认密码 <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码"
                className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
              />
              {getConfirmPasswordError() && (
                <p className="text-sm text-red-500 mt-1">{getConfirmPasswordError()}</p>
              )}
            </div>

            {/* Verification Code */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                 邮箱验证码 <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  placeholder="6 位验证码"
                  maxLength={6}
                  className="flex-1 px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
                />
                <button
                  onClick={handleSendCode}
                  disabled={sendingCode || countdown > 0}
                  className="px-4 py-3 rounded-xl bg-[var(--color-src-secondary)] text-white font-medium disabled:opacity-50 whitespace-nowrap"
                >
                  {countdown > 0 ? `${countdown}秒` : sendingCode ? '发送中...' : '发送验证码'}
                </button>
              </div>
            </div>

            {/* Next button */}
            <div className="pt-2">
              <button
                onClick={handleStep1}
                className="w-full rounded-2xl px-8 py-4 font-display text-xl font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg"
                style={{ backgroundColor: 'var(--color-src-primary)' }}
              >
                下一步 →
              </button>
            </div>
          </div>
        ) : (
          <div className="card-game space-y-5">
            {/* Nickname */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                👶 孩子昵称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="请输入孩子昵称"
                className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
              />
            </div>

            {/* Birth Year */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                🎂 出生年份 <span className="text-red-500">*</span>
              </label>
              <select
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
              >
                <option value="">请选择出生年份</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}年（{currentYear - year}岁）
                  </option>
                ))}
              </select>
            </div>

            {/* Country (Optional) */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                🌍 所在国家 <span className="text-xs text-[var(--color-src-text-light)]">（选填）</span>
              </label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="例如：美国"
                className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
              />
            </div>

            {/* Language Environment (Optional) */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                ️ 语言环境 <span className="text-xs text-[var(--color-src-text-light)]">（选填）</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'bilingual', label: '双语环境' },
                  { key: 'chinese_primary', label: '中文为主' },
                  { key: 'english_primary', label: '英文为主' },
                  { key: 'other', label: '其他' },
                ].map((env) => (
                  <button
                    key={env.key}
                    onClick={() => setLanguageEnv(env.key)}
                    className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                      languageEnv === env.key
                        ? 'bg-[var(--color-src-primary)] text-white shadow-md'
                        : 'bg-white border-2 border-[var(--color-src-primary)]/20 text-[var(--color-src-text)]'
                    }`}
                  >
                    {env.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep(1)}
                className="flex-1 rounded-2xl px-6 py-4 font-display text-lg font-bold transition-all duration-200 active:scale-95 hover:scale-105"
                style={{ backgroundColor: 'rgba(99,110,114,0.15)', color: 'var(--color-src-text)' }}
              >
                ← 返回
              </button>
              <button
                onClick={handleRegister}
                disabled={loading}
                className="flex-[2] rounded-2xl px-8 py-4 font-display text-xl font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-src-primary)' }}
              >
                {loading ? '注册中...' : '完成注册 🎉'}
              </button>
            </div>
          </div>
        )}

        {/* Login link */}
        <div className="text-center mt-6">
          <p className="text-sm text-[var(--color-src-text-light)]">
            已有账户？{' '}
            <a href="/login" className="text-[var(--color-src-primary)] font-medium hover:underline">
              立即登录
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-2xl animate-bounce">🐵</div>
      </div>
    }>
      <RegisterContent />
    </Suspense>
  );
}
