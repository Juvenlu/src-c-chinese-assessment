'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AdaptiveAssessmentResult,
  generateRecommendation,
  getConfidenceText,
  LEVEL_ORDER,
} from '@/lib/quick-assessment';
import { Level, LEVEL_CONFIG } from '@/lib/types';

const STORAGE_RESULTS = 'src_quick_test_results';

export default function QuickResultPage() {
  const router = useRouter();
  const [result, setResult] = useState<AdaptiveAssessmentResult | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_RESULTS);
      if (raw) {
        const data = JSON.parse(raw);
        setResult(data.result);
      }
    } catch (e) { /* 忽略 */ }
  }, []);

  // 无结果时显示占位
  if (!result) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFE5D9 100%)' }}>
        <div className="text-center">
          <div className="text-5xl mb-4">🤔</div>
          <p className="text-[var(--color-text-secondary)] mb-4">还没有找到测试结果</p>
          <button
            onClick={() => router.push('/quicktest')}
            className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-xl font-medium"
          >
            去测试
          </button>
        </div>
      </div>
    );
  }

  const recommendation = generateRecommendation(result);
  const confText = getConfidenceText(result.confidence);

  return (
    <div className="min-h-screen pb-12" style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFE5D9 100%)' }}>
      <div className="max-w-md mx-auto px-6 pt-8">
        {/* 顶部标题 */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🎉</div>
          <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
            测试完成！
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            快速估测结果 {confText}
          </p>
        </div>

        {/* 核心：阅读基础等级 */}
        <div className="bg-white rounded-3xl p-8 shadow-xl mb-6 text-center">
          <p className="text-sm text-[var(--color-text-secondary)] mb-2">
            你的中文阅读基础大约在
          </p>
          <div
            className="text-5xl font-bold mb-2"
            style={{ color: '#FF6B35', fontFamily: "'ZCOOL KuaiLe', cursive" }}
          >
            {result.readingLevel}
          </div>
          <p className="text-lg text-[var(--color-text-primary)] font-medium mb-4">
            {recommendation.headline}
          </p>

          {/* 等级进度条 */}
          <LevelProgressBar currentLevel={result.readingLevel} />

          <div className="mt-4 pt-4 border-t border-gray-100 text-sm text-[var(--color-text-secondary)]">
            共测试 {result.totalTested} 题 · {result.levelsTested} 个等级
          </div>
        </div>

        {/* 双水位：单字 + 词语 */}
        <div className="bg-white rounded-3xl p-6 shadow-md mb-6">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
            📊 两项能力分别看
          </h2>

          <div className="space-y-4">
            {/* 单字能力 */}
            <WaterRow
              icon="🔤"
              label="单字识别"
              level={result.charWaterLevel}
              correct={result.charTotalCorrect}
              tested={result.charTotalTested}
              rate={result.charOverallRate}
            />
            {/* 词语能力 */}
            <WaterRow
              icon="📚"
              label="词语识别"
              level={result.vocabWaterLevel}
              correct={result.vocabTotalCorrect}
              tested={result.vocabTotalTested}
              rate={result.vocabOverallRate}
            />
          </div>

          <div className="mt-4 p-3 bg-[var(--color-accent)]/10 rounded-xl text-sm text-[var(--color-text-secondary)]">
            💡 阅读能力由较弱的一项决定。
            {LEVEL_ORDER.indexOf(result.charWaterLevel) > LEVEL_ORDER.indexOf(result.vocabWaterLevel)
              ? ' 词语是下一步重点提升的方向。'
              : LEVEL_ORDER.indexOf(result.vocabWaterLevel) > LEVEL_ORDER.indexOf(result.charWaterLevel)
              ? ' 单字量是下一步重点提升的方向。'
              : ' 两项能力均衡，同步提升即可。'}
          </div>
        </div>

        {/* i+1 推荐阅读难度 */}
        <div className="bg-white rounded-3xl p-6 shadow-md mb-6">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-2" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
            📖 适合的阅读难度
          </h2>
          <div className="flex items-center gap-3 mb-4">
            <div
              className="text-3xl font-bold"
              style={{ color: '#4ECDC4', fontFamily: "'ZCOOL KuaiLe', cursive" }}
            >
              {result.recommendedLevel}
            </div>
            <div className="text-sm text-[var(--color-text-secondary)]">
              i+1 轻度挑战 · 踮踮脚够得到
            </div>
          </div>
          <p className="text-sm text-[var(--color-text-primary)] mb-2 font-medium">
            {recommendation.bookLevel}
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {recommendation.description}
          </p>
        </div>

        {/* 阅读建议 */}
        <div className="bg-white rounded-3xl p-6 shadow-md mb-6">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
            💡 阅读建议
          </h2>
          <ul className="space-y-3">
            {recommendation.tips.map((tip, i) => (
              <li key={i} className="flex gap-3 text-sm text-[var(--color-text-primary)]">
                <span className="text-[var(--color-primary)] flex-shrink-0">✓</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 分级明细 */}
        <div className="bg-white rounded-3xl p-6 shadow-md mb-6">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
            📈 各等级表现
          </h2>
          <div className="space-y-3">
            {LEVEL_ORDER.map(lv => {
              const bd = result.levelBreakdown[lv];
              if (!bd.tested) {
                return (
                  <div key={lv} className="flex items-center gap-3 text-sm opacity-40">
                    <span className="w-20 font-medium text-[var(--color-text-secondary)]">{lv}</span>
                    <span className="text-[var(--color-text-secondary)]">未测试</span>
                  </div>
                );
              }
              return (
                <div key={lv} className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-[var(--color-text-primary)]">{lv}</span>
                    <div className="flex gap-3 text-xs">
                      <span className="text-[var(--color-text-secondary)]">
                        单字 {bd.charCorrect}/{bd.charTested}
                      </span>
                      <span className="text-[var(--color-text-secondary)]">
                        词语 {bd.vocabCorrect}/{bd.vocabTested}
                      </span>
                      {bd.passed && <span className="text-green-500">✓ 达标</span>}
                      {bd.failed && <span className="text-[var(--color-error)]">待巩固</span>}
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(bd.charRate + bd.vocabRate) / 2 * 100}%`,
                        background: bd.passed
                          ? 'linear-gradient(90deg, #4ECDC4, #51CF66)'
                          : bd.failed
                          ? 'linear-gradient(90deg, #FFB3B3, #FF6B6B)'
                          : 'linear-gradient(90deg, #FFE66D, #FF6B35)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 下一步 */}
        <div className="space-y-3">
          <button
            onClick={() => router.push('/profile?mode=full&quickLevel=' + result.readingLevel)}
            className="w-full py-4 bg-[var(--color-primary)] text-white text-lg font-bold rounded-2xl shadow-lg hover:scale-[1.02] transition-transform active:scale-95"
            style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}
          >
            注册并保存结果 →
          </button>
          <p className="text-xs text-center text-[var(--color-text-secondary)]">
            注册后可进行完整测评、查看成长地图、获取定制绘本
          </p>
          <button
            onClick={() => router.push('/')}
            className="w-full py-3 bg-white text-[var(--color-text-secondary)] text-sm rounded-2xl border border-gray-200 hover:bg-gray-50"
          >
            返回首页
          </button>
        </div>
      </div>
    </div>
  );
}

// ========== 子组件 ==========

function LevelProgressBar({ currentLevel }: { currentLevel: Level }) {
  const currentIdx = LEVEL_ORDER.indexOf(currentLevel);

  return (
    <div className="flex items-center gap-1">
      {LEVEL_ORDER.map((lv, i) => {
        const isPassed = i <= currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <div key={lv} className="flex-1 flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                isCurrent
                  ? 'bg-[var(--color-primary)] text-white scale-110'
                  : isPassed
                  ? 'bg-[var(--color-secondary)] text-white'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {isPassed && !isCurrent ? '✓' : i + 1}
            </div>
            <div className={`text-xs mt-1 ${isCurrent ? 'text-[var(--color-primary)] font-bold' : isPassed ? 'text-[var(--color-secondary)]' : 'text-gray-400'}`}>
              {lv.replace('SRC', '')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WaterRow({
  icon,
  label,
  level,
  correct,
  tested,
  rate,
}: {
  icon: string;
  label: string;
  level: Level;
  correct: number;
  tested: number;
  rate: number;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="text-2xl w-10 text-center">{icon}</div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium text-[var(--color-text-primary)] text-sm">{label}</span>
          <span
            className="font-bold text-lg"
            style={{ color: '#FF6B35', fontFamily: "'ZCOOL KuaiLe', cursive" }}
          >
            {level}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${rate * 100}%`,
                background: 'linear-gradient(90deg, #FFE66D, #FF6B35)',
              }}
            />
          </div>
          <span className="text-xs text-[var(--color-text-secondary)] w-14 text-right">
            {correct}/{tested}
          </span>
        </div>
      </div>
    </div>
  );
}
