'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { TestResult, Child } from '@/lib/types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

function HistoryContent() {
  const searchParams = useSearchParams();
  const childId = searchParams.get('childId');
  const [results, setResults] = useState<TestResult[]>([]);
  const [child, setChild] = useState<Child | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!childId) return;
      try {
        const childRes = await fetch(`/api/children`);
        const { data: children } = await childRes.json();
        const found = (children || []).find((c: Child) => c.id === childId);
        setChild(found || null);

        const res = await fetch(`/api/results?child_id=${childId}`);
        const { data, error } = await res.json();
        if (error) throw new Error(error);
        // Sort by date ascending for chart
        const sorted = [...(data || [])].sort((a: TestResult, b: TestResult) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        setResults(sorted);
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
          <div className="text-5xl mb-4 animate-bounce">📊</div>
          <p className="font-display text-xl text-[var(--color-src-text)]">加载成长数据...</p>
        </div>
      </div>
    );
  }

  const chartData = results.map((r) => ({
    date: new Date(r.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
    识字量: r.stable_char_count,
    词汇量: r.stable_vocab_count,
    综合得分: r.total_score,
    等级: r.level,
  }));

  return (
    <div className="min-h-screen flex flex-col items-center bg-[var(--color-src-bg)] px-4 py-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto bg-[var(--color-src-secondary)] rounded-full flex items-center justify-center mb-3 shadow-md">
            <span className="text-3xl">📊</span>
          </div>
          <h1 className="font-display text-3xl text-[var(--color-src-text)] mb-1">
            成长曲线
          </h1>
          <p className="text-[var(--color-src-text-light)]">
            {child?.name || '小朋友'}的中文学习轨迹
          </p>
        </div>

        {results.length === 0 ? (
          <div className="card-game text-center p-8">
            <div className="text-5xl mb-4">📝</div>
            <p className="font-display text-xl text-[var(--color-src-text)] mb-4">暂无测试记录</p>
            <Link href="/profile">
              <button className="btn-game bg-[var(--color-src-primary)] text-white">
                开始第一次测试
              </button>
            </Link>
          </div>
        ) : (
          <>
            {/* Character count chart */}
            <div className="card-game mb-4">
              <div className="text-sm font-medium text-[var(--color-src-text)] mb-4">
                📈 稳定识字量趋势
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="charGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF6B35" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#FF6B35" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E4DF" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: 'none',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="识字量"
                      stroke="#FF6B35"
                      strokeWidth={3}
                      fill="url(#charGrad)"
                      dot={{ fill: '#FF6B35', strokeWidth: 2, r: 5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Vocabulary count chart */}
            <div className="card-game mb-4">
              <div className="text-sm font-medium text-[var(--color-src-text)] mb-4">
                📈 稳定词汇量趋势
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="vocabGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4ECDC4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#4ECDC4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E4DF" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: 'none',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="词汇量"
                      stroke="#4ECDC4"
                      strokeWidth={3}
                      fill="url(#vocabGrad)"
                      dot={{ fill: '#4ECDC4', strokeWidth: 2, r: 5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Total score chart */}
            <div className="card-game mb-4">
              <div className="text-sm font-medium text-[var(--color-src-text)] mb-4">
                📈 综合得分趋势
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E4DF" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: 'none',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="综合得分"
                      stroke="#FFE66D"
                      strokeWidth={3}
                      dot={{ fill: '#FFE66D', stroke: '#2D3436', strokeWidth: 2, r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Detailed history table */}
            <div className="card-game mb-6">
              <div className="text-sm font-medium text-[var(--color-src-text)] mb-4">
                📋 测试记录详情
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[var(--color-src-text-light)]">
                      <th className="text-left py-2">日期</th>
                      <th className="text-left py-2">等级</th>
                      <th className="text-right py-2">识字量</th>
                      <th className="text-right py-2">得分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.id} className="border-t border-[var(--color-src-text-light)]/10">
                        <td className="py-2 text-[var(--color-src-text-light)]">
                          {new Date(r.created_at).toLocaleDateString('zh-CN')}
                        </td>
                        <td className="py-2">
                          <span className="bg-[var(--color-src-primary)]/10 text-[var(--color-src-primary)] px-2 py-0.5 rounded-full text-xs font-medium">
                            {r.level}
                          </span>
                        </td>
                        <td className="py-2 text-right font-bold text-[var(--color-src-primary)]">{r.stable_char_count}</td>
                        <td className="py-2 text-right font-bold text-[var(--color-src-secondary)]">{r.total_score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <Link href={`/report?childId=${childId}`} className="block">
            <button className="btn-game bg-[var(--color-src-primary)] text-white w-full">
              📋 查看成长报告
            </button>
          </Link>
          <Link href="/profile" className="block">
            <button className="btn-game bg-[var(--color-src-secondary)] text-white w-full">
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

export default function HistoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-2xl">加载中...</div>
      </div>
    }>
      <HistoryContent />
    </Suspense>
  );
}
