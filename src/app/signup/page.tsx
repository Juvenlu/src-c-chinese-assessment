'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, type CreateChildData } from '@/lib/auth-context';

// ==================== 常量 ====================
const AGE_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 5); // 5-16岁
const GRADE_OPTIONS = [
  'Kindergarten',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
  'Grade 7',
  'Grade 8',
  'Grade 9',
  'Grade 10',
  'Grade 11',
  'Grade 12',
];
const COUNTRY_OPTIONS = ['Canada', 'USA', 'Other'];
const LANGUAGE_OPTIONS = [
  { value: 'chinese_primary', label: '中文为主' },
  { value: 'bilingual', label: '中英双语' },
  { value: 'english_primary', label: '英文为主' },
  { value: 'other', label: '其他' },
];

// ==================== 页面 ====================
export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, children, loading, sendOtp, verifyOtp, createChild } = useAuth();

  const [step, setStep] = useState<'form' | 'otp' | 'creating'>('form');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 孩子信息
  const [nickname, setNickname] = useState('');
  const [age, setAge] = useState('7');
  const [grade, setGrade] = useState('Grade 1');
  const [country, setCountry] = useState('Other');
  const [homeLanguage, setHomeLanguage] = useState('');
  const [homeLanguageOther, setHomeLanguageOther] = useState('');

  // 游客测试 session_id
  const [guestSessionId, setGuestSessionId] = useState('');

  // 从 URL / localStorage 读取游客测试信息
  useEffect(() => {
    const fromQuicktest = searchParams.get('from') === 'quicktest';
    if (fromQuicktest) {
      // 从 localStorage 读
      const saved = localStorage.getItem('src_guest_session_id');
      if (saved) setGuestSessionId(saved);
    }
  }, [searchParams]);

  // 如果已登录且有孩子，直接跳 hub
  useEffect(() => {
    if (!loading && user && children.length > 0) {
      router.push('/hub');
    }
  }, [user, children, loading, router]);

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // 年龄自动对应年级
  useEffect(() => {
    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum)) return;
    // 5岁 → Kindergarten
    // 6岁 → Grade 1，以此类推
    if (ageNum === 5) setGrade('Kindergarten');
    else if (ageNum >= 6 && ageNum <= 17) setGrade(`Grade ${ageNum - 5}`);
  }, [age]);

  // ==================== 发送验证码 ====================
  const handleSendOtp = async () => {
    setError('');
    // 基础校验
    if (!email.trim()) { setError('请输入邮箱地址'); return; }
    if (!nickname.trim()) { setError('请输入孩子昵称'); return; }

    const result = await sendOtp(email.trim());
    if (!result.success) {
      setError(result.error || '发送失败');
      return;
    }
    setMaskedEmail(result.maskedEmail || '');
    setStep('otp');
    setCountdown(60);
  };

  // ==================== 重新发送 ====================
  const handleResend = async () => {
    if (countdown > 0) return;
    setError('');
    const result = await sendOtp(email.trim());
    if (!result.success) {
      setError(result.error || '发送失败');
      return;
    }
    setCountdown(60);
  };

  // ==================== 验证 OTP + 创建孩子 ====================
  const handleVerify = async () => {
    setError('');
    if (!/^\d{6,}$/.test(otp.trim())) {
      setError('请输入6位数字验证码');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await verifyOtp(email.trim(), otp.trim());
      if (!result.success) {
        setError(result.error || '验证失败');
        setIsSubmitting(false);
        return;
      }

      // 验证成功 → 创建孩子档案（绑定游客测试）
      setStep('creating');
      const childData: CreateChildData = {
        nickname: nickname.trim(),
        age: parseInt(age, 10),
        grade: grade,
        country: country,
        home_language: homeLanguage || undefined,
        home_language_other: homeLanguage === 'other' ? homeLanguageOther : undefined,
        guest_session_id: guestSessionId || undefined,
      };

      const childResult = await createChild(childData);
      if (!childResult.success) {
        setError(childResult.error || '创建孩子档案失败');
        setStep('otp');
        setIsSubmitting(false);
        return;
      }

      // 成功 → 跳转到 hub
      router.push('/hub');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==================== 渲染 ====================
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4">
      <div className="max-w-md mx-auto">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}>
            保存孩子的中文成长
          </h1>
          <p className="text-gray-600">
            保存刚才的测试结果，开启孩子的中文成长地图
          </p>
        </div>

        {/* 表单卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
          {step === 'form' && (
            <FormStep
              email={email} setEmail={setEmail}
              nickname={nickname} setNickname={setNickname}
              age={age} setAge={setAge}
              grade={grade} setGrade={setGrade}
              country={country} setCountry={setCountry}
              homeLanguage={homeLanguage} setHomeLanguage={setHomeLanguage}
              homeLanguageOther={homeLanguageOther} setHomeLanguageOther={setHomeLanguageOther}
              error={error}
              onSubmit={handleSendOtp}
            />
          )}

          {step === 'otp' && (
            <OtpStep
              maskedEmail={maskedEmail}
              otp={otp}
              setOtp={setOtp}
              countdown={countdown}
              error={error}
              onBack={() => setStep('form')}
              onResend={handleResend}
              onVerify={handleVerify}
              isSubmitting={isSubmitting}
            />
          )}

          {step === 'creating' && (
            <div className="text-center py-8">
              <div className="animate-spin w-12 h-12 border-4 border-orange-200 border-t-orange-500 rounded-full mx-auto mb-4"></div>
              <p className="text-gray-600">正在为孩子建立成长档案...</p>
            </div>
          )}
        </div>

        {/* 底部说明 */}
        <p className="text-center text-sm text-gray-500 mt-6">
          我们重视您的隐私。仅用于孩子中文成长相关通知。
        </p>
      </div>
    </div>
  );
}

// ==================== Step 1: 表单 ====================
function FormStep(props: {
  email: string; setEmail: (v: string) => void;
  nickname: string; setNickname: (v: string) => void;
  age: string; setAge: (v: string) => void;
  grade: string; setGrade: (v: string) => void;
  country: string; setCountry: (v: string) => void;
  homeLanguage: string; setHomeLanguage: (v: string) => void;
  homeLanguageOther: string; setHomeLanguageOther: (v: string) => void;
  error: string;
  onSubmit: () => void;
}) {
  const {
    email, setEmail, nickname, setNickname,
    age, setAge, grade, setGrade,
    country, setCountry,
    homeLanguage, setHomeLanguage,
    homeLanguageOther, setHomeLanguageOther,
    error, onSubmit,
  } = props;

  return (
    <>
      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* 邮箱 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          家长 Email <span className="text-red-500">*</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="example@email.com"
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
        />
      </div>

      {/* 孩子昵称 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          孩子昵称 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Leo / 小宇"
          maxLength={20}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
        />
      </div>

      {/* 年龄 + 年级 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            年龄 <span className="text-red-500">*</span>
          </label>
          <select
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors bg-white"
          >
            {AGE_OPTIONS.map(a => (
              <option key={a} value={a}>{a}岁</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            年级 <span className="text-red-500">*</span>
          </label>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors bg-white"
          >
            {GRADE_OPTIONS.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 国家 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          国家/地区 <span className="text-red-500">*</span>
        </label>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors bg-white"
        >
          {COUNTRY_OPTIONS.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* 语言环境（选填） */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          语言环境 <span className="text-gray-400 text-xs">（选填）</span>
        </label>
        <select
          value={homeLanguage}
          onChange={(e) => setHomeLanguage(e.target.value)}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors bg-white"
        >
          <option value="">请选择</option>
          {LANGUAGE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {homeLanguage === 'other' && (
          <input
            type="text"
            value={homeLanguageOther}
            onChange={(e) => setHomeLanguageOther(e.target.value)}
            placeholder="请填写其他语言"
            className="mt-2 w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none text-sm"
          />
        )}
      </div>

      {/* 提交按钮 */}
      <button
        onClick={onSubmit}
        className="w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all active:scale-98"
        style={{ backgroundColor: 'var(--color-src-primary)' }}
      >
        发送邮箱验证码
      </button>
    </>
  );
}

// ==================== Step 2: OTP 验证 ====================
function OtpStep(props: {
  maskedEmail: string;
  otp: string;
  setOtp: (v: string) => void;
  countdown: number;
  error: string;
  onBack: () => void;
  onResend: () => void;
  onVerify: () => void;
  isSubmitting: boolean;
}) {
  const { maskedEmail, otp, setOtp, countdown, error, onBack, onResend, onVerify, isSubmitting } = props;

  return (
    <>
      <button
        onClick={onBack}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        ← 返回修改
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
          if (e.key === 'Enter' && otp.length === 6 && !isSubmitting) onVerify();
        }}
        placeholder="6位数字验证码"
        maxLength={6}
        className="w-full px-4 py-4 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none text-center text-2xl tracking-widest font-bold transition-colors"
        autoFocus
      />

      <button
        onClick={onVerify}
        disabled={otp.length < 6 || isSubmitting}
        className="w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: 'var(--color-src-primary)' }}
      >
        {isSubmitting ? '验证中...' : '验证并保存'}
      </button>

      <div className="text-center">
        {countdown > 0 ? (
          <span className="text-sm text-gray-400">
            重新发送（{countdown}秒）
          </span>
        ) : (
          <button
            onClick={onResend}
            className="text-sm font-medium hover:underline"
            style={{ color: 'var(--color-src-primary)' }}
          >
            重新发送验证码
          </button>
        )}
      </div>
    </>
  );
}
