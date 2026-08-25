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
  const { user, activeChild, loading } = useAuth();
  const [latestResult, setLatestResult] = useState<any>(null);
  const [resultLoading, setResultLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  // 拉取最新测评结果
  useEffect(() => {
    if (!activeChild) return;
    fetch("/api/quick-results")
      .then((r) => r.json())
      .then((data) => {
        if (data.results && data.results.length > 0) {
          setLatestResult(data.results[0]);
        }
      })
      .finally(() => setResultLoading(false));
  }, [activeChild]);

  if (loading || !user || !activeChild) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    );
  }

  const charLevel = latestResult?.character_level_l || latestResult?.character_level_u || 100;
  const wordLevel = latestResult?.word_level_l || latestResult?.word_level_u || 100;
  const readingBase = latestResult?.reading_base || 100;
  const confidence = latestResult?.confidence || "high";

  // 推荐绘本（模拟数据，未来接真实接口）
  const recommendedBook = {
    title: "三只小猪",
    level: `SRC${readingBase}`,
    pages: 12,
    readTime: "8分钟",
    coverColor: "#FFE66D",
  };

  // 今日闯关推荐
  const todayGame = {
    title: "字形小侦探",
    level: `SRC${charLevel}`,
    questions: 10,
    xpReward: 50,
  };

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
            href="/books"
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-6 transition-all hover:scale-[1.02] hover:shadow-lg"
          >
            <div
              className="mb-4 flex h-32 w-full items-center justify-center rounded-2xl"
              style={{ backgroundColor: `${recommendedBook.coverColor}33` }}
            >
              <BookOpen
                className="h-12 w-12"
                style={{ color: recommendedBook.coverColor }}
              />
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              📚 今日故事
            </p>
            <h3 className="mb-2 text-lg font-bold text-foreground">
              {recommendedBook.title}
            </h3>
            <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span
                className="rounded-full px-2 py-0.5 font-medium"
                style={{ backgroundColor: "var(--color-primary, #FF6B35)22", color: "var(--color-primary, #FF6B35)" }}
              >
                {recommendedBook.level}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {recommendedBook.readTime}
              </span>
              <span>{recommendedBook.pages}页</span>
            </div>
            <div className="flex items-center gap-1 text-sm font-medium"
              style={{ color: "var(--color-primary, #FF6B35)" }}
            >
              开始阅读
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          {/* 🎮 今日闯关 */}
          <Link
            href="/game"
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-6 transition-all hover:scale-[1.02] hover:shadow-lg"
          >
            <div className="mb-4 flex h-32 w-full items-center justify-center rounded-2xl"
              style={{ backgroundColor: "var(--color-secondary, #4ECDC4)22" }}
            >
              <Gamepad2
                className="h-12 w-12"
                style={{ color: "var(--color-secondary, #4ECDC4)" }}
              />
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              🎮 今日闯关
            </p>
            <h3 className="mb-2 text-lg font-bold text-foreground">
              {todayGame.title}
            </h3>
            <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span
                className="rounded-full px-2 py-0.5 font-medium"
                style={{ backgroundColor: "var(--color-secondary, #4ECDC4)22", color: "var(--color-secondary, #4ECDC4)" }}
              >
                {todayGame.level}
              </span>
              <span>{todayGame.questions} 道题</span>
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" style={{ color: "var(--color-accent, #FFE66D)" }} />
                +{todayGame.xpReward} XP
              </span>
            </div>
            <div className="flex items-center gap-1 text-sm font-medium"
              style={{ color: "var(--color-secondary, #4ECDC4)" }}
            >
              开始挑战
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

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
                  SRC{readingBase}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">中文阅读基础</p>
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
              <span>识字量 {charLevel} ~ {charLevel + 200}</span>
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
            <div className="space-y-4">
              {[100, 300, 500, 800].map((level, i) => {
                const isCompleted = readingBase >= level;
                const isCurrent = readingBase >= level && readingBase < (level === 800 ? 1200 : [300, 500, 800, 1200][i]);
                return (
                  <div key={level} className="flex items-center gap-4">
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
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {level}字
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: isCompleted ? "100%" : isCurrent ? `${Math.min(100, ((readingBase - level) / 200) * 100)}%` : "0%",
                            backgroundColor: "var(--color-secondary, #4ECDC4)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
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
                    SRC{charLevel}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>约 {charLevel} 字</p>
                  <p>单字识别</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm text-muted-foreground">词语水平</p>
                  <p
                    className="text-2xl font-bold"
                    style={{ fontFamily: "var(--font-heading)", color: "var(--color-secondary, #4ECDC4)" }}
                  >
                    SRC{wordLevel}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>约 {wordLevel} 词</p>
                  <p>词语理解</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm text-muted-foreground">阅读基础</p>
                  <p
                    className="text-2xl font-bold"
                    style={{ fontFamily: "var(--font-heading)", color: "#6366f1" }}
                  >
                    SRC{readingBase}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>独立阅读</p>
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
