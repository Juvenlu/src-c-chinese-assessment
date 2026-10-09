"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import {
  BookOpen,
  Gamepad2,
  Map,
  ArrowRight,
  Sparkles,
  Star,
  TrendingUp,
  Clock,
  Trophy,
} from "lucide-react";

/**
 * 孩子的中文世界 — 登录后的首页
 * 三大模块：今日故事 / 今日闯关 / 我的成长
 */
export default function HubPage() {
  const router = useRouter();
  const { user, activeChild, loading, latestResult, assessmentStatus, authFetch } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  // 当前等级（confirmed 或 estimated），用于"我的SRC旅程"和"识字水平"
  const currentLevel = assessmentStatus?.current_level || 'SRC100';
  const currentLevelNum = parseInt(currentLevel.replace('SRC', ''), 10) || 100;

  // 推荐测试等级（reading_base 对应），用于今日故事推荐难度与"下一测试目标"
  // 有 formal confirmed_level：
  //   - SRC800（next_level 为 null，已封顶）→ 下一目标显示 SRC1200（待开放），仅文案，不开放测试
  //   - 其余 → 用 next_level
  // 无 formal → 回落 recommended_test_level（Quick/默认 SRC100）
  const recommendedLevel = assessmentStatus?.recommended_test_level || 'SRC100';
  const nextTestLevel =
    assessmentStatus?.confirmed_level
      ? assessmentStatus.confirmed_level === 'SRC800'
        ? 'SRC1200（待开放）'
        : assessmentStatus.next_level || recommendedLevel
      : recommendedLevel;
  // 推荐阅读基础：有 formal confirmed_level → 用 confirmed_level；否则回落 recommended_test_level
  const readingBaseLevel = assessmentStatus?.confirmed_level || recommendedLevel;

  // 词语水平：正式测试优先（取 formal 的词语掌握率+词汇量），其次 Quick Assessment
  // ⚠️ 识字水平和词语水平是两个独立指标，禁止用 currentLevel 直接推导词语等级
  const hasFormal = !!assessmentStatus?.formalResult;
  const formalResult = assessmentStatus?.formalResult;
  const quickWordLevelNum = latestResult?.word_level_l || latestResult?.word_level_u || 0;
  const quickWordLevelLabel = quickWordLevelNum > 0 ? `SRC${quickWordLevelNum}` : '未测';
  // 正式测试时，词语大标签用掌握率百分比展示（与识字等级标签区分，避免等级混淆）
  const wordLabel = hasFormal
    ? `${Math.round((formalResult?.vocab_mastery_rate ?? 0) * 100)}%`
    : quickWordLevelLabel;
  const wordLevelNum = hasFormal ? (formalResult?.stable_vocab_count ?? 0) : quickWordLevelNum;

  const readingBase = latestResult?.reading_base || 100;
  const confidence = latestResult?.confidence || "high";

  // 今日故事：当前孩子最新 Final AI 定制绘本
  const [todayStory, setTodayStory] = useState<{
    id: number;
    title: string;
    level: string;
    pages: string;
    coverColor: string;
  } | null>(null);
  const [todayStoryLoading, setTodayStoryLoading] = useState(true);
  // 今日故事空状态时跳转到绘本图书馆（带 childId）
  const bookSelectHref = activeChild?.id
    ? `/book-select?childId=${activeChild.id}`
    : "/book-select";
  const [todayStoryHref, setTodayStoryHref] = useState(bookSelectHref);

  // 当 activeChild 变化时，更新默认跳转链接（空状态 fallback）
  useEffect(() => {
    setTodayStoryHref(bookSelectHref);
  }, [bookSelectHref]);

  useEffect(() => {
    if (!activeChild?.id) return;
    let cancelled = false;
    authFetch(`/api/books/rewrites?child_id=${activeChild.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const rewrites = data.rewrites || [];
        if (rewrites.length > 0) {
          const latest = rewrites[0];
          const title = latest.episode_title
            ? `${latest.series_name || "故事"}·${latest.episode_title}`
            : `${latest.series_name || "故事"} 第${latest.episode_number}集`;
          setTodayStory({
            id: latest.id,
            title,
            level: latest.target_level || recommendedLevel,
            pages: `约${latest.page_count || 10}页`,
            coverColor: "#FFE66D",
          });
          setTodayStoryHref(`/book-rewrite/${latest.id}`);
        } else {
          setTodayStory({
            id: 0,
            title: "探索你的第一本中文故事",
            level: recommendedLevel,
            pages: "即将开始",
            coverColor: "#FFE66D",
          });
          setTodayStoryHref(bookSelectHref);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTodayStoryHref(bookSelectHref);
        }
      })
      .finally(() => {
        if (!cancelled) setTodayStoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeChild?.id, recommendedLevel]);

  // 今日闯关（暂时不开放）
  const gameDisabled = true;

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    );
  }

  // P2 全局门控由 GlobalChildGate 统一接管（多孩子未选时显示选择界面）。
  // 此处仅处理零孩子账号的创建引导。
  if (!activeChild) {
    // 已登录但无任何孩子：走现有"创建孩子"提示流程
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          欢迎加入 SRC-C！
        </h1>
        <p className="text-muted-foreground">请先为小朋友创建档案，开启中文阅读之旅。</p>
        <Link
          href="/profile"
          className="rounded-full px-8 py-3 text-base font-bold text-white transition-transform hover:scale-105"
          style={{ backgroundColor: "var(--color-primary, #FF6B35)" }}
        >
          创建孩子档案
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* 欢迎区域 */}
        <div className="mb-8">
          <h1
            className="text-3xl font-bold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            👋 欢迎回来，{activeChild.nickname}！
          </h1>
          <p className="mt-2 text-muted-foreground">
            今天也要一起探索中文世界哦～
          </p>
        </div>

        {/* 三个核心模块 */}
        <div className="grid gap-6 md:grid-cols-3">
          {/* 📚 今日故事 */}
          <Link
            href={todayStoryHref}
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-6 transition-all hover:scale-[1.02] hover:shadow-lg"
          >
            <div
              className="mb-4 flex h-32 w-full items-center justify-center rounded-2xl"
              style={{ backgroundColor: todayStory ? `${todayStory.coverColor}33` : "#FFE66D33" }}
            >
              {todayStoryLoading ? (
                <div className="h-6 w-24 animate-pulse rounded bg-muted" />
              ) : (
                <BookOpen
                  className="h-12 w-12"
                  style={{ color: todayStory?.coverColor || "#FFE66D" }}
                />
              )}
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              📚 今日故事
            </p>
            <h3 className="mb-2 text-lg font-bold text-foreground">
              {todayStoryLoading ? (
                <span className="inline-block h-5 w-32 animate-pulse rounded bg-muted" />
              ) : (
                todayStory?.title
              )}
            </h3>
            <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="rounded-full px-2 py-0.5 font-medium"
                style={{ backgroundColor: "var(--color-primary, #FF6B35)22", color: "var(--color-primary, #FF6B35)" }}
              >
                推荐 {todayStory?.level || recommendedLevel}
              </span>
              <span>{todayStory?.pages || "约10页"}</span>
            </div>
            <div className="flex items-center gap-1 text-sm font-medium"
              style={{ color: "var(--color-primary, #FF6B35)" }}
            >
              开始阅读
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          {/* 🎮 今日闯关（暂时不开放） */}
          <div
            className={`relative overflow-hidden rounded-3xl border border-border bg-card p-6 ${
              gameDisabled
                ? "cursor-not-allowed opacity-50 grayscale"
                : "group transition-all hover:scale-[1.02] hover:shadow-lg"
            }`}
          >
            <div className="mb-4 flex h-32 w-full items-center justify-center rounded-2xl bg-muted">
              <Gamepad2 className="h-12 w-12 text-muted-foreground" />
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              🎮 今日闯关
            </p>
            <h3 className="mb-2 text-lg font-bold text-foreground">
              字形小侦探
            </h3>
            <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                {currentLevel}
              </span>
              <span>10 道题</span>
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-muted-foreground" />
                +50 XP
              </span>
            </div>
            <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              即将开放
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs">敬请期待</span>
            </div>
          </div>

          {/* 🗺️ 我的成长 */}
          <Link
            href="/growth-map"
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-6 transition-all hover:scale-[1.02] hover:shadow-lg"
          >
            <div className="mb-4 flex h-32 w-full items-center justify-center rounded-2xl"
              style={{ backgroundColor: "var(--color-primary, #FF6B35)15" }}
            >
              <div className="text-center">
                  <p
                    className="text-3xl font-bold"
                    style={{ fontFamily: "var(--font-heading)", color: "var(--color-primary, #FF6B35)" }}
                  >
                    {currentLevel}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">当前中文等级</p>
                </div>
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              🗺️ 我的成长
            </p>
            <h3 className="mb-2 text-lg font-bold text-foreground">
              中文成长地图
            </h3>
            <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3" style={{ color: "var(--color-secondary, #4ECDC4)" }} />
              <span>识字量约 {currentLevelNum} 字</span>
            </div>
            <div className="flex items-center gap-1 text-sm font-medium"
              style={{ color: "var(--color-primary, #FF6B35)" }}
            >
              查看成长地图
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        </div>

        {/* 成长速览卡片 */}
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {/* 当前等级进度 */}
          <div className="rounded-3xl border border-border bg-card p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-foreground">
              <Trophy
                className="h-5 w-5"
                style={{ color: "var(--color-accent, #FFE66D)" }}
              />
              我的SRC旅程
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              下一测试目标：<span className="font-semibold text-foreground">{nextTestLevel}</span>
              <span className="mx-2">·</span>
              点击任意等级开始测试
            </p>
            <div className="space-y-3">
              {[100, 300, 500, 800].map((level, i) => {
                const levelKey = `SRC${level}` as const;
                const isCompleted = currentLevelNum >= level;
                const isCurrent = currentLevelNum >= level && currentLevelNum < (level === 800 ? 1200 : [300, 500, 800, 1200][i]);
                const isRecommended = nextTestLevel === levelKey;
                return (
                  <button
                    key={level}
                    onClick={() => router.push(`/fulltest?level=${levelKey}`)}
                    className="w-full rounded-2xl border border-border bg-muted/30 p-4 text-left transition-all hover:border-primary/50 hover:bg-primary/5 active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          isCompleted
                            ? "text-white"
                            : "bg-muted text-muted-foreground"
                        }`}
                        style={isCompleted ? { backgroundColor: "var(--color-secondary, #4ECDC4)" } : {}}
                      >
                        {isCompleted ? "✓" : level}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-sm font-medium ${
                              isCurrent ? "text-foreground" : isCompleted ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            SRC{level}
                            {isCurrent && (
                              <span className="ml-2 text-xs"
                                style={{ color: "var(--color-primary, #FF6B35)" }}
                              >
                                · 当前
                              </span>
                            )}
                            {isRecommended && !isCurrent && (
                              <span className="ml-2 text-xs"
                                style={{ color: "var(--color-secondary, #4ECDC4)" }}
                              >
                                · 推荐
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {level}字
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: isCompleted ? "100%" : isCurrent ? `${Math.min(100, ((currentLevelNum - level) / 200) * 100)}%` : "0%",
                              backgroundColor: "var(--color-secondary, #4ECDC4)",
                            }}
                          />
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 三项核心指标 */}
          <div className="rounded-3xl border border-border bg-card p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-foreground">
              <Star
                className="h-5 w-5"
                style={{ color: "var(--color-accent, #FFE66D)" }}
              />
              三项核心指标
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm text-muted-foreground">识字水平</p>
                  <p
                    className="text-2xl font-bold"
                    style={{ fontFamily: "var(--font-heading)", color: "var(--color-primary, #FF6B35)" }}
                  >
                    {currentLevel}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {hasFormal && assessmentStatus?.formalResult ? (
                    <>
                      <p>约 {assessmentStatus.formalResult.stable_char_count} 字</p>
                      <p>掌握率 {Math.round(assessmentStatus.formalResult.character_mastery_rate * 100)}%</p>
                      <p>单字识别</p>
                    </>
                  ) : (
                    <>
                      <p>约 {currentLevelNum} 字</p>
                      <p>单字识别</p>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm text-muted-foreground">词语水平</p>
                  <p
                    className="text-2xl font-bold"
                    style={{ fontFamily: "var(--font-heading)", color: "var(--color-secondary, #4ECDC4)" }}
                  >
                    {wordLabel}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {hasFormal && assessmentStatus?.formalResult ? (
                    <>
                      <p>约 {assessmentStatus.formalResult.stable_vocab_count} 词</p>
                      <p>掌握率 {Math.round(assessmentStatus.formalResult.vocab_mastery_rate * 100)}%</p>
                      <p>词语识别</p>
                    </>
                  ) : (
                    <>
                      {quickWordLevelNum > 0 ? (
                        <>
                          <p>约 {quickWordLevelNum} 词</p>
                          <p>词语理解</p>
                        </>
                      ) : (
                        <p>待测评</p>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm text-muted-foreground">推荐阅读基础</p>
                  <p
                    className="text-2xl font-bold"
                    style={{ fontFamily: "var(--font-heading)", color: "#6366f1" }}
                  >
                    {readingBaseLevel}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>独立阅读起点</p>
                  <p>置信度：{confidence === "high" ? "高" : confidence === "medium" ? "中" : "低"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
