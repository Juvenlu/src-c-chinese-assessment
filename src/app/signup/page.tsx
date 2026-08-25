'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

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
  const { user, children, loading, signup, login, createChild } = useAuth();

  const [step, setStep] = useState<'form' | 'existing-account' | 'select-child'>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordMatch, setPasswordMatch] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingChildren, setExistingChildren] = useState<any[]>([]);
  const [guestResult, setGuestResult] = useState<any>(null);
  const [fromQuicktest, setFromQuicktest] = useState(false);

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
    const from = searchParams.get('from') === 'quicktest';
    setFromQuicktest(from);
    if (from) {
      const savedId = localStorage.getItem('src_guest_session_id');
      if (savedId) setGuestSessionId(savedId);
      const savedResult = localStorage.getItem('src_quick_test_results_v2');
      if (savedResult) {
        try {
          const parsed = JSON.parse(savedResult);
          setGuestResult(parsed);
        } catch (_) {
          // ignore
        }
      }
    }
  }, [searchParams]);

  // 如果已登录且有孩子，直接跳 hub
  useEffect(() => {
    if (!loading && user && children.length > 0) {
      router.push('/hub');
    }
  }, [user, children, loading, router]);

  // 实时检查两次密码是否一致
  useEffect(() => {
    if (confirmPassword === '') {
      setPasswordMatch(true);
      return;
    }
    setPasswordMatch(password === confirmPassword);
  }, [password, confirmPassword]);

  // 年龄自动对应年级
  useEffect(() => {
    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum)) return;
    if (ageNum === 5) setGrade('Kindergarten');
    else if (ageNum >= 6 && ageNum <= 17) setGrade(`Grade ${ageNum - 5}`);
  }, [age]);

  // ==================== 注册提交 ====================
  const handleSignup = async () => {
    setError('');

    // 基础校验
    if (!email.trim()) { setError('请输入邮箱地址'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('请输入有效的邮箱地址'); return; }
    if (!password) { setError('请设置密码'); return; }
    if (password.length < 8) { setError('密码至少需要8位'); return; }
    if (!passwordMatch) { setError('两次输入的密码不一致'); return; }
    if (!nickname.trim()) { setError('请输入孩子昵称'); return; }

    setIsSubmitting(true);
    try {
      const result = await signup({
        email: email.trim(),
        password,
        nickname: nickname.trim(),
        age: parseInt(age, 10),
        grade,
        country,
        home_language: homeLanguage || undefined,
        home_language_other: homeLanguage === 'other' ? homeLanguageOther : undefined,
        guest_session_id: guestSessionId || undefined,
      });

      if (!result.success) {
        // 如果是邮箱已存在，跳转到已有账户页面
        if (result.error?.includes('已经注册')) {
          setStep('existing-account');
          setIsSubmitting(false);
          return;
        }
        setError(result.error || '注册失败');
        setIsSubmitting(false);
        return;
      }

      // 成功 → 跳转到 hub
      router.push('/hub');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==================== 已有账户→登录 ====================
  const handleExistingAccountLogin = async () => {
    setError('');
    if (!password) { setError('请输入密码'); return; }

    setIsSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      if (!result.success) {
        setError(result.error || '登录失败');
        setIsSubmitting(false);
        return;
      }

      const kids = result.children || [];
      if (kids.length === 0) {
        // 没有孩子，直接创建一个
        const childData = {
          nickname: nickname.trim(),
          age: parseInt(age, 10),
          grade,
          country,
          home_language: homeLanguage || undefined,
          home_language_other: homeLanguage === 'other' ? homeLanguageOther : undefined,
          guest_session_id: guestSessionId || undefined,
        };
        const childResult = await createChild(childData);
        if (!childResult.success) {
          setError(childResult.error || '创建孩子档案失败');
          setIsSubmitting(false);
          return;
        }
        router.push('/hub');
        return;
      }

      if (kids.length === 1 && !fromQuicktest) {
        // 只有一个孩子且非游客测试→直接进
        router.push('/hub');
        return;
      }

      // 多个孩子 或 有游客测试需要选择→显示选择
      setExistingChildren(kids);
      setStep('select-child');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==================== 选择已有孩子 ====================
  const handleSelectChild = async (childId: string) => {
    if (!fromQuicktest || !guestSessionId) {
      router.push('/hub');
      return;
    }
    try {
      setIsSubmitting(true);
      const res = await fetch('/api/quick-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_id: childId,
          guest_session_id: guestSessionId,
          ...guestResult,
        }),
      });
      if (!res.ok) throw new Error('绑定失败');
      router.push('/hub');
    } catch (err: any) {
      setError(err.message || '绑定失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==================== 添加新孩子 ====================
  const handleAddNewChild = async () => {
    try {
      setIsSubmitting(true);
      const childResult = await createChild({
        nickname: nickname.trim(),
        age: parseInt(age, 10),
        grade,
        country,
        home_language: homeLanguage || undefined,
        home_language_other: homeLanguage === 'other' ? homeLanguageOther : undefined,
        guest_session_id: guestSessionId || undefined,
      });
      if (!childResult.success) {
        setError(childResult.error || '创建孩子档案失败');
        return;
      }
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
            {fromQuicktest ? '保存孩子的中文成长' : '创建孩子的中文成长档案'}
          </h1>
          <p className="text-gray-600">
            {fromQuicktest ? '保存刚才的测试结果，开启孩子的中文成长地图' : '保存孩子的中文成长记录，开启专属中文成长地图'}
          </p>
        </div>

        {/* 表单卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
          {step === 'form' && (
            <SignupForm
              email={email} setEmail={setEmail}
              password={password} setPassword={setPassword}
              confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
              showPassword={showPassword} setShowPassword={setShowPassword}
              showConfirmPassword={showConfirmPassword} setShowConfirmPassword={setShowConfirmPassword}
              passwordMatch={passwordMatch}
              nickname={nickname} setNickname={setNickname}
              age={age} setAge={setAge}
              grade={grade} setGrade={setGrade}
              country={country} setCountry={setCountry}
              homeLanguage={homeLanguage} setHomeLanguage={setHomeLanguage}
              homeLanguageOther={homeLanguageOther} setHomeLanguageOther={setHomeLanguageOther}
              error={error}
              isSubmitting={isSubmitting}
              onSubmit={handleSignup}
              fromQuicktest={fromQuicktest}
            />
          )}

          {step === 'existing-account' && (
            <ExistingAccountStep
              email={email}
              password={password} setPassword={setPassword}
              showPassword={showPassword} setShowPassword={setShowPassword}
              error={error}
              isSubmitting={isSubmitting}
              onBack={() => { setStep('form'); setError(''); }}
              onLogin={handleExistingAccountLogin}
            />
          )}

          {step === 'select-child' && (
            <SelectChildStep
              childList={existingChildren}
              guestResult={guestResult}
              isSubmitting={isSubmitting}
              error={error}
              onSelect={handleSelectChild}
              onAddNew={handleAddNewChild}
              onBack={() => setStep('existing-account')}
            />
          )}
        </div>

        {/* 底部说明 */}
        <div className="text-center mt-6 space-y-2">
          <p className="text-sm text-gray-500">
            我们重视您的隐私。仅用于孩子中文成长相关通知。
          </p>
          <p className="text-sm text-gray-600">
            已有账户？<button onClick={() => router.push('/login')} className="text-[var(--color-src-primary)] font-medium hover:underline">直接登录</button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ==================== 注册表单 ====================
function SignupForm(props: {
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  confirmPassword: string; setConfirmPassword: (v: string) => void;
  showPassword: boolean; setShowPassword: (v: boolean) => void;
  showConfirmPassword: boolean; setShowConfirmPassword: (v: boolean) => void;
  passwordMatch: boolean;
  nickname: string; setNickname: (v: string) => void;
  age: string; setAge: (v: string) => void;
  grade: string; setGrade: (v: string) => void;
  country: string; setCountry: (v: string) => void;
  homeLanguage: string; setHomeLanguage: (v: string) => void;
  homeLanguageOther: string; setHomeLanguageOther: (v: string) => void;
  error: string;
  isSubmitting: boolean;
  onSubmit: () => void;
  fromQuicktest: boolean;
}) {
  const {
    email, setEmail, password, setPassword,
    confirmPassword, setConfirmPassword,
    showPassword, setShowPassword,
    showConfirmPassword, setShowConfirmPassword,
    passwordMatch,
    nickname, setNickname, age, setAge, grade, setGrade,
    country, setCountry,
    homeLanguage, setHomeLanguage,
    homeLanguageOther, setHomeLanguageOther,
    error, isSubmitting, onSubmit,
  } = props;

  return (
    <div className="space-y-4">
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

      {/* 密码 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          设置密码 <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少8位"
            className="w-full px-4 py-3 pr-12 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          >
            {showPassword ? '隐藏' : '显示'}
          </button>
        </div>
        {password && password.length < 8 && (
          <p className="text-xs text-orange-500 mt-1">密码至少需要8位</p>
        )}
      </div>

      {/* 确认密码 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          确认密码 <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次输入密码"
            className={`w-full px-4 py-3 pr-12 border-2 rounded-xl focus:outline-none transition-colors ${
              !passwordMatch ? 'border-red-400' : 'border-gray-200 focus:border-orange-400'
            }`}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          >
            {showConfirmPassword ? '隐藏' : '显示'}
          </button>
        </div>
        {!passwordMatch && confirmPassword && (
          <p className="text-xs text-red-500 mt-1">两次输入的密码不一致</p>
        )}
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

      {/* 语言环境 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          语言环境 <span className="text-gray-400 font-normal">（选填）</span>
        </label>
        <select
          value={homeLanguage}
          onChange={(e) => setHomeLanguage(e.target.value)}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors bg-white"
        >
          <option value="">请选择</option>
          {LANGUAGE_OPTIONS.map(l => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
        {homeLanguage === 'other' && (
          <input
            type="text"
            value={homeLanguageOther}
            onChange={(e) => setHomeLanguageOther(e.target.value)}
            placeholder="请填写其他语言（选填）"
            className="w-full mt-2 px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors text-sm"
          />
        )}
      </div>

      {/* 提交按钮 */}
      <button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="w-full py-3.5 bg-[var(--color-src-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed mt-2"
      >
        {isSubmitting ? '创建中...' : '创建账户'}
      </button>
    </div>
  );
}

// ==================== 已有账户步骤 ====================
function ExistingAccountStep(props: {
  email: string;
  password: string; setPassword: (v: string) => void;
  showPassword: boolean; setShowPassword: (v: boolean) => void;
  error: string;
  isSubmitting: boolean;
  onBack: () => void;
  onLogin: () => void;
}) {
  const { email, password, setPassword, showPassword, setShowPassword, error, isSubmitting, onBack, onLogin } = props;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="text-5xl mb-3">📧</div>
        <h2 className="text-xl font-bold text-gray-800">这个邮箱已经注册</h2>
        <p className="text-gray-500 text-sm mt-1">
          {email}
        </p>
        <p className="text-gray-500 text-sm mt-1">
          请输入密码登录后保存本次测试结果
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

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
            onKeyDown={(e) => e.key === 'Enter' && onLogin()}
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

      <button
        onClick={onLogin}
        disabled={isSubmitting}
        className="w-full py-3.5 bg-[var(--color-src-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? '登录中...' : '登录并保存'}
      </button>

      <div className="text-center space-y-2">
        <p className="text-sm text-gray-500">
          <button className="text-[var(--color-src-primary)] hover:underline">
            忘记密码？
          </button>
        </p>
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          ← 返回注册
        </button>
      </div>
    </div>
  );
}

// ==================== 选择孩子步骤 ====================
function SelectChildStep(props: {
  childList: any[];
  guestResult: any;
  isSubmitting: boolean;
  error: string;
  onSelect: (childId: string) => void;
  onAddNew: () => void;
  onBack: () => void;
}) {
  const { childList, guestResult, isSubmitting, error, onSelect, onAddNew, onBack } = props;

  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <div className="text-5xl mb-3">👨‍👩‍👧‍👦</div>
        <h2 className="text-2xl font-bold text-gray-800">选择孩子</h2>
        <p className="text-gray-500 text-sm mt-1">
          {guestResult ? '选择要保存本次测试结果的孩子' : '选择要进入的孩子'}
        </p>
      </div>

      <div className="space-y-3">
        {childList.map((child) => (
          <button
            key={child.id}
            onClick={() => onSelect(child.id)}
            disabled={isSubmitting}
            className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl text-left hover:border-orange-400 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center text-2xl">
                {child.nickname?.[0] || '👧'}
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-800">{child.nickname}</div>
                <div className="text-xs text-gray-500">
                  {child.age}岁 · {child.grade}
                </div>
              </div>
              <div className="text-orange-500 text-xl">→</div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={onAddNew}
        disabled={isSubmitting}
        className="w-full p-3 border-2 border-dashed border-gray-300 rounded-2xl text-gray-500 hover:border-orange-400 hover:text-orange-600 transition-all text-sm"
      >
        ＋ 添加新孩子
      </button>

      {error && (
        <p className="text-red-500 text-sm text-center">{error}</p>
      )}

      <button
        onClick={onBack}
        className="w-full text-center text-gray-400 text-sm hover:text-gray-600"
      >
        返回
      </button>
    </div>
  );
}
