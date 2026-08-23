'use client';
/* eslint-disable react-hooks/purity */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  generateQuickCharQuestions,
  generateQuickVocabQuestions,
  QAItem,
  QAResult,
  estimateSRCLevel,
  saveTestHistory,
  getExcludedQuestionIds,
} from '@/lib/quick-assessment';
import { LEVEL_CONFIG } from '@/lib/types';

type TestPhase = 'intro' | 'char' | 'vocab' | 'calculating';

export default function QuickTestPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<TestPhase>('intro');
  const [charQuestions, setCharQuestions] = useState<QAItem[]>([]);
  const [vocabQuestions, setVocabQuestions] = useState<QAItem[]>([]);
  const [charAnswers, setCharAnswers] = useState<QAResult[]>([]);
  const [vocabAnswers, setVocabAnswers] = useState<QAResult[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);

  // 计算总进度
  const currentProgress = (() => {
    if (phase === 'intro') return 0;
    if (phase === 'char') return currentIdx + 1;
    if (phase === 'vocab') return charQuestions.length + currentIdx + 1;
    return totalQuestions;
  })();
  const progressPercent = totalQuestions > 0 ? (currentProgress / totalQuestions) * 100 : 0;

  // 开始测试
  function startTest() {
    const excluded = getExcludedQuestionIds();
    const chars = generateQuickCharQuestions(excluded);
    setCharQuestions(chars);
    setTotalQuestions(chars.length + 10); // 单字20 + 词组约10
    setPhase('char');
    setCurrentIdx(0);
    setQuestionStartTime(Date.now());
  }

  // 处理单字答题
  function handleCharAnswer(known: boolean) {
    const q = charQuestions[currentIdx];
    const reactionTime = Date.now() - questionStartTime;
    
    const answer: QAResult = {
      id: q.id,
      type: 'character',
      content: q.content,
      level: q.level,
      isCorrect: known,
      reactionTimeMs: reactionTime,
    };
    
    const newAnswers = [...charAnswers, answer];
    setCharAnswers(newAnswers);
    
    if (currentIdx < charQuestions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setQuestionStartTime(Date.now());
    } else {
      // 单字题完成，进入词组测试
      const vocabQs = generateQuickVocabQuestions(
        newAnswers,
        getExcludedQuestionIds(),
      );
      setVocabQuestions(vocabQs);
      setTotalQuestions(charQuestions.length + vocabQs.length);
      setPhase('vocab');
      setCurrentIdx(0);
      setQuestionStartTime(Date.now());
    }
  }

  // 处理词组答题
  function handleVocabAnswer(known: boolean) {
    const q = vocabQuestions[currentIdx];
    const reactionTime = Date.now() - questionStartTime;
    
    const answer: QAResult = {
      id: q.id,
      type: 'vocabulary',
      content: q.content,
      level: q.level,
      isCorrect: known,
      reactionTimeMs: reactionTime,
    };
    
    const newAnswers = [...vocabAnswers, answer];
    setVocabAnswers(newAnswers);
    
    if (currentIdx < vocabQuestions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setQuestionStartTime(Date.now());
    } else {
      // 全部完成，计算结果
      setPhase('calculating');
      finishTest(newAnswers);
    }
  }

  // 完成测试并跳转结果
  function finishTest(finalVocabAnswers: QAResult[]) {
    const estimate = estimateSRCLevel(charAnswers, finalVocabAnswers);
    
    // 保存到localStorage
    const allIds = [
      ...charAnswers.map(a => a.id),
      ...finalVocabAnswers.map(a => a.id),
    ];
    saveTestHistory(allIds, estimate);
    
    // 跳转结果页
    setTimeout(() => {
      const params = new URLSearchParams({
        level: estimate.estimatedLevel,
        confidence: estimate.confidence,
        charTested: estimate.charTested.toString(),
        charCorrect: estimate.charCorrect.toString(),
        vocabTested: estimate.vocabTested.toString(),
        vocabCorrect: estimate.vocabCorrect.toString(),
        overallCharRate: estimate.overallCharRate.toString(),
        overallVocabRate: estimate.overallVocabRate.toString(),
        from: 'quick',
      });
      router.push(`/quickresult?${params.toString()}`);
    }, 1000);
  }

  const currentQuestion = phase === 'char' 
    ? charQuestions[currentIdx] 
    : phase === 'vocab' 
      ? vocabQuestions[currentIdx] 
      : null;

  // 介绍页
  if (phase === 'intro') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFE5D9 100%)' }}>
        <div className="max-w-md w-full">
          {/* 小猴子图标占位 */}
          <div className="text-center mb-8">
            <div className="text-7xl mb-4">🐵</div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2" style={{ fontFamily: 'ZCOOL KuaiLe, cursive' }}>
              免费中文基础测试
            </h1>
            <p className="text-gray-600 text-lg">
              快速了解孩子的中文阅读字词基础
            </p>
          </div>

          {/* 特点说明 */}
          <div className="bg-white rounded-2xl p-6 shadow-lg mb-8 space-y-4">
            <div className="flex items-start gap-3">
              <div className="text-2xl">⏱️</div>
              <div>
                <div className="font-bold text-gray-800">3-5分钟完成</div>
                <div className="text-sm text-gray-600">约30道题，快速了解中文水平</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-2xl">🔤</div>
              <div>
                <div className="font-bold text-gray-800">认识即可</div>
                <div className="text-sm text-gray-600">看到字和词，选择"认识"或"不认识"</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-2xl">🌟</div>
              <div>
                <div className="font-bold text-gray-800">正面反馈</div>
                <div className="text-sm text-gray-600">不是考试，没有分数压力</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-2xl">📖</div>
              <div>
                <div className="font-bold text-gray-800">个性化阅读建议</div>
                <div className="text-sm text-gray-600">根据结果推荐合适的中文读物</div>
              </div>
            </div>
          </div>

          {/* 开始按钮 */}
          <button
            onClick={startTest}
            className="w-full py-5 text-xl font-bold text-white rounded-2xl shadow-lg transition-transform hover:scale-105 active:scale-95"
            style={{ backgroundColor: '#FF6B35', fontFamily: 'ZCOOL KuaiLe, cursive' }}
          >
            开始测试 ⭐
          </button>
          
          <p className="text-center text-sm text-gray-500 mt-4">
            无需注册 · 免费体验 · 随时可退出
          </p>
        </div>
      </div>
    );
  }

  // 计算中
  if (phase === 'calculating') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFE5D9 100%)' }}>
        <div className="text-center">
          <div className="text-6xl mb-6 animate-bounce">🎉</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2" style={{ fontFamily: 'ZCOOL KuaiLe, cursive' }}>
            测试完成！
          </h2>
          <p className="text-gray-600">正在生成你的中文成长报告...</p>
          <div className="mt-6 flex justify-center gap-2">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-3 h-3 rounded-full"
                style={{ 
                  backgroundColor: '#FFB347',
                  animation: `bounce 0.6s ease-in-out ${i * 0.2}s infinite alternate`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 单字/词组测试页
  const isCharPhase = phase === 'char';
  const phaseLabel = isCharPhase ? '单字识别' : '词语识别';
  const phaseNum = isCharPhase ? 1 : 2;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFE5D9 100%)' }}>
      {/* 顶部进度条 */}
      <div className="px-6 pt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600">第 {phaseNum} 部分 · {phaseLabel}</span>
          <span className="text-sm font-bold" style={{ color: '#FF6B35' }}>
            {currentProgress} / {totalQuestions}
          </span>
        </div>
        <div className="w-full h-3 bg-white/60 rounded-full overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-300"
            style={{ 
              width: `${progressPercent}%`,
              background: 'linear-gradient(90deg, #FF6B35, #FFB347)',
            }}
          />
        </div>
      </div>

      {/* 题目区域 */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="text-center mb-8">
          <div className="text-sm text-gray-500 mb-2">
            {isCharPhase ? '你认识这个字吗？' : '你认识这个词吗？'}
          </div>
          <div 
            className="text-7xl md:text-8xl font-bold text-gray-800"
            style={{
              fontFamily: "'KaiTi', 'STKaiti', '楷体', 'Microsoft YaHei', '微软雅黑', 'SimHei', '黑体', sans-serif",
            }}
          >
            {currentQuestion?.content}
          </div>
          {/* 难度小点 */}
          <div className="flex justify-center gap-1 mt-4">
            {[1, 2, 3, 4, 5].map(d => (
              <div
                key={d}
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: d <= (currentQuestion?.difficulty || 1) ? '#FFB347' : '#E0E0E0',
                }}
              />
            ))}
          </div>
        </div>

        {/* 选项按钮 */}
        <div className="w-full max-w-md space-y-4">
          <button
            onClick={() => isCharPhase ? handleCharAnswer(true) : handleVocabAnswer(true)}
            className="w-full py-6 text-2xl font-bold text-white rounded-2xl shadow-lg transition-transform hover:scale-[1.02] active:scale-95"
            style={{ backgroundColor: '#4ECDC4', fontFamily: 'ZCOOL KuaiLe, cursive' }}
          >
            👍 认识
          </button>
          <button
            onClick={() => isCharPhase ? handleCharAnswer(false) : handleVocabAnswer(false)}
            className="w-full py-6 text-2xl font-bold rounded-2xl shadow-md transition-transform hover:scale-[1.02] active:scale-95"
            style={{ 
              backgroundColor: '#FFFFFF',
              color: '#636E72',
              fontFamily: 'ZCOOL KuaiLe, cursive',
              border: '2px solid #E0E0E0',
            }}
          >
            🤔 还不太认识
          </button>
        </div>
      </div>

      {/* 底部鼓励语 */}
      <div className="px-6 pb-8 text-center">
        <p className="text-sm text-gray-500">
          {isCharPhase 
            ? '不认识也没关系，知道自己认识哪些字最重要～' 
            : '词语是认识单个字后的好朋友，慢慢来！'
          }
        </p>
      </div>
    </div>
  );
}
