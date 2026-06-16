'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { TestResult, Level, LEVEL_CONFIG } from '@/lib/types';
import { getReadingStars, getStrength, getWeakness, getRecommendation } from '@/lib/scoring';

function ResultContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const mode = searchParams.get('mode') || 'sampling';
  const fallbackLevel = (searchParams.get('level') || 'SRC300') as Level;
  const fallbackCharCount = parseInt(searchParams.get('charCount') || '0');
  const fallbackVocabCount = parseInt(searchParams.get('vocabCount') || '0');
  const fallbackScore = parseInt(searchParams.get('score') || '0');
  const fallbackCharMastery = parseInt(searchParams.get('charMastery') || '0');
  const fallbackVocabMastery = parseInt(searchParams.get('vocabMastery') || '0');

  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadResult() {
      // For full test mode, always use URL params directly (most accurate)
      if (mode === 'full' && fallbackCharCount > 0) {
        const charMastery = fallbackCharMastery > 0 ? fallbackCharMastery / 100 : 0;
        const vocabMastery = fallbackVocabMastery > 0 ? fallbackVocabMastery / 100 : 0;
        setResult({
          id: '',
          session_id: sessionId || '',
          child_id: '',
          level: fallbackLevel,
          character_score: fallbackCharMastery || fallbackScore,
          vocab_score: fallbackVocabMastery || fallbackScore,
          reading_score: fallbackScore,
          comprehension_score: fallbackScore,
          total_score: fallbackScore,
          stable_char_count: fallbackCharCount,
          stable_vocab_count: fallbackVocabCount,
          character_mastery_rate: charMastery,
          vocab_mastery_rate: vocabMastery,
          reading_comprehension_rate: (charMastery + vocabMastery) / 2,
          completion_time_seconds: 0,
          created_at: new Date().toISOString(),
        });
        setLoading(false);
        return;
      }

      if (sessionId) {
        try {
          const res = await fetch(`/api/results?session_id=${sessionId}`);
          const { data, error } = await res.json();
          if (!error && data) {
            setResult(data);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.error(err);
        }
      }
      // Fallback for sampling mode without session
      if (fallbackScore > 0) {
        setResult({
          id: '',
          session_id: sessionId || '',
          child_id: '',
          level: fallbackLevel,
          character_score: fallbackScore,
          vocab_score: fallbackScore,
          reading_score: fallbackScore,
          comprehension_score: fallbackScore,
          total_score: fallbackScore,
          stable_char_count: fallbackCharCount,
          stable_vocab_count: fallbackVocabCount,
          character_mastery_rate: fallbackScore / 100,
          vocab_mastery_rate: fallbackScore / 100,
          reading_comprehension_rate: fallbackScore / 100,
          completion_time_seconds: 0,
          created_at: new Date().toISOString(),
        });
      }
      setLoading(false);
    }
    loadResult();
  }, [sessionId, mode, fallbackLevel, fallbackCharCount, fallbackVocabCount, fallbackScore]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🐵</div>
          <p className="font-display text-xl text-[var(--color-src-text)]">正在计算结果...</p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="card-game text-center p-8">
          <div className="text-5xl mb-4">😕</div>
          <p className="font-display text-xl text-[var(--color-src-text)]">结果未找到</p>
        </div>
      </div>
    );
  }

  const stars = getReadingStars(result.total_score);
  const strength = getStrength({
    characterScore: result.character_score,
    vocabScore: result.vocab_score,
    readingScore: result.reading_score,
    comprehensionScore: result.comprehension_score,
  });
  const weakness = getWeakness({
    characterScore: result.character_score,
    vocabScore: result.vocab_score,
    readingScore: result.reading_score,
    comprehensionScore: result.comprehension_score,
  });
  const recommendation = getRecommendation(result.level, result.total_score);
  const minutes = Math.floor(result.completion_time_seconds / 60);
  const seconds = result.completion_time_seconds % 60;

  const isFullMode = mode === 'full';

  const partScores = isFullMode
    ? [
        { name: '识字掌握', score: Math.round(result.character_mastery_rate * 100), icon: '👁️', color: 'var(--color-src-primary)' },
        { name: '词汇掌握', score: Math.round(result.vocab_mastery_rate * 100), icon: '📖', color: 'var(--color-src-secondary)' },
      ]
    : [
        { name: '识字得分', score: result.character_score, icon: '👁️', color: 'var(--color-src-primary)' },
        { name: '词汇得分', score: result.vocab_score, icon: '📖', color: 'var(--color-src-secondary)' },
        { name: '阅读得分', score: result.reading_score, icon: '💬', color: 'var(--color-src-accent)' },
        { name: '理解得分', score: result.comprehension_score, icon: '💡', color: 'var(--color-src-success)' },
      ];

  return (
    <div className="min-h-screen flex flex-col items-center bg-[var(--color-src-bg)] px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header celebration */}
        <div className="text-center mb-8 animate-bounce-in">
          <div className="text-7xl mb-4">🎊</div>
          <h1 className="font-display text-3xl text-[var(--color-src-text)] mb-2">
            {isFullMode ? '逐字测试完成！' : '测试完成！'}
          </h1>
          <p className="text-[var(--color-src-text-light)]">太棒了，继续加油！</p>
        </div>

        {/* Mode badge */}
        <div className="text-center mb-4">
          <div className="inline-flex items-center gap-2 bg-white/80 px-4 py-2 rounded-full shadow-sm">
            <span>{isFullMode ? '📝' : '🎮'}</span>
            <span className="text-sm font-medium text-[var(--color-src-text)]">
              {isFullMode ? '逐字测试' : '抽测闯关'}
            </span>
          </div>
        </div>

        {/* Level badge */}
        <div className="card-game text-center mb-4 animate-bounce-in" style={{ animationDelay: '0.1s' }}>
          <div className="inline-block bg-[var(--color-src-primary)]/10 px-6 py-2 rounded-full mb-3">
            <span className="font-display text-xl text-[var(--color-src-primary)]">{result.level}</span>
          </div>
        </div>

        {/* Big numbers */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="card-game text-center animate-bounce-in" style={{ animationDelay: '0.2s' }}>
            <div className="text-sm text-[var(--color-src-text-light)] mb-1">稳定识字量</div>
            <div className="font-display text-4xl text-[var(--color-src-primary)]">{result.stable_char_count}</div>
            <div className="text-sm text-[var(--color-src-text-light)]">字</div>
          </div>
          <div className="card-game text-center animate-bounce-in" style={{ animationDelay: '0.3s' }}>
            <div className="text-sm text-[var(--color-src-text-light)] mb-1">稳定词汇量</div>
            <div className="font-display text-4xl text-[var(--color-src-secondary)]">{result.stable_vocab_count}</div>
            <div className="text-sm text-[var(--color-src-text-light)]">词</div>
          </div>
        </div>

        {/* Reading ability stars */}
        <div className="card-game text-center mb-4 animate-bounce-in" style={{ animationDelay: '0.4s' }}>
          <div className="text-sm text-[var(--color-src-text-light)] mb-2">阅读能力</div>
          <div className="flex justify-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <span key={s} className={`text-3xl ${s <= stars ? 'animate-star-spin' : 'opacity-20'}`} style={{ animationDelay: `${0.4 + s * 0.1}s` }}>
                ⭐
              </span>
            ))}
          </div>
          <div className="flex justify-between text-sm text-[var(--color-src-text-light)]">
            {result.completion_time_seconds > 0 && (
              <span>完成时间：{minutes}分{seconds}秒</span>
            )}
            <span>综合得分：{result.total_score}分</span>
          </div>
        </div>

        {/* Part scores */}
        <div className="card-game mb-4 animate-bounce-in" style={{ animationDelay: '0.5s' }}>
          <div className="text-sm font-medium text-[var(--color-src-text)] mb-4">
            {isFullMode ? '掌握情况' : '各项得分'}
          </div>
          <div className="space-y-4">
            {partScores.map((part) => (
              <div key={part.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{part.icon} {part.name}</span>
                  <span className="font-bold">{part.score}{isFullMode ? '%' : '分'}</span>
                </div>
                <div className="progress-bar-game">
                  <div style={{ width: `${Math.min(part.score, 100)}%`, background: part.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Analysis */}
        <div className="card-game mb-6 animate-bounce-in" style={{ animationDelay: '0.6s' }}>
          <div className="text-sm font-medium text-[var(--color-src-text)] mb-4">能力分析</div>
          <div className="space-y-3">
            <div className="flex items-center gap-3 bg-[var(--color-src-success)]/10 rounded-xl p-3">
              <span className="text-2xl">💪</span>
              <div>
                <div className="text-sm font-medium text-[var(--color-src-text)]">优势能力</div>
                <div className="text-sm text-[var(--color-src-text-light)]">{strength}较强</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-[var(--color-src-accent)]/20 rounded-xl p-3">
              <span className="text-2xl">📈</span>
              <div>
                <div className="text-sm font-medium text-[var(--color-src-text)]">待提升能力</div>
                <div className="text-sm text-[var(--color-src-text-light)]">{weakness}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-[var(--color-src-secondary)]/10 rounded-xl p-3">
              <span className="text-2xl">🎯</span>
              <div>
                <div className="text-sm font-medium text-[var(--color-src-text)]">推荐学习方向</div>
                <div className="text-sm text-[var(--color-src-text-light)]">{recommendation}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3 animate-bounce-in" style={{ animationDelay: '0.7s' }}>
          {result.child_id && (
            <>
              <Link href={`/report?childId=${result.child_id}`} className="block">
                <button
                  className="w-full rounded-2xl px-8 py-4 font-display text-lg font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg"
                  style={{ backgroundColor: 'var(--color-src-primary)' }}
                >
                  📋 查看成长报告
                </button>
              </Link>
              <Link href={`/history?childId=${result.child_id}`} className="block">
                <button
                  className="w-full rounded-2xl px-8 py-4 font-display text-lg font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg"
                  style={{ backgroundColor: 'var(--color-src-secondary)' }}
                >
                  📊 查看成长曲线
                </button>
              </Link>
            </>
          )}
          <Link href="/" className="block">
            <button
              className="w-full rounded-2xl px-8 py-4 font-display text-lg font-bold transition-all duration-200 active:scale-95 hover:scale-105"
              style={{ backgroundColor: 'rgba(99,110,114,0.15)', color: 'var(--color-src-text)' }}
            >
              🏠 返回首页
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-5xl animate-bounce">🐵</div>
      </div>
    }>
      <ResultContent />
    </Suspense>
  );
}
