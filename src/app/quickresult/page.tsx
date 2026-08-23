'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { getReadingRecommendation } from '@/lib/quick-assessment';
import { Level, LEVEL_CONFIG } from '@/lib/types';

export default function QuickResultPage() {
  const params = useSearchParams();
  const level = (params.get('level') as Level) || 'SRC300';
  const confidence = (params.get('confidence') as 'low' | 'medium' | 'high') || 'medium';
  const charTested = parseInt(params.get('charTested') || '0');
  const charCorrect = parseInt(params.get('charCorrect') || '0');
  const vocabTested = parseInt(params.get('vocabTested') || '0');
  const vocabCorrect = parseInt(params.get('vocabCorrect') || '0');
  const overallCharRate = parseFloat(params.get('overallCharRate') || '0');
  const overallVocabRate = parseFloat(params.get('overallVocabRate') || '0');

  const config = LEVEL_CONFIG[level];
  const vocabMasteryRate = vocabTested > 0 ? vocabCorrect / vocabTested : 0;

  // 阅读建议
  const recommendation = useMemo(() => {
    // 构造一个简化的LevelEstimate用于获取建议
    const fakeEstimate = {
      estimatedLevel: level,
      confidence,
      levelBreakdown: {} as any,
      overallCharRate,
      overallVocabRate,
      charTested,
      charCorrect,
      vocabTested,
      vocabCorrect,
    };
    return getReadingRecommendation(fakeEstimate);
  }, [level, confidence, overallCharRate, overallVocabRate, charTested, charCorrect, vocabTested, vocabCorrect]);

  // 置信度描述
  const confLabel = {
    low: '快速估测',
    medium: '初步评估',
    high: '较稳定评估',
  }[confidence];

  // 下一级别
  const levels: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  const nextLevel = levels[levels.indexOf(level) + 1] || null;

  return (
    <div className="min-h-screen pb-8" style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFE5D9 100%)' }}>
      <div className="max-w-md mx-auto px-6 pt-8">
        {/* 顶部标题 */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🎉</div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2" style={{ fontFamily: 'ZCOOL KuaiLe, cursive' }}>
            测试完成！
          </h1>
          <p className="text-gray-600 text-sm">
            {confLabel} · 仅供参考 · 不等同于完整测评
          </p>
        </div>

        {/* 核心等级展示 */}
        <div className="bg-white rounded-3xl p-8 shadow-xl mb-6 text-center">
          <p className="text-sm text-gray-500 mb-2">你的中文阅读基础大约在</p>
          <div 
            className="text-5xl font-bold mb-2"
            style={{ color: '#FF6B35', fontFamily: 'ZCOOL KuaiLe, cursive' }}
          >
            {level}
          </div>
          <p className="text-lg text-gray-700 font-medium mb-4">{recommendation.title}</p>
          
          {/* 等级进度条 */}
          <div className="flex items-center gap-2 mb-4">
            {levels.map(l => {
              const idx = levels.indexOf(l);
              const currentIdx = levels.indexOf(level);
              const isPassed = idx <= currentIdx;
              const isCurrent = idx === currentIdx;
              return (
                <div key={l} className="flex-1 text-center">
                  <div 
                    className="w-full h-2 rounded-full mb-1"
                    style={{ backgroundColor: isPassed ? '#FF6B35' : '#E0E0E0' }}
                  />
                  <span 
                    className="text-xs"
                    style={{ 
                      color: isCurrent ? '#FF6B35' : isPassed ? '#4ECDC4' : '#B0B0B0',
                      fontWeight: isCurrent ? 'bold' : 'normal',
                    }}
                  >
                    {l.replace('SRC', '')}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="text-xs text-gray-400 italic">
            * 这是快速估测结果，完整测评结果更准确
          </div>
        </div>

        {/* 两个数据卡片 */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 shadow-md text-center">
            <div className="text-3xl mb-1">🔤</div>
            <div className="text-sm text-gray-500 mb-1">单字识别</div>
            <div 
              className="text-3xl font-bold mb-1"
              style={{ color: '#FF6B35', fontFamily: 'ZCOOL KuaiLe, cursive' }}
            >
              {Math.round(overallCharRate * 100)}%
            </div>
            <div className="text-xs text-gray-400">
              答对 {charCorrect} / {charTested} 字
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-md text-center">
            <div className="text-3xl mb-1">📚</div>
            <div className="text-sm text-gray-500 mb-1">词语识别</div>
            <div 
              className="text-3xl font-bold mb-1"
              style={{ color: '#4ECDC4', fontFamily: 'ZCOOL KuaiLe, cursive' }}
            >
              {Math.round(vocabMasteryRate * 100)}%
            </div>
            <div className="text-xs text-gray-400">
              答对 {vocabCorrect} / {vocabTested} 词
            </div>
          </div>
        </div>

        {/* 阅读建议 */}
        <div className="bg-white rounded-2xl p-6 shadow-md mb-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2" style={{ fontFamily: 'ZCOOL KuaiLe, cursive' }}>
            💡 阅读小建议
          </h3>
          <p className="text-gray-600 text-sm mb-4 leading-relaxed">
            {recommendation.description}
          </p>
          <div className="space-y-2">
            {recommendation.tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-sm flex-shrink-0" style={{ color: '#FFB347' }}>✦</span>
                <span className="text-sm text-gray-600">{tip}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 引导注册 */}
        <div className="rounded-2xl p-6 shadow-md mb-6" style={{ background: 'linear-gradient(135deg, #FFE66D, #FFB347)' }}>
          <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2" style={{ fontFamily: 'ZCOOL KuaiLe, cursive' }}>
            🌟 想保存测试结果？
          </h3>
          <p className="text-gray-700 text-sm mb-4">
            注册账号，开启完整中文成长之旅：
          </p>
          <ul className="text-sm text-gray-700 space-y-1 mb-4">
            <li>✓ 完整SRC级别测评</li>
            <li>✓ 成长地图长期跟踪</li>
            <li>✓ 个性化绘本推荐</li>
            <li>✓ 闯关游戏学中文</li>
          </ul>
          <button
            className="w-full py-3 text-white font-bold rounded-xl shadow-md transition-transform hover:scale-[1.02] active:scale-95"
            style={{ backgroundColor: '#FF6B35', fontFamily: 'ZCOOL KuaiLe, cursive' }}
            onClick={() => window.location.href = '/profile?mode=register'}
          >
            注册并保存结果 →
          </button>
        </div>

        {/* 下一步 */}
        {nextLevel && (
          <div className="bg-white rounded-2xl p-6 shadow-md mb-6 text-center">
            <div className="text-sm text-gray-500 mb-1">下一步可以试试</div>
            <div className="text-xl font-bold mb-2" style={{ color: '#FF6B35', fontFamily: 'ZCOOL KuaiLe, cursive' }}>
              完整SRC测字
            </div>
            <p className="text-sm text-gray-600 mb-4">
              更全面的字词测试，建立孩子的完整成长档案
            </p>
            <button
              className="w-full py-3 font-bold rounded-xl border-2 transition-transform hover:scale-[1.02] active:scale-95"
              style={{ 
                borderColor: '#FF6B35', 
                color: '#FF6B35',
                fontFamily: 'ZCOOL KuaiLe, cursive',
              }}
              onClick={() => window.location.href = '/profile?mode=full'}
            >
              开始完整测字
            </button>
          </div>
        )}

        {/* 返回 */}
        <div className="text-center">
          <button
            onClick={() => window.location.href = '/'}
            className="text-gray-500 hover:text-gray-700 text-sm underline"
          >
            ← 返回首页
          </button>
        </div>
      </div>
    </div>
  );
}
