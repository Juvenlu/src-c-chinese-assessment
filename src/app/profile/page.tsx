'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LanguageEnv, LANGUAGE_ENV_LABELS, Level, LEVEL_CONFIG, TestMode } from '@/lib/types';

function ProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = (searchParams.get('mode') || 'sampling') as TestMode;

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [grade, setGrade] = useState('');
  const [country, setCountry] = useState('');
  const [languageEnv, setLanguageEnv] = useState<LanguageEnv>('bilingual');
  const [level, setLevel] = useState<Level>('SRC300');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  const modeLabel = mode === 'full' ? '逐字测试' : '抽测闯关';
  const modeIcon = mode === 'full' ? '📝' : '🎮';

  const handleCreateChild = async () => {
    if (!name || !age || !grade || !country) return;
    setLoading(true);
    try {
      const res = await fetch('/api/children', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          age: parseInt(age),
          grade,
          country,
          language_env: languageEnv,
        }),
      });
      const { data, error } = await res.json();
      if (error) throw new Error(error);

      if (mode === 'full') {
        // 逐字测试 - 不需要创建 session，直接跳转逐字测试页面
        const params = new URLSearchParams({
          childId: data.id,
          childName: name,
          level,
        });
        router.push(`/fulltest?${params.toString()}`);
      } else {
        // 抽测闯关 - 创建 session
        const sessionRes = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            child_id: data.id,
            level,
          }),
        });
        const { data: sessionData, error: sessionError } = await sessionRes.json();
        if (sessionError) throw new Error(sessionError);

        // Seed questions if needed
        await fetch('/api/seed', { method: 'POST' });

        router.push(`/test?sessionId=${sessionData.id}&level=${level}`);
      }
    } catch (err) {
      console.error(err);
      alert('创建失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // Both modes need level selection
  const totalSteps = 2;
  const handleNext = () => {
    setStep(2);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-[var(--color-src-bg)]">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto bg-[var(--color-src-accent)] rounded-full flex items-center justify-center mb-4 shadow-md">
            <span className="text-4xl">{modeIcon}</span>
          </div>
          <h1 className="font-display text-3xl text-[var(--color-src-text)] mb-1">
            {step === 1 ? '介绍一下自己吧' : '选择测试等级'}
          </h1>
          <p className="text-[var(--color-src-text-light)]">
            {step === 1
              ? `当前模式：${modeLabel}`
              : '根据你的水平选择合适的等级'}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-colors ${
                step === i + 1 ? 'bg-[var(--color-src-primary)]' : 'bg-[var(--color-src-primary)]/30'
              }`}
            />
          ))}
        </div>

        {step === 1 ? (
          <div className="card-game space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                👋 你的名字
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入名字"
                className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
              />
            </div>

            {/* Age */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                🎂 年龄
              </label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="5-14"
                min={5}
                max={14}
                className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
              />
            </div>

            {/* Grade */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                📚 年级
              </label>
              <input
                type="text"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="例如：3年级"
                className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
              />
            </div>

            {/* Country */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                🌍 所在国家
              </label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="例如：美国"
                className="w-full px-4 py-3 rounded-xl border-2 border-[var(--color-src-primary)]/20 focus:border-[var(--color-src-primary)] focus:outline-none text-lg bg-white"
              />
            </div>

            {/* Language Environment */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-src-text)] mb-2">
                🗣️ 语言环境
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(LANGUAGE_ENV_LABELS) as [LanguageEnv, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setLanguageEnv(key)}
                    className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                      languageEnv === key
                        ? 'bg-[var(--color-src-primary)] text-white shadow-md'
                        : 'bg-white border-2 border-[var(--color-src-primary)]/20 text-[var(--color-src-text)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Next/Start button */}
            <div className="pt-2">
              <button
                onClick={handleNext}
                disabled={!name || !age || !grade || !country || loading}
                className="w-full rounded-2xl px-8 py-4 font-display text-xl font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{ backgroundColor: 'var(--color-src-primary)' }}
              >
                {loading
                  ? '准备中...'
                  : mode === 'full'
                    ? '开始逐字测试 📝'
                    : '下一步 →'}
              </button>
              {(!name || !age || !grade || !country) && (
                <p className="text-center text-sm text-[var(--color-src-text-light)] mt-2">
                  请填写以上所有信息后继续
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="card-game space-y-5">
            <p className="text-[var(--color-src-text-light)] text-center mb-4">
              选择一个适合你的测试等级
            </p>

            {(Object.entries(LEVEL_CONFIG) as [Level, typeof LEVEL_CONFIG[Level]][]).map(([lvl, config]) => (
              <button
                key={lvl}
                onClick={() => setLevel(lvl)}
                className={`w-full p-5 rounded-2xl text-left transition-all ${
                  level === lvl
                    ? 'bg-[var(--color-src-primary)] text-white shadow-lg scale-105'
                    : 'bg-white border-2 border-[var(--color-src-primary)]/20 text-[var(--color-src-text)] hover:border-[var(--color-src-primary)]/50'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-display text-2xl">{lvl}</div>
                    <div className={`text-sm ${level === lvl ? 'text-white/80' : 'text-[var(--color-src-text-light)]'}`}>
                      测试时间：{Math.floor(config.timeLimitSeconds / 60)}分钟 · 题库{config.charCount}字
                    </div>
                  </div>
                  {level === lvl && (
                    <span className="text-2xl animate-star-spin">⭐</span>
                  )}
                </div>
              </button>
            ))}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep(1)}
                className="flex-1 rounded-2xl px-6 py-4 font-display text-lg font-bold transition-all duration-200 active:scale-95 hover:scale-105"
                style={{ backgroundColor: 'rgba(99,110,114,0.15)', color: 'var(--color-src-text)' }}
              >
                ← 返回
              </button>
              <button
                onClick={handleCreateChild}
                disabled={loading}
                className="flex-[2] rounded-2xl px-8 py-4 font-display text-xl font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--color-src-primary)' }}
              >
                {loading ? '准备中...' : '开始测试 🚀'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-2xl animate-bounce">🐵</div>
      </div>
    }>
      <ProfileContent />
    </Suspense>
  );
}

import { Suspense } from 'react';
