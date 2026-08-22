'use client';

/**
 * 中文成长地图页面
 * 
 * 这是V1.0的核心输出页面，展示孩子的：
 * - 当前SRC等级与三维度掌握度
 * - 基础/教材识字（人教版）
 * - 阅读高频识字（SRC）
 * - 词组掌握
 * - 下一步行动推荐
 * - 未来模块预留（闯关/阅读/输出）
 * 
 * 设计原则：
 * - 不改变现有UI视觉设计（沿用暖橘色主题 + 卡通风格）
 * - 儿童端简洁，家长端详细
 */

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Star, Trophy, BookOpen, Gamepad2, PenTool, ArrowRight, ChevronRight, Lock, Sparkles, TrendingUp, Target, Award } from 'lucide-react';
import type { Level, GrowthMapData } from '@/lib/types';
import { LEVEL_CONFIG } from '@/lib/types';

function GrowthMapContent() {
  const searchParams = useSearchParams();
  const childId = searchParams.get('childId') || '';
  const level = (searchParams.get('level') || 'SRC300') as Level;
  const charMastery = parseInt(searchParams.get('charMastery') || '75');
  const vocabMastery = parseInt(searchParams.get('vocabMastery') || '65');
  const knownCount = parseInt(searchParams.get('known') || '0');
  const totalChar = parseInt(searchParams.get('total') || '300');
  const mode = searchParams.get('mode') || 'full';

  const [viewMode, setViewMode] = useState<'child' | 'parent'>('parent');
  const [loading, setLoading] = useState(true);
  const [growthData, setGrowthData] = useState<GrowthMapData | null>(null);

  useEffect(() => {
    // 模拟生成成长地图数据
    // 实际项目中从 /api/growth-map 获取
    const rjbMastery = Math.round(charMastery * 0.92); // 人教版略低于SRC
    const nextLevel = getNextLevel(level);

    const data: GrowthMapData = {
      childId,
      currentLevel: level,
      srcMastery: {
        level,
        mastered: knownCount,
        learning: Math.round(totalChar * 0.15),
        untested: totalChar - knownCount - Math.round(totalChar * 0.15),
        masteryRate: charMastery / 100,
      },
      rjbMastery: {
        level: getRJBLevel(level),
        mastered: Math.round(totalChar * (rjbMastery / 100)),
        total: getRJBCharTotal(level),
        masteryRate: rjbMastery / 100,
      },
      vocabMastery: {
        mastered: Math.round(knownCount * 2.86 * (vocabMastery / 100)),
        tested: Math.round(knownCount * 2.86),
        masteryRate: vocabMastery / 100,
      },
      nextLevel,
      trend: {
        charMastery: [
          { date: '2026-06', rate: 0.58 },
          { date: '2026-08', rate: 0.68 },
          { date: '2026-10', rate: charMastery / 100 },
        ],
        vocabMastery: [
          { date: '2026-06', rate: 0.45 },
          { date: '2026-08', rate: 0.56 },
          { date: '2026-10', rate: vocabMastery / 100 },
        ],
      },
      strengths: generateStrengths(charMastery, vocabMastery),
      areasToImprove: generateAreasToImprove(charMastery, vocabMastery),
      recommendations: generateRecommendations(level, charMastery, vocabMastery),
    };

    setGrowthData(data);
    setLoading(false);
  }, [childId, level, charMastery, vocabMastery, knownCount, totalChar]);

  if (loading || !growthData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFF8F0]">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#FF6B35] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#636E72]">正在生成成长地图...</p>
        </div>
      </div>
    );
  }

  const levelConfig = LEVEL_CONFIG[level];

  return (
    <div className="min-h-screen bg-[#FFF8F0] py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* 顶部标题 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-[#2D3436] mb-2" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
            🌟 我的中文成长地图
          </h1>
          <p className="text-[#636E72]">记录每一步成长，点亮中文世界</p>
        </div>

        {/* 当前等级大徽章 */}
        <div className="bg-white rounded-3xl p-8 mb-6 shadow-lg border-2 border-[#FFE66D]/30">
          <div className="flex items-center justify-center gap-6 mb-6">
            <div className="w-24 h-24 bg-gradient-to-br from-[#FF6B35] to-[#FFE66D] rounded-full flex items-center justify-center shadow-lg">
              <Trophy className="w-12 h-12 text-white" />
            </div>
            <div className="text-center">
              <p className="text-[#636E72] text-sm mb-1">当前阅读等级</p>
              <h2 className="text-5xl font-bold text-[#FF6B35]" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
                {level}
              </h2>
              <p className="text-[#4ECDC4] font-semibold">{levelConfig.label}</p>
            </div>
          </div>

          {/* 等级进度条 */}
          {growthData.nextLevel && (
            <div className="mt-4">
              <div className="flex justify-between text-sm text-[#636E72] mb-2">
                <span>{level}</span>
                <span>→ {growthData.nextLevel}</span>
              </div>
              <div className="h-4 bg-[#FFF8F0] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[#4ECDC4] to-[#FFE66D] rounded-full transition-all duration-1000"
                  style={{ width: `${growthData.srcMastery.masteryRate * 100}%` }}
                />
              </div>
              <p className="text-center text-sm text-[#636E72] mt-2">
                已完成 {Math.round(growthData.srcMastery.masteryRate * 100)}%，加油向 {growthData.nextLevel} 进发！
              </p>
            </div>
          )}
        </div>

        {/* 三维度掌握度卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* 基础识字 */}
          <div className="bg-white rounded-2xl p-6 shadow-md">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 bg-[#4ECDC4]/20 rounded-full flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-[#4ECDC4]" />
              </div>
              <div>
                <h3 className="font-bold text-[#2D3436]">基础识字</h3>
                <p className="text-xs text-[#636E72]">人教版</p>
              </div>
            </div>
            <div className="text-center mb-3">
              <span className="text-4xl font-bold text-[#4ECDC4]" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
                {Math.round(growthData.rjbMastery.masteryRate * 100)}%
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#4ECDC4] rounded-full transition-all duration-1000"
                style={{ width: `${growthData.rjbMastery.masteryRate * 100}%` }}
              />
            </div>
            <p className="text-xs text-[#636E72] mt-2 text-center">
              {growthData.rjbMastery.mastered} / {growthData.rjbMastery.total} 字
            </p>
          </div>

          {/* 阅读高频识字 */}
          <div className="bg-white rounded-2xl p-6 shadow-md">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[#FF6B35]" />
              </div>
              <div>
                <h3 className="font-bold text-[#2D3436]">阅读识字</h3>
                <p className="text-xs text-[#636E72]">SRC高频字</p>
              </div>
            </div>
            <div className="text-center mb-3">
              <span className="text-4xl font-bold text-[#FF6B35]" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
                {Math.round(growthData.srcMastery.masteryRate * 100)}%
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#FF6B35] rounded-full transition-all duration-1000"
                style={{ width: `${growthData.srcMastery.masteryRate * 100}%` }}
              />
            </div>
            <p className="text-xs text-[#636E72] mt-2 text-center">
              {growthData.srcMastery.mastered} / {levelConfig.charCount} 字
            </p>
          </div>

          {/* 词组掌握 */}
          <div className="bg-white rounded-2xl p-6 shadow-md">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 bg-[#FFE66D]/40 rounded-full flex items-center justify-center">
                <Star className="w-5 h-5 text-[#E6B800]" />
              </div>
              <div>
                <h3 className="font-bold text-[#2D3436]">词组掌握</h3>
                <p className="text-xs text-[#636E72]">高频词汇</p>
              </div>
            </div>
            <div className="text-center mb-3">
              <span className="text-4xl font-bold text-[#E6B800]" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
                {Math.round(growthData.vocabMastery.masteryRate * 100)}%
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#FFE66D] rounded-full transition-all duration-1000"
                style={{ width: `${growthData.vocabMastery.masteryRate * 100}%` }}
              />
            </div>
            <p className="text-xs text-[#636E72] mt-2 text-center">
              {growthData.vocabMastery.mastered} / {growthData.vocabMastery.tested} 词
            </p>
          </div>
        </div>

        {/* 优势与建议 */}
        {viewMode === 'parent' && (
          <div className="bg-white rounded-2xl p-6 mb-6 shadow-md">
            <h3 className="font-bold text-[#2D3436] text-lg mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-[#FF6B35]" />
              综合分析
            </h3>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold text-[#4ECDC4] mb-2 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> 当前优势
                </h4>
                <ul className="space-y-2">
                  {growthData.strengths.map((s, i) => (
                    <li key={i} className="text-sm text-[#2D3436] flex items-start gap-2">
                      <span className="text-[#4ECDC4] mt-0.5">✓</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-[#FF6B35] mb-2 flex items-center gap-2">
                  <Award className="w-4 h-4" /> 需要加强
                </h4>
                <ul className="space-y-2">
                  {growthData.areasToImprove.map((a, i) => (
                    <li key={i} className="text-sm text-[#2D3436] flex items-start gap-2">
                      <span className="text-[#FFE66D] mt-0.5">★</span>
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* 成长趋势图 */}
        {viewMode === 'parent' && growthData.trend.charMastery.length > 1 && (
          <div className="bg-white rounded-2xl p-6 mb-6 shadow-md">
            <h3 className="font-bold text-[#2D3436] text-lg mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-[#4ECDC4]" />
              成长趋势
            </h3>
            <div className="h-40 flex items-end gap-6 justify-around px-4">
              {growthData.trend.charMastery.map((item, i) => (
                <div key={i} className="flex flex-col items-center">
                  <div className="text-xs text-[#636E72] mb-1">
                    {Math.round(item.rate * 100)}%
                  </div>
                  <div 
                    className="w-12 bg-gradient-to-t from-[#FF6B35] to-[#FFE66D] rounded-t-lg transition-all duration-700"
                    style={{ height: `${item.rate * 120}px` }}
                  />
                  <div className="text-xs text-[#636E72] mt-2">{item.date}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-[#636E72] text-center mt-3">单字掌握度变化</p>
          </div>
        )}

        {/* 下一步行动 */}
        <div className="bg-white rounded-2xl p-6 mb-6 shadow-md">
          <h3 className="font-bold text-[#2D3436] text-lg mb-4">🎯 下一步行动</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link 
              href={`/test?level=${level}&childId=${childId}`}
              className="block p-4 bg-[#FF6B35]/10 rounded-xl hover:bg-[#FF6B35]/20 transition-colors group"
            >
              <Gamepad2 className="w-8 h-8 text-[#FF6B35] mb-2" />
              <h4 className="font-bold text-[#2D3436]">抽测闯关</h4>
              <p className="text-xs text-[#636E72] mt-1">四部分综合测试</p>
              <ChevronRight className="w-4 h-4 text-[#FF6B35] mt-2 group-hover:translate-x-1 transition-transform" />
            </Link>
            
            <Link 
              href="/book-select"
              className="block p-4 bg-[#4ECDC4]/10 rounded-xl hover:bg-[#4ECDC4]/20 transition-colors group"
            >
              <BookOpen className="w-8 h-8 text-[#4ECDC4] mb-2" />
              <h4 className="font-bold text-[#2D3436]">定制绘本</h4>
              <p className="text-xs text-[#636E72] mt-1">个性化中文阅读</p>
              <ChevronRight className="w-4 h-4 text-[#4ECDC4] mt-2 group-hover:translate-x-1 transition-transform" />
            </Link>
            
            <Link 
              href={`/fulltest?level=${level}&childId=${childId}`}
              className="block p-4 bg-[#FFE66D]/30 rounded-xl hover:bg-[#FFE66D]/50 transition-colors group"
            >
              <Target className="w-8 h-8 text-[#E6B800] mb-2" />
              <h4 className="font-bold text-[#2D3436]">逐字复测</h4>
              <p className="text-xs text-[#636E72] mt-1">巩固薄弱汉字</p>
              <ChevronRight className="w-4 h-4 text-[#E6B800] mt-2 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

        {/* 未来模块预留 */}
        <div className="bg-white rounded-2xl p-6 mb-6 shadow-md">
          <h3 className="font-bold text-[#2D3436] text-lg mb-4">🚀 成长路线图</h3>
          <div className="space-y-3">
            {/* 闯关 - 已开放占位 */}
            <div className="flex items-center gap-4 p-4 bg-[#FFF8F0] rounded-xl">
              <div className="w-12 h-12 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                <Gamepad2 className="w-6 h-6 text-[#FF6B35]" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-[#2D3436]">闯关成长区</h4>
                <p className="text-sm text-[#636E72]">词语理解 · 句子理解 · 阅读理解</p>
              </div>
              <div className="flex items-center gap-1 text-xs text-[#636E72] bg-white px-3 py-1 rounded-full">
                <Lock className="w-3 h-3" />
                即将开放
              </div>
            </div>

            {/* 阅读 */}
            <div className="flex items-center gap-4 p-4 bg-[#FFF8F0] rounded-xl">
              <div className="w-12 h-12 bg-[#4ECDC4]/20 rounded-full flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-[#4ECDC4]" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-[#2D3436]">我的中文阅读</h4>
                <p className="text-sm text-[#636E72]">阅读数量 · 阅读质量 · 生词记录</p>
              </div>
              <div className="flex items-center gap-1 text-xs text-[#636E72] bg-white px-3 py-1 rounded-full">
                <Lock className="w-3 h-3" />
                即将开放
              </div>
            </div>

            {/* 输出 */}
            <div className="flex items-center gap-4 p-4 bg-[#FFF8F0] rounded-xl">
              <div className="w-12 h-12 bg-[#FFE66D]/40 rounded-full flex items-center justify-center">
                <PenTool className="w-6 h-6 text-[#E6B800]" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-[#2D3436]">中文输出</h4>
                <p className="text-sm text-[#636E72]">朗读 · 口语 · 复述 · 写作</p>
              </div>
              <div className="flex items-center gap-1 text-xs text-[#636E72] bg-white px-3 py-1 rounded-full">
                <Lock className="w-3 h-3" />
                即将开放
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
          <Link 
            href="/"
            className="px-8 py-3 bg-white text-[#FF6B35] border-2 border-[#FF6B35] rounded-full font-bold hover:bg-[#FFF8F0] transition-colors text-center"
          >
            返回首页
          </Link>
          <button
            onClick={() => setViewMode(viewMode === 'child' ? 'parent' : 'child')}
            className="px-8 py-3 bg-[#4ECDC4] text-white rounded-full font-bold hover:bg-[#3DBDB5] transition-colors"
          >
            {viewMode === 'child' ? '查看家长版' : '查看儿童版'}
          </button>
        </div>

        <p className="text-center text-xs text-[#636E72] mt-6">
          SRC-C 中文成长评估系统 · 每一个字都是成长的脚印
        </p>
      </div>
    </div>
  );
}

// 辅助函数
function getNextLevel(level: Level): Level | undefined {
  const levels: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  const idx = levels.indexOf(level);
  return idx < levels.length - 1 ? levels[idx + 1] : undefined;
}

function getRJBLevel(level: Level): 'RJB100' | 'RJB300' | 'RJB500' | 'RJB800' {
  const map: Record<Level, 'RJB100' | 'RJB300' | 'RJB500' | 'RJB800'> = {
    SRC100: 'RJB100',
    SRC300: 'RJB300',
    SRC500: 'RJB500',
    SRC800: 'RJB800',
  };
  return map[level];
}

function getRJBCharTotal(level: Level): number {
  const map: Record<Level, number> = {
    SRC100: 100,
    SRC300: 300,
    SRC500: 499,
    SRC800: 799,
  };
  return map[level];
}

function generateStrengths(charRate: number, vocabRate: number): string[] {
  const strengths: string[] = [];
  if (charRate >= 80) {
    strengths.push('单字基础扎实，已达到同级别上等水平');
  } else if (charRate >= 60) {
    strengths.push('单字掌握稳步提升中，基础框架已建立');
  }
  if (vocabRate >= 70) {
    strengths.push('词组理解能力强，能够在语境中灵活运用');
  }
  if (charRate > vocabRate + 10) {
    strengths.push('识字量增长较快，阅读接触广泛');
  }
  if (strengths.length < 2) {
    strengths.push('学习态度积极，每次测试都有新进步');
  }
  return strengths.slice(0, 3);
}

function generateAreasToImprove(charRate: number, vocabRate: number): string[] {
  const areas: string[] = [];
  if (vocabRate < charRate - 10) {
    areas.push('词组应用需要加强，建议多阅读加强词语积累');
  }
  if (charRate < 70) {
    areas.push('核心高频字需要继续巩固，建议每日坚持识字练习');
  }
  if (charRate < 50) {
    areas.push('基础字库覆盖面需要扩大，建议从SRC低一级别巩固');
  }
  areas.push('建议通过阅读在真实语境中加深对汉字的理解');
  return areas.slice(0, 3);
}

function generateRecommendations(level: Level, charRate: number, vocabRate: number): string[] {
  const recs: string[] = [];
  if (charRate >= 80 && vocabRate >= 70) {
    recs.push('可以尝试更高一级的绘本阅读');
  }
  recs.push('每日15分钟中文绘本阅读');
  recs.push('每周1次完整测字，跟踪成长进度');
  if (vocabRate < 60) {
    recs.push('增加词汇专项练习');
  }
  return recs;
}

export default function GrowthMapPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#FFF8F0]">
      <div className="text-center text-[#636E72]">加载中...</div>
    </div>}>
      <GrowthMapContent />
    </Suspense>
  );
}
