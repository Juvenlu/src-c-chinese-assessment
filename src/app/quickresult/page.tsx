'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type QuickAssessmentResult,
  generateLearningRecommendation,
  ASSESSMENT_CONFIG,
} from '@/lib/quick-assessment';
import { Level, LEVEL_CONFIG } from '@/lib/types';
import { getLevelIndex, getLevelProgress } from '@/lib/level-service';
import {
  Star,
  BookOpen,
  TrendingUp,
  Sparkles,
  UserPlus,
  Home,
  ChevronRight,
  Award,
  BarChart3,
} from 'lucide-react';

const STORAGE_KEY = 'src_quick_test_results_v2';

export default function QuickResultPage() {
  const router = useRouter();
  const [result, setResult] = useState<QuickAssessmentResult | null>(null);

  useEffect(() => {
    try {
      // 同时支持 v2 和 v1 的存储键
      const raw =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem('src_quick_test_results') ||
        localStorage.getItem('guest_assessment_result');
      if (raw) {
        const data = JSON.parse(raw);
        // 兼容旧格式
        if (data.readingBaseLevel) {
          setResult(data);
        }
      }
    } catch (e) {
      // 忽略
    }
  }, []);

  if (!result) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-orange-50 via-amber-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <p className="text-muted-foreground mb-4">还没有测试结果</p>
          <button
            onClick={() => router.push('/quicktest')}
            className="px-6 py-3 rounded-xl bg-orange-400 text-white font-bold hover:bg-orange-500 transition-colors"
          >
            开始测试
          </button>
        </div>
      </div>
    );
  }

  const confLabel = { high: '高', medium: '中', low: '低' }[result.confidence];
  const confColor = { high: 'text-green-600 bg-green-50 border-green-200', medium: 'text-yellow-600 bg-yellow-50 border-yellow-200', low: 'text-orange-600 bg-orange-50 border-orange-200' }[result.confidence];

  const tips = generateLearningRecommendation(result);
  const charGap = Math.abs(getLevelIndex(result.characterLevel) - getLevelIndex(result.wordLevel));
  const hasWordGap = getLevelIndex(result.wordLevel) < getLevelIndex(result.characterLevel);

  const handleRegister = () => {
    localStorage.setItem('guest_assessment_result', JSON.stringify(result));
    const sid = result.guestSessionId || localStorage.getItem('src_guest_session_id');
    const params = new URLSearchParams({ from: 'quicktest' });
    if (sid) params.set('guest_session_id', sid);
    window.location.href = '/signup?' + params.toString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-amber-50 to-white px-4 py-8 pb-12">
      <div className="max-w-lg mx-auto">
        {/* === 顶部：核心结论 === */}
        <div className="text-center mb-6">
          <div className="inline-block mb-3 animate-bounce-in">
            <div className="text-6xl">🎉</div>
          </div>
          <h1
            className="text-2xl md:text-3xl font-bold text-foreground mb-2"
            style={{ fontFamily: "'ZCOOL KuaiLe', 'Noto Sans SC', cursive, sans-serif" }}
          >
            中文探险完成！
          </h1>
          <p className="text-muted-foreground">你的中文阅读字词基础</p>
        </div>

        {/* === 主卡片：识字等级 === */}
        <div className="bg-white rounded-3xl p-6 shadow-lg border border-orange-100 mb-4 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-orange-200/30 to-yellow-200/30 rounded-full -translate-y-8 translate-x-8" />
          <div className="absolute bottom-0 left-0 w-20 h-20 bg-gradient-to-tr from-teal-200/30 to-green-200/30 rounded-full translate-y-6 -translate-x-6" />

          <div className="relative">
            <div className="text-sm text-muted-foreground mb-1">识字水平约</div>
            <div
              className="text-6xl font-bold bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent mb-2"
              style={{ fontFamily: "'ZCOOL KuaiLe', 'Noto Sans SC', cursive, sans-serif" }}
            >
              {result.characterLevel}
            </div>
            <div className="text-base text-muted-foreground mb-3">
              基于字词识别能力的综合估算
            </div>
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${confColor}`}>
              <BarChart3 size={14} />
              置信度：{confLabel}
            </div>
          </div>
        </div>

        {/* === 三核心指标 === */}
        <div className="space-y-3 mb-6">
          {/* 单字 */}
          <div className="bg-white rounded-2xl p-4 border border-orange-100 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">🀄</span>
                <span className="font-medium text-foreground">单字基础</span>
              </div>
              <span className="text-sm font-bold text-orange-500">
                {formatLevelRange(result.characterLevelLower, result.characterLevelUpper)}
              </span>
            </div>
            <LevelProgressBar level={result.characterLevel} />
          </div>

          {/* 词语 */}
          <div className="bg-white rounded-2xl p-4 border border-orange-100 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">🧩</span>
                <span className="font-medium text-foreground">词语基础</span>
              </div>
              <span className="text-sm font-bold text-teal-500">
                {formatLevelRange(result.wordLevelLower, result.wordLevelUpper)}
              </span>
            </div>
            <LevelProgressBar level={result.wordLevel} color="teal" />
            {hasWordGap && (
              <p className="text-xs text-amber-600 mt-2 bg-amber-50 rounded-lg px-2 py-1">
                💡 词语能力略低于单字，建议通过分级绘本在语境中积累词语
              </p>
            )}
          </div>

          {/* 推荐阅读 */}
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-200 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen size={18} className="text-amber-600" />
              <span className="text-sm font-medium text-amber-700">推荐阅读难度</span>
            </div>
            <div className="font-bold text-foreground text-lg mb-1">
              {result.recommendedReadingDesc}
            </div>
            <p className="text-xs text-muted-foreground">
              在当前基础上选择稍难一点的故事，更容易获得进步
            </p>
          </div>
        </div>

        {/* === 各等级表现明细 === */}
        <details className="bg-white rounded-2xl border border-orange-100 shadow-sm mb-6 overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer font-medium text-foreground flex items-center justify-between list-none hover:bg-orange-50 transition-colors">
            <span className="flex items-center gap-2">
              <Award size={18} className="text-orange-500" />
              各等级表现明细
            </span>
            <ChevronRight size={16} className="text-muted-foreground transition-transform [[open]_&]:rotate-90" />
          </summary>
          <div className="px-4 pb-4 space-y-3 border-t border-orange-50">
            {result.levelResults.map((lr) => (
              <div key={lr.level} className="pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-foreground">{lr.level}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    lr.status.includes('pass')
                      ? 'bg-green-100 text-green-700'
                      : 'bg-orange-100 text-orange-700'
                  }`}>
                    {lr.status.includes('pass') ? '通过' : '未通过'}
                    {lr.usedBorderline ? ' · 边界确认' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs mb-1">单字</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-orange-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-400 rounded-full"
                          style={{ width: `${Math.round(lr.charAccuracy * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-orange-600 w-10 text-right">
                        {lr.charCorrect}/{lr.charTested}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs mb-1">词语</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-teal-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-400 rounded-full"
                          style={{ width: `${Math.round(lr.wordAccuracy * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-teal-600 w-10 text-right">
                        {lr.wordCorrect}/{lr.wordTested}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {result.levelResults.length === 0 && (
              <p className="text-center text-muted-foreground py-4 text-sm">暂无明细</p>
            )}
          </div>
        </details>

        {/* === 学习建议 === */}
        <div className="bg-white rounded-2xl p-5 border border-orange-100 shadow-sm mb-6">
          <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
            <Sparkles size={18} className="text-yellow-500" />
            下一步建议
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {tips.map((tip, i) => (
              <li key={i} className="flex gap-2">
                <TrendingUp size={16} className="text-orange-400 shrink-0 mt-0.5" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* === 绘本入口（占位） === */}
        <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-2xl p-5 border border-teal-200 mb-6">
          <div className="flex items-start gap-3">
            <div className="text-3xl">📖</div>
            <div className="flex-1">
              <h3 className="font-bold text-teal-800 mb-1">看看适合我的中文故事</h3>
              <p className="text-sm text-teal-700 mb-3">
                个性化中文故事即将开放，敬请期待
              </p>
            </div>
          </div>
        </div>

        {/* === 注册引导 === */}
        <div className="bg-gradient-to-br from-orange-100 to-amber-100 rounded-2xl p-5 border border-orange-200 mb-6">
          <h3 className="font-bold text-orange-800 mb-2 flex items-center gap-2">
            <UserPlus size={18} />
            注册并保存我的中文成长
          </h3>
          <p className="text-sm text-orange-700 mb-4">
            注册后本次测试结果将自动保存，成为成长地图的第一颗数据点。
            未来可以追踪中文成长趋势，获得更精准的阅读建议。
          </p>
          <button
            onClick={handleRegister}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold shadow-lg shadow-orange-400/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            立即注册，保存成长记录
          </button>
        </div>

        {/* === 免责说明 === */}
        <div className="bg-white/60 rounded-xl p-3 text-xs text-muted-foreground mb-6 border border-orange-100 text-center">
          这是快速体验测试结果，主要用于了解孩子目前的中文核心字词基础。
          <br />
          完整SRC测评可以提供更准确的成长评估。
        </div>

        {/* === 底部操作 === */}
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/')}
            className="flex-1 py-3 px-4 rounded-xl bg-white text-foreground font-medium border border-orange-200 hover:bg-orange-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <Home size={18} />
            返回首页
          </button>
          <button
            onClick={() => router.push('/quicktest')}
            className="flex-1 py-3 px-4 rounded-xl bg-orange-400 text-white font-bold shadow-md shadow-orange-400/20 hover:bg-orange-500 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            再测一次
            <ChevronRight size={18} />
          </button>
        </div>

        {/* 测试元数据 */}
        <div className="text-center text-xs text-muted-foreground mt-6 space-y-1">
          <p>
            共答 {result.totalQuestions} 题
            （单字 {result.totalCharQuestions} · 词语 {result.totalWordQuestions}）
          </p>
          <p>
            用时 {Math.round(result.totalTimeMs / 1000)} 秒
          </p>
        </div>
      </div>
    </div>
  );
}

// ========== 组件 ==========

function LevelProgressBar({ level, color = 'orange' }: { level: Level; color?: 'orange' | 'teal' }) {
  const pct = getLevelProgress(level === 'SRC100' ? 100 : level === 'SRC300' ? 300 : level === 'SRC500' ? 500 : 800);
  const bgClass = color === 'teal' ? 'bg-teal-100' : 'bg-orange-100';
  const fillClass = color === 'teal' ? 'bg-teal-400' : 'bg-orange-400';
  return (
    <div className="w-full h-2.5 bg-white/50 rounded-full overflow-hidden border border-white/60">
      <div className={`h-full ${fillClass} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatLevelRange(lower: Level, upper: Level): string {
  if (lower === upper) return lower.replace('SRC', 'SRC');
  return `${lower.replace('SRC', '')}–${upper.replace('SRC', '')}`;
}
