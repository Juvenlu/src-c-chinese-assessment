'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { BookOpen, Gamepad2, Map, Sparkles, ChevronRight, Star, TrendingUp, Lightbulb, Heart, Award, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

/** SRC 等级对应的参考识字量 */
const LEVEL_CHAR_COUNT: Record<string, number> = {
  SRC100: 114,
  SRC300: 317,
  SRC500: 528,
  SRC800: 813,
};

/** 等级描述 */
const LEVEL_DESC: Record<string, { title: string; short: string; example: string }> = {
  SRC100: {
    title: '初识中文',
    short: '起步阶段',
    example: '能认出"一、二、三、人、口、手"等最常用字，亲子共读时能找到认识的字',
  },
  SRC300: {
    title: '初阶阅读',
    short: '打基础',
    example: '能读简单儿歌和短句绘本，比如"小鸟在天上飞"这样的句子',
  },
  SRC500: {
    title: '独立阅读萌芽',
    short: '可以读小故事',
    example: '能独立读100字左右的小故事，开始理解故事情节和人物关系',
  },
  SRC800: {
    title: '流利阅读',
    short: '接近母语',
    example: '能读章节书和简单科普，中文阅读接近国内低年级孩子水平',
  },
};

export default function StartPage() {
  const router = useRouter();
  const { user, activeChild, loading, latestResult } = useAuth();

  // 未登录重定向
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // latestResult 由 AuthContext 统一加载

  if (loading || !user || !activeChild) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-orange-50 to-amber-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">正在进入中文世界...</p>
        </div>
      </div>
    );
  }

  const hasResult = !!latestResult;
  const readingBase = latestResult?.reading_base ? `SRC${latestResult.reading_base}` : 'SRC100';
  const charLevel = latestResult?.character_level_u ? `SRC${latestResult.character_level_u}` : 'SRC100';
  const wordLevel = latestResult?.word_level_u ? `SRC${latestResult.word_level_u}` : 'SRC100';
  const recLevel = readingBase;
  const confidence = latestResult?.confidence || 'medium';
  const recDesc = `${readingBase}左右`;
  const baseDesc = LEVEL_DESC[readingBase]?.title;
  const levelInfo = LEVEL_DESC[readingBase] || LEVEL_DESC.SRC100;
  const baseCharCount = LEVEL_CHAR_COUNT[readingBase] || 100;
  const progressPercent = Math.min(100, Math.round((baseCharCount / 813) * 100));

  const confidenceMap: Record<string, { label: string; color: string }> = {
    high: { label: '高', color: 'bg-green-100 text-green-700 border-green-200' },
    medium: { label: '中', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    low: { label: '参考值', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  };
  const confInfo = confidenceMap[confidence] || confidenceMap.medium;

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50/50 via-amber-50/30 to-background pb-16">
      {/* 顶部欢迎 */}
      <div className="max-w-3xl mx-auto px-4 pt-10 pb-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-muted-foreground text-sm mb-1">👋 欢迎来到中文成长世界</p>
            <h1 className="text-3xl md:text-4xl font-bold text-foreground" style={{ fontFamily: 'var(--font-kuaile), sans-serif' }}>
              {activeChild.nickname}
            </h1>
            <p className="text-lg text-muted-foreground mt-2">
              从今天起，我们一起陪你读中文故事、认更多字 🌟
            </p>
          </div>
          <div className="text-right">
            <Badge variant="outline" className="bg-white/80 text-sm">
              {activeChild.age}岁 · {activeChild.grade}
            </Badge>
          </div>
        </div>
      </div>

      {/* 核心卡片：中文阅读起点 */}
      <div className="max-w-3xl mx-auto px-4 mb-6">
        <Card className="overflow-hidden border-2 shadow-lg">
          <div className="bg-gradient-to-r from-primary to-amber-500 text-white p-6">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-5 h-5" />
              <span className="text-sm font-medium opacity-90">你的中文阅读起点</span>
            </div>
            <div className="flex items-baseline gap-3">
              <h2 className="text-4xl md:text-5xl font-bold" style={{ fontFamily: 'var(--font-kuaile), sans-serif' }}>
                {readingBase}
              </h2>
              <span className="text-lg opacity-90">· {levelInfo.title}</span>
            </div>
            <p className="text-white/90 mt-2 text-sm">
              这是你目前能够比较稳定阅读的中文难度等级
            </p>
          </div>

          <CardContent className="p-6 space-y-5">
            {/* 三维指标 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 bg-muted/50 rounded-xl">
                <p className="text-xs text-muted-foreground mb-1">单字能力</p>
                <p className="text-xl font-bold text-primary">{charLevel}</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-xl">
                <p className="text-xs text-muted-foreground mb-1">词语能力</p>
                <p className="text-xl font-bold text-teal-600">{wordLevel}</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-xl">
                <p className="text-xs text-muted-foreground mb-1">阅读基础</p>
                <p className="text-xl font-bold text-amber-600">{readingBase}</p>
              </div>
            </div>

            {/* 成长进度条 */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">成长进度</span>
                <span className="font-medium">
                  约 {baseCharCount} 字 · 到达SRC800还需 {813 - baseCharCount} 字
                </span>
              </div>
              <Progress value={progressPercent} className="h-3" />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>SRC100</span>
                <span>SRC300</span>
                <span>SRC500</span>
                <span>SRC800</span>
              </div>
            </div>

            {/* 等级说明 */}
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-amber-900 mb-1">
                    什么是「{readingBase}水平」？
                  </p>
                  <p className="text-sm text-amber-800">
                    {levelInfo.example}
                  </p>
                </div>
              </div>
            </div>

            {/* 置信度 */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">测评置信度</span>
              <Badge variant="outline" className={confInfo.color}>
                {confInfo.label}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 下一步做什么 */}
      <div className="max-w-3xl mx-auto px-4 mb-6">
        <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          接下来做什么？
        </h3>

        <div className="space-y-3">
          {/* 读绘本 */}
          <Card className="hover:shadow-md transition-shadow cursor-pointer border-2 hover:border-primary/30"
            onClick={() => router.push('/book-select')}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white flex-shrink-0">
                <BookOpen className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-base">读中文绘本</h4>
                  <Badge className="bg-teal-100 text-teal-700 border-teal-200 hover:bg-teal-100">推荐</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  从 {recLevel} 难度的故事开始，每一页都有你认识的字，读起来刚刚好
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>

          {/* 闯关测试 */}
          <Card className="hover:shadow-md transition-shadow cursor-pointer border-2 hover:border-primary/30"
            onClick={() => router.push('/profile?mode=sampling')}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-primary flex items-center justify-center text-white flex-shrink-0">
                <Gamepad2 className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base">闯关识字</h4>
                <p className="text-sm text-muted-foreground mt-0.5">
                  8分钟小游戏，看看你能闯到第几关，还能挣星星和徽章
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>

          {/* 直接测字 */}
          <Card className="hover:shadow-md transition-shadow cursor-pointer border-2 hover:border-primary/30"
            onClick={() => router.push('/quicktest')}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center text-white flex-shrink-0">
                <TrendingUp className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base">再测一次</h4>
                <p className="text-sm text-muted-foreground mt-0.5">
                  过段时间再测一次，看看中文进步了多少
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>

          {/* 成长地图 */}
          <Card className="hover:shadow-md transition-shadow cursor-pointer border-2 hover:border-primary/30"
            onClick={() => router.push('/hub')}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white flex-shrink-0">
                <Map className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base">我的成长地图</h4>
                <p className="text-sm text-muted-foreground mt-0.5">
                  看看你的中文成长之路，历史记录都在这里
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 温馨提示 */}
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <Heart className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-rose-900 mb-1">给爸爸妈妈的话</p>
              <p className="text-sm text-rose-800 leading-relaxed">
                每个孩子的中文学习节奏都不一样。{activeChild.nickname} 现在的起点是{readingBase}，
                这是一件值得庆祝的事！保持每天读一点中文，孩子的中文能力会稳步成长。
                建议从「{recLevel}」难度的绘本开始，孩子读得懂、有成就感，就会越来越喜欢中文 💛
              </p>
            </div>
          </div>
        </div>

        {/* 开始按钮 */}
        <div className="mt-8 text-center">
          <Button
            size="lg"
            className="text-lg px-10 py-6 shadow-lg hover:shadow-xl"
            onClick={() => router.push('/book-select')}
          >
            开始读第一个故事
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
          <p className="text-sm text-muted-foreground mt-3">
            也可以从 <span className="text-primary font-medium cursor-pointer hover:underline"
              onClick={() => router.push('/hub')}>孩子的中文世界</span> 慢慢探索
          </p>
        </div>
      </div>
    </div>
  );
}
