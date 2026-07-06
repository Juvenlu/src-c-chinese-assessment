'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { TestResult, Child } from '@/lib/types';
import { getStrength, getWeakness, getRecommendation, getReadingStars } from '@/lib/scoring';

function ReportContent() {
  const searchParams = useSearchParams();
  const childId = searchParams.get('childId');
  const [results, setResults] = useState<TestResult[]>([]);
  const [child, setChild] = useState<Child | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!childId) return;
      try {
        // Load child info
        const childRes = await fetch(`/api/children`);
        const { data: children } = await childRes.json();
        const found = (children || []).find((c: Child) => c.id === childId);
        setChild(found || null);

        // Load results
        const res = await fetch(`/api/results?child_id=${childId}`);
        const { data, error } = await res.json();
        if (error) throw new Error(error);
        setResults(data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [childId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">📋</div>
          <p className="font-display text-xl text-[var(--color-src-text)]">正在生成报告...</p>
        </div>
      </div>
    );
  }

  const latest = results[0]; // Most recent result

  if (!latest) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)] px-4">
        <div className="card-game text-center p-8">
          <div className="text-5xl mb-4">📝</div>
          <p className="font-display text-xl text-[var(--color-src-text)] mb-4">暂无测试记录</p>
          <Link href="/profile">
            <button className="btn-game bg-[var(--color-src-primary)] text-white">
              开始第一次测试
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const strength = getStrength({
    characterScore: latest.character_score,
    vocabScore: latest.vocab_score,
    readingScore: latest.reading_score,
    comprehensionScore: latest.comprehension_score,
  });
  const weakness = getWeakness({
    characterScore: latest.character_score,
    vocabScore: latest.vocab_score,
    readingScore: latest.reading_score,
    comprehensionScore: latest.comprehension_score,
  });
  const recommendation = getRecommendation(latest.level, latest.total_score);
  const stars = getReadingStars(latest.total_score);

  return (
    <div className="min-h-screen flex flex-col items-center bg-[var(--color-src-bg)] px-4 py-8">
      <div className="w-full max-w-md">
        {/* Report header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto bg-[var(--color-src-accent)] rounded-full flex items-center justify-center mb-3 shadow-md">
            <span className="text-3xl">📋</span>
          </div>
          <h1 className="font-display text-3xl text-[var(--color-src-text)] mb-1">
            家长成长报告
          </h1>
          <p className="text-[var(--color-src-text-light)]">
            {child?.name || '小朋友'}的中文学习进度
          </p>
        </div>

        {/* Current Level */}
        <div className="card-game mb-4">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-[var(--color-src-text-light)]">当前等级</div>
              <div className="font-display text-3xl text-[var(--color-src-primary)]">{latest.level}</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-[var(--color-src-text-light)]">综合得分</div>
              <div className="font-display text-3xl text-[var(--color-src-secondary)]">{latest.total_score}分</div>
            </div>
          </div>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="card-game text-center p-4">
            <div className="text-xs text-[var(--color-src-text-light)] mb-1">稳定识字量</div>
            <div className="font-display text-2xl text-[var(--color-src-primary)]">{latest.stable_char_count}字</div>
          </div>
          <div className="card-game text-center p-4">
            <div className="text-xs text-[var(--color-src-text-light)] mb-1">稳定词汇量</div>
            <div className="font-display text-2xl text-[var(--color-src-secondary)]">{latest.stable_vocab_count}词</div>
          </div>
        </div>

        {/* Mastery rates */}
        <div className="card-game mb-4">
          <div className="text-sm font-medium text-[var(--color-src-text)] mb-4">掌握率分析</div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>识字掌握率</span>
                <span className="font-bold text-[var(--color-src-primary)]">{latest.character_mastery_rate}%</span>
              </div>
              <div className="progress-bar-game">
                <div style={{ width: `${latest.character_mastery_rate}%`, background: 'var(--color-src-primary)' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>词汇掌握率</span>
                <span className="font-bold text-[var(--color-src-secondary)]">{latest.vocab_mastery_rate}%</span>
              </div>
              <div className="progress-bar-game">
                <div style={{ width: `${latest.vocab_mastery_rate}%`, background: 'var(--color-src-secondary)' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>阅读理解率</span>
                <span className="font-bold text-[var(--color-src-accent)]">{latest.reading_comprehension_rate}%</span>
              </div>
              <div className="progress-bar-game">
                <div style={{ width: `${latest.reading_comprehension_rate}%`, background: 'var(--color-src-accent)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Reading ability */}
        <div className="card-game text-center mb-4">
          <div className="text-sm text-[var(--color-src-text-light)] mb-2">阅读能力等级</div>
          <div className="flex justify-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <span key={s} className={`text-3xl ${s <= stars ? '' : 'opacity-20'}`}>
                ⭐
              </span>
            ))}
          </div>
        </div>

        {/* Strengths and weaknesses */}
        <div className="card-game mb-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3 bg-[var(--color-src-success)]/10 rounded-xl p-4">
              <span className="text-2xl">💪</span>
              <div>
                <div className="text-sm font-medium text-[var(--color-src-text)]">优势能力</div>
                <div className="text-sm text-[var(--color-src-text-light)]">{strength}较强</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-[var(--color-src-accent)]/20 rounded-xl p-4">
              <span className="text-2xl">📈</span>
              <div>
                <div className="text-sm font-medium text-[var(--color-src-text)]">待提升能力</div>
                <div className="text-sm text-[var(--color-src-text-light)]">{weakness}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-[var(--color-src-secondary)]/10 rounded-xl p-4">
              <span className="text-2xl">🎯</span>
              <div>
                <div className="text-sm font-medium text-[var(--color-src-text)]">推荐学习方向</div>
                <div className="text-sm text-[var(--color-src-text-light)]">{recommendation}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Test history summary */}
        {results.length > 1 && (
          <div className="card-game mb-6">
            <div className="text-sm font-medium text-[var(--color-src-text)] mb-3">历史测试记录</div>
            <div className="space-y-2">
              {results.slice(0, 5).map((r, idx) => (
                <div key={r.id} className="flex justify-between text-sm py-2 border-b border-[var(--color-src-text-light)]/10 last:border-0">
                  <span className="text-[var(--color-src-text-light)]">
                    {new Date(r.created_at).toLocaleDateString('zh-CN')}
                  </span>
                  <span className="text-[var(--color-src-text)]">{r.level}</span>
                  <span className="font-bold text-[var(--color-src-primary)]">{r.stable_char_count}字</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <Link href={`/history?childId=${childId}`} className="block">
            <button className="btn-game bg-[var(--color-src-secondary)] text-white w-full">
              📊 查看成长曲线
            </button>
          </Link>
          <Link href="/profile" className="block">
            <button className="btn-game bg-[var(--color-src-primary)] text-white w-full">
              🔄 再测一次
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

export default function ReportPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-2xl">加载中...</div>
      </div>
    }>
      <ReportContent />
    </Suspense>
  );
}
