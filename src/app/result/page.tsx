'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { TestResult } from '@/lib/types';
import { getReadingStars, getStrength, getWeakness, getRecommendation } from '@/lib/scoring';

export default function ResultPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadResult() {
      if (!sessionId) return;
      try {
        const res = await fetch(`/api/results?session_id=${sessionId}`);
        const { data, error } = await res.json();
        if (error) throw new Error(error);
        setResult(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadResult();
  }, [sessionId]);

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

  const partScores = [
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
            测试完成！
          </h1>
          <p className="text-[var(--color-src-text-light)]">太棒了，继续加油！</p>
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
            <span>完成时间：{minutes}分{seconds}秒</span>
            <span>综合得分：{result.total_score}分</span>
          </div>
        </div>

        {/* Part scores */}
        <div className="card-game mb-4 animate-bounce-in" style={{ animationDelay: '0.5s' }}>
          <div className="text-sm font-medium text-[var(--color-src-text)] mb-4">各项得分</div>
          <div className="space-y-4">
            {partScores.map((part) => (
              <div key={part.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{part.icon} {part.name}</span>
                  <span className="font-bold">{part.score}分</span>
                </div>
                <div className="progress-bar-game">
                  <div style={{ width: `${part.score}%`, background: part.color }} />
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
          <Link href={`/report?childId=${result.child_id}`} className="block">
            <button className="btn-game bg-[var(--color-src-primary)] text-white w-full">
              📋 查看成长报告
            </button>
          </Link>
          <Link href={`/history?childId=${result.child_id}`} className="block">
            <button className="btn-game bg-[var(--color-src-secondary)] text-white w-full">
              📊 查看成长曲线
            </button>
          </Link>
          <Link href="/" className="block">
            <button className="btn-game bg-[var(--color-src-text-light)]/10 text-[var(--color-src-text)] w-full">
              🏠 返回首页
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
