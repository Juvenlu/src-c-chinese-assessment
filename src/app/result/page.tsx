'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LEVEL_CONFIG, Level } from '@/lib/types';
import { getNextLevel } from '@/lib/level-service';
import { getCharList, getRJBCharList, getCorrespondingRJBLevel } from '@/lib/questions';
import { calculateDualSystemResult } from '@/lib/dual-system';

// 综合评价等级与文案
const getEvaluation = (score: number, isFirst: boolean) => {
  if (score >= 95) {
    return {
      stars: 5,
      half: 0,
      title: '阅读基础非常扎实',
      desc: '你的阅读基础非常扎实，已经具备继续扩大中文阅读范围的良好基础！',
    };
  }
  if (score >= 90) {
    return {
      stars: 4,
      half: 1,
      title: '阅读基础较扎实',
      desc: '你的阅读基础已经比较扎实，可以继续挑战更丰富的中文故事和词语。',
    };
  }
  if (score >= 80) {
    return {
      stars: 3,
      half: 1,
      title: '正在形成稳定阅读基础',
      desc: '你的阅读基础正在变得更加稳定，下一步可以通过词组和闯关提升理解能力。',
    };
  }
  if (score >= 70) {
    return {
      stars: 2,
      half: 1,
      title: '正在积累阅读基础',
      desc: '你的中文阅读基础正在形成，继续积累常用字词，你会发现阅读越来越轻松。',
    };
  }
  return {
    stars: 1,
    half: 0,
    title: '正在打好中文阅读基础',
    desc: '你已经开始建立中文阅读基础，接下来通过闯关和定制绘本继续积累，会越来越容易读懂中文故事。',
  };
};

export default function ResultPage() {
  const [level, setLevel] = useState<Level>('SRC300');
  const [showResult, setShowResult] = useState(false);

  // 单字测试数据
  const [testedChars, setTestedChars] = useState(0); // 本次抽测/测试的字数
  const [correctChars, setCorrectChars] = useState(0); // 答对数
  const [totalChars, setTotalChars] = useState(0); // 字库总字数
  const [isFullTest, setIsFullTest] = useState(false); // 是否全测（SRC100）

  // 词组测试数据
  const [testedVocab, setTestedVocab] = useState(0);
  const [correctVocab, setCorrectVocab] = useState(0);
  const [totalVocab, setTotalVocab] = useState(0);

  // 人教版映射数据
  const [pepTotal, setPepTotal] = useState(0);
  const [pepCovered, setPepCovered] = useState(0); // 被SRC测试覆盖到的教材字数
  const [pepCoveredCorrect, setPepCoveredCorrect] = useState(0); // 覆盖范围内答对数

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const l = (params.get('level') || 'SRC100') as Level;
    const tc = parseInt(params.get('testedChars') || '0');
    const cc = parseInt(params.get('correctChars') || '0');
    const tv = parseInt(params.get('testedVocab') || '0');
    const cv = parseInt(params.get('correctVocab') || '0');
    const charCount = parseInt(params.get('charCount') || '0');
    const vocabCount = parseInt(params.get('vocabCount') || '0');
    const totalV = parseInt(params.get('totalVocab') || '0');

    const config = LEVEL_CONFIG[l];
    const isFull = config.charSampleRatio >= 0.95;
    setLevel(l);
    setTotalChars(config.charCount);
    setTotalVocab(totalV || config.vocabCount);
    setIsFullTest(isFull);

    // 单字数据解析（优先级：tested+correct > charCount+isFull > 默认）
    let testedC = tc;
    let correctC = cc;
    if (testedC === 0 && correctC === 0 && charCount > 0) {
      // 兼容旧调用：charCount传的是"认识的字"
      correctC = charCount;
      testedC = isFull ? config.charCount : charCount; // 全测时测试量=总字库
    }
    setTestedChars(testedC);
    setCorrectChars(correctC);

    // 词组数据解析
    let testedV = tv;
    let correctV = cv;
    if (testedV === 0 && correctV === 0 && vocabCount > 0) {
      correctV = vocabCount;
      testedV = vocabCount; // 词组无全测概念，暂时等量
    }
    setTestedVocab(testedV);
    setCorrectVocab(correctV);

    // 人教版映射：使用真实字库交集计算（基于本次测试的认识/不认识字）
    const srcCharList = getCharList(l);
    const rjbLevel = getCorrespondingRJBLevel(l);
    const rjbCharList = getRJBCharList(rjbLevel);
    const charMasteryRate = testedC > 0 ? correctC / testedC : 0;
    const rjbSet = new Set(rjbCharList);
    const srcSet = new Set(srcCharList);
    // 真实 SRC 字库与教材字库的全集交集数（字库规模对照）
    const overlapChars = srcCharList.filter(c => rjbSet.has(c));
    const pepTotal = rjbCharList.length;
    const pepFullOverlap = overlapChars.length;
    // 本次测试覆盖的教材字数量：按抽样比例 × 全集交集数估算
    const pepCoveredCount = Math.round(pepFullOverlap * (testedC / srcCharList.length));
    setPepTotal(pepTotal);
    setPepCovered(pepCoveredCount);
    // 教材掌握估算：使用全集交集 × 掌握率（而不是 RJB 总量 × 掌握率，避免过度推断）
    setPepCoveredCorrect(Math.round(pepFullOverlap * charMasteryRate));

    setTimeout(() => setShowResult(true), 100);
  }, []);

  // 单字掌握率 = 答对 / 抽测数
  const charMasteryRate = testedChars > 0 ? correctChars / testedChars : 0;
  // 词组掌握率
  const vocabMasteryRate = testedVocab > 0 ? correctVocab / testedVocab : 0;
  // 人教版整体估算掌握率（统一使用全库掌握率 = 单字正确率，避免中间舍入误差）
  const pepMasteryRate = charMasteryRate;

  // 估算掌握量（统一规则：掌握率 × 总量，只在最终 round 一次）
  const estimatedCharMastered = isFullTest ? correctChars : Math.round(totalChars * charMasteryRate);
  // RJB 估算掌握：基于 SRC∩RJB 全集交集 × 单字掌握率（避免用 RJB 总量直接外推导致过度推断）
  const estimatedPepMastered = pepCoveredCorrect;
  const estimatedVocabMastered = Math.round(totalVocab * vocabMasteryRate);

  // 综合评价（单字60% + 词组30% + 历史稳定性10%，首测把10%分给单字和词组）
  const isFirstTest = true; // 暂时默认首测，后续接入历史后动态判断
  const overallScore = isFirstTest
    ? charMasteryRate * 65 + vocabMasteryRate * 35
    : charMasteryRate * 60 + vocabMasteryRate * 30 + 0.85 * 10;

  const evaluation = getEvaluation(overallScore, isFirstTest);

  const pepLevelName = level.replace('SRC', '人教版');
  // next_level 映射由 level-service 统一提供，desc 是前端展示文案
  const nextLv = getNextLevel(level);
  const nextInfo = nextLv
    ? {
        label: nextLv,
        desc: nextLv === 'SRC300'
          ? '进入更丰富的中文阅读常用字阶段'
          : nextLv === 'SRC500'
            ? '继续扩大阅读常用字，通过词组、闯关和定制绘本阅读，进一步提升中文理解能力'
            : '向更高阶的阅读常用字进阶，建立更完整的中文阅读基础',
      }
    : { label: '中文阅读与理解', desc: '进入更丰富的中文阅读与理解阶段' };

  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] flex items-center justify-center p-4 py-8">
      <div
        className={`max-w-2xl w-full transition-all duration-700 ${
          showResult ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        {/* 标题 */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-2">🎉</div>
          <h1 className="text-3xl font-display text-[var(--color-src-text)]">
            测字完成！
          </h1>
          <div className="text-4xl font-display text-[var(--color-src-primary)] mt-3 mb-2">
            {level}
          </div>
          <p className="text-[var(--color-src-text-light)]">
            中文成长基础评估
          </p>
        </div>

        {/* 三维度结果 — 教材参照 → 阅读识字 → 词语应用 */}
        <div className="space-y-4 mb-6">
          {/* ① 教材基础识字（人教版参照） */}
          <div className="bg-white rounded-3xl p-5 shadow-md border border-blue-50">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center text-2xl">📘</div>
              <div>
                <div className="text-xs text-blue-400 font-medium">① 教材基础识字</div>
                <div className="text-sm font-bold text-[var(--color-src-text)]">
                  人教版基础字参照
                </div>
              </div>
            </div>
            <div className="flex items-end justify-between mb-2">
              <div>
                <span className="text-3xl font-display text-blue-500">
                  {estimatedPepMastered}
                </span>
                <span className="text-sm text-[var(--color-src-text-light)]">
                  {' '}/ {pepTotal} 字
                </span>
              </div>
              <div className="text-right">
                <div className="text-lg font-display text-blue-500">
                  {Math.round(pepMasteryRate * 100)}%
                </div>
                <div className="text-xs text-[var(--color-src-text-light)]">掌握率</div>
              </div>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
              <div
                className="bg-blue-400 h-2 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(100, pepMasteryRate * 100)}%` }}
              />
            </div>
            <p className="text-xs text-[var(--color-src-text-light)] leading-relaxed">
              人教版字库用于提供教材识字参照，帮助了解孩子的基础汉字积累。
              本次测试覆盖 {pepCovered} 个教材汉字。
            </p>
          </div>

          {/* ② SRC阅读识字（核心） */}
          <div className="bg-white rounded-3xl p-6 shadow-lg border-2 border-[var(--color-src-primary)]/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-[var(--color-src-primary)] text-white text-xs px-3 py-1 rounded-bl-2xl font-medium">
              核心指标
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-3xl">📚</div>
              <div>
                <div className="text-xs text-[var(--color-src-primary)] font-bold">② 阅读识字</div>
                <div className="text-lg font-display text-[var(--color-src-text)]">
                  {level} 阅读常用字
                </div>
              </div>
            </div>
            <div className="flex items-end justify-between mb-3">
              <div>
                <span className="text-4xl font-display text-[var(--color-src-primary)]">
                  {estimatedCharMastered}
                </span>
                <span className="text-base text-[var(--color-src-text-light)]">
                  {' '}/ {totalChars} 字
                </span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-display text-[var(--color-src-primary)]">
                  {Math.round(charMasteryRate * 100)}%
                </div>
                <div className="text-xs text-[var(--color-src-text-light)]">掌握率</div>
              </div>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 mb-2">
              <div
                className="bg-[var(--color-src-primary)] h-3 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(100, charMasteryRate * 100)}%` }}
              />
            </div>
            <p className="text-xs text-[var(--color-src-text-light)]">
              {isFullTest ? `全量测试 ${testedChars} 字` : `本次抽测 ${testedChars} 字`}
              ，稳定掌握约 {estimatedCharMastered} 个阅读常用字。
            </p>
          </div>

          {/* ③ 词语应用 */}
          <div className="bg-white rounded-3xl p-5 shadow-md border border-green-50">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-2xl bg-green-50 flex items-center justify-center text-2xl">🔤</div>
              <div>
                <div className="text-xs text-emerald-500 font-medium">③ 词语应用</div>
                <div className="text-sm font-bold text-[var(--color-src-text)]">
                  常用词组掌握情况
                </div>
              </div>
            </div>
            <div className="flex items-end justify-between mb-2">
              <div>
                <span className="text-2xl font-display text-[var(--color-src-secondary)]">
                  {correctVocab}
                </span>
                <span className="text-sm text-[var(--color-src-text-light)]">
                  {' '}/ {testedVocab} 词
                </span>
              </div>
              <div className="text-right">
                <div className="text-lg font-display text-[var(--color-src-secondary)]">
                  {Math.round(vocabMasteryRate * 100)}%
                </div>
                <div className="text-xs text-[var(--color-src-text-light)]">掌握率</div>
              </div>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
              <div
                className="bg-[var(--color-src-secondary)] h-2 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(100, vocabMasteryRate * 100)}%` }}
              />
            </div>
            <p className="text-xs text-[var(--color-src-text-light)] leading-relaxed">
              认识单字不等于掌握词语。词汇量估算约 {estimatedVocabMastered} 词，
              词语应用是阅读能力的重要补充指标。
            </p>
          </div>
        </div>

        {/* 三维关系说明 */}
        <div className="bg-white/60 rounded-2xl p-4 mb-6">
          <p className="text-sm text-[var(--color-src-text)] text-center leading-relaxed">
            教材识字反映基础汉字积累；SRC 阅读识字进一步观察阅读常用字掌握情况；
            词语测试则帮助了解汉字进入实际词语应用的基础。
          </p>
        </div>

        {/* 星级评价 */}
        <div className="bg-white rounded-3xl p-6 shadow-lg text-center mb-6">
          <h2 className="text-xl font-display text-[var(--color-src-text)] mb-4">
            综合评价
          </h2>
          <div className="text-4xl mb-3">
            {[...Array(5)].map((_, i) => {
              const fill = i < evaluation.stars;
              const isHalf = i === evaluation.stars && evaluation.half === 1;
              return (
                <span
                  key={i}
                  className={`inline-block mx-0.5 ${
                    fill
                      ? 'text-[var(--color-src-accent)]'
                      : isHalf
                        ? 'text-[var(--color-src-accent)]'
                        : 'text-gray-200'
                  }`}
                  style={{
                    animation: fill || isHalf ? 'bounce-in 0.5s ease-out backwards' : undefined,
                    animationDelay: `${i * 100}ms`,
                  }}
                >
                  {isHalf ? '☆' : '★'}
                </span>
              );
            })}
          </div>
          <p className="text-[var(--color-src-primary)] font-bold mb-1">
            {evaluation.title}
          </p>
          <p className="text-sm text-[var(--color-src-text-light)]">
            {evaluation.desc}
          </p>
          {!isFullTest && (
            <p className="text-xs text-gray-400 mt-3">
              根据本次抽测结果估算，继续测字可以获得更准确的成长画像
            </p>
          )}
        </div>

        {/* 下一步 */}
        <div className="bg-white rounded-3xl p-6 shadow-lg mb-6">
          <h2 className="text-lg font-display text-[var(--color-src-text)] mb-3 text-center">
            🚀 下一步
          </h2>
          <div className="text-center">
            <p className="text-[var(--color-src-primary)] font-bold">{nextInfo.label}</p>
            <p className="text-sm text-[var(--color-src-text-light)] mt-1">
              {nextInfo.desc}
            </p>
          </div>

          {/* 未来模块预留 */}
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="bg-gray-50 rounded-2xl p-3 text-center border border-gray-100 opacity-60">
              <div className="text-2xl mb-1">🎮</div>
              <p className="text-xs text-gray-400">闯关挑战</p>
            </div>
            <div className="bg-gray-50 rounded-2xl p-3 text-center border border-gray-100 opacity-60">
              <div className="text-2xl mb-1">📖</div>
              <p className="text-xs text-gray-400">定制绘本</p>
            </div>
            <div className="bg-gray-50 rounded-2xl p-3 text-center border border-gray-100 opacity-60">
              <div className="text-2xl mb-1">✍️</div>
              <p className="text-xs text-gray-400">中文输出</p>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href={`/growth-map?level=${level}&testedChars=${testedChars}&correctChars=${correctChars}&testedVocab=${testedVocab}&correctVocab=${correctVocab}`}
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
      `}</style>
    </div>
  );
}
