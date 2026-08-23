'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LEVEL_CONFIG, Level } from '@/lib/types';

export default function ResultPage() {
  const [level, setLevel] = useState<Level>('SRC300');
  const [showResult, setShowResult] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [totalChars, setTotalChars] = useState(0);
  const [vocabCount, setVocabCount] = useState(0);
  const [totalVocab, setTotalVocab] = useState(0);
  const [pepMastered, setPepMastered] = useState(0);
  const [pepTotal, setPepTotal] = useState(0);
  const [pepCovered, setPepCovered] = useState(0);
  const [stars, setStars] = useState(0);
  const [isFullTest, setIsFullTest] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const l = (params.get('level') || 'SRC300') as Level;
    const c = parseInt(params.get('charCount') || '0');
    const v = parseInt(params.get('vocabCount') || '0');
    const tv = parseInt(params.get('totalVocab') || '0');
    const s = parseInt(params.get('score') || '0');

    setLevel(l);
    const config = LEVEL_CONFIG[l];
    setTotalChars(config.charCount);
    setTotalVocab(tv || config.vocabCount);
    setIsFullTest(config.charSampleRatio >= 0.95);

    // 从SRC测试结果估算人教版掌握（模拟映射）
    const pepMap: Record<Level, { total: number; coveredRate: number }> = {
      SRC100: { total: 100, coveredRate: 0.85 },
      SRC300: { total: 300, coveredRate: 0.82 },
      SRC500: { total: 499, coveredRate: 0.78 },
      SRC800: { total: 799, coveredRate: 0.75 },
    };
    const pepInfo = pepMap[l];
    const pepCoveredCount = Math.round(c * pepInfo.coveredRate);
    setPepTotal(pepInfo.total);
    setPepCovered(pepCoveredCount);
    setPepMastered(Math.round(pepCoveredCount * (c / config.charCount)));

    const correctRate = c / config.charCount;
    if (correctRate >= 0.9) {
      setStars(5);
    } else if (correctRate >= 0.8) {
      setStars(4);
    } else if (correctRate >= 0.7) {
      setStars(3);
    } else if (correctRate >= 0.6) {
      setStars(2);
    } else {
      setStars(1);
    }

    setCharCount(c);
    setVocabCount(v);

    setTimeout(() => setShowResult(true), 100);
  }, []);

  const srcMasteryRate = totalChars > 0 ? charCount / totalChars : 0;
  const vocabRate = totalVocab > 0 ? vocabCount / totalVocab : 0;

  // 估算SRC掌握量（抽测情况下）
  const estimatedMastered = isFullTest
    ? charCount
    : Math.round(srcMasteryRate * totalChars);

  const pepLevelName = level.replace('SRC', '人教版');

  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] flex items-center justify-center p-4">
      <div
        className={`max-w-2xl w-full transition-all duration-700 ${
          showResult ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        {/* 标题 */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-2">🎉</div>
          <h1 className="text-3xl font-display text-[var(--color-src-text)]">
            测试完成！
          </h1>
          <p className="text-[var(--color-src-text-light)] mt-2">
            {level} 测字结果
          </p>
        </div>

        {/* 三张卡片 — 一次测试、双体系映射、三维结果 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* 卡片1：基础识字（人教版映射） */}
          <div className="bg-white rounded-3xl p-6 shadow-lg text-center border-2 border-blue-100 hover:scale-105 transition-transform">
            <div className="text-4xl mb-2">📘</div>
            <div className="text-sm text-[var(--color-src-text-light)] mb-1">
              基础识字
            </div>
            <div className="text-4xl font-display text-[var(--color-src-primary)] mb-1">
              {pepMastered}
              <span className="text-xl text-[var(--color-src-text-light)]">
                {' '}
                / {pepTotal}
              </span>
            </div>
            <div className="text-xs text-[var(--color-src-text-light)] mb-3">
              {pepLevelName}
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
              <div
                className="bg-blue-400 h-2 rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.min(100, (pepMastered / pepTotal) * 100)}%`,
                }}
              />
            </div>
            <div className="text-xs text-gray-400">
              本次测试覆盖 {pepCovered} 个教材汉字
            </div>
          </div>

          {/* 卡片2：阅读识字（SRC） */}
          <div className="bg-white rounded-3xl p-6 shadow-lg text-center border-2 border-orange-100 hover:scale-105 transition-transform">
            <div className="text-4xl mb-2">📚</div>
            <div className="text-sm text-[var(--color-src-text-light)] mb-1">
              阅读识字
            </div>
            <div className="text-4xl font-display text-[var(--color-src-primary)] mb-1">
              {isFullTest ? '' : '约'}
              {estimatedMastered}
              <span className="text-xl text-[var(--color-src-text-light)]">
                {' '}
                / {totalChars}
              </span>
            </div>
            <div className="text-xs text-[var(--color-src-text-light)] mb-3">
              SRC阅读常用字
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
              <div
                className="bg-[var(--color-src-primary)] h-2 rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.min(100, srcMasteryRate * 100)}%`,
                }}
              />
            </div>
            <div className="text-xs text-gray-400">
              {isFullTest ? '全量测试' : `抽测 ${charCount} 字，掌握度 ${Math.round(srcMasteryRate * 100)}%`}
            </div>
          </div>

          {/* 卡片3：词组掌握 */}
          <div className="bg-white rounded-3xl p-6 shadow-lg text-center border-2 border-green-100 hover:scale-105 transition-transform">
            <div className="text-4xl mb-2">🔤</div>
            <div className="text-sm text-[var(--color-src-text-light)] mb-1">
              词组掌握
            </div>
            <div className="text-4xl font-display text-[var(--color-src-secondary)] mb-1">
              {Math.round(vocabRate * 100)}%
            </div>
            <div className="text-xs text-[var(--color-src-text-light)] mb-3">
              常用词组
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
              <div
                className="bg-[var(--color-src-secondary)] h-2 rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.min(100, vocabRate * 100)}%`,
                }}
              />
            </div>
            <div className="text-xs text-gray-400">
              测试 {vocabCount} / {totalVocab} 个词组
            </div>
          </div>
        </div>

        {/* 教育逻辑说明 */}
        <div className="bg-white/60 rounded-2xl p-4 mb-6 text-center">
          <p className="text-sm text-[var(--color-src-text)] font-medium">
            课本基础 → 阅读基础 → 词语应用
          </p>
          <p className="text-xs text-[var(--color-src-text-light)] mt-1">
            一次测字，三维评估，全面了解孩子的中文阅读能力
          </p>
        </div>

        {/* 星级评价 */}
        <div className="bg-white rounded-3xl p-6 shadow-lg text-center mb-6">
          <h2 className="text-xl font-display text-[var(--color-src-text)] mb-4">
            综合评价
          </h2>
          <div className="text-4xl mb-4">
            {[...Array(5)].map((_, i) => (
              <span
                key={i}
                className={`inline-block mx-1 ${
                  i < stars
                    ? 'text-[var(--color-src-accent)] animate-bounce-in'
                    : 'text-gray-200'
                }`}
                style={{ animationDelay: `${i * 100}ms` }}
              >
                ★
              </span>
            ))}
          </div>
          <p className="text-[var(--color-src-text-light)]">
            {stars === 5 && '太厉害了！你已经非常熟练地掌握了这些字！'}
            {stars === 4 && '很棒！继续保持，你快要全部掌握啦！'}
            {stars === 3 && '不错哦！再多练习一下就能更上一层楼！'}
            {stars === 2 && '加油！每天进步一点点，你会越来越棒！'}
            {stars === 1 && '没关系，我们一起努力，慢慢就会认识更多字啦！'}
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/growth-map"
            className="bg-[var(--color-src-primary)] text-white px-8 py-4 rounded-full text-lg font-bold hover:scale-105 transition-transform text-center shadow-lg"
          >
            🌱 查看成长地图
          </Link>
          <Link
            href="/"
            className="bg-white text-[var(--color-src-primary)] border-2 border-[var(--color-src-primary)] px-8 py-4 rounded-full text-lg font-bold hover:scale-105 transition-transform text-center"
          >
            返回首页
          </Link>
        </div>
      </div>

      <style jsx>{`
        @keyframes bounce-in {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          50% {
            transform: scale(1.2);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-bounce-in {
          animation: bounce-in 0.5s ease-out backwards;
        }
      `}</style>
    </div>
  );
}
