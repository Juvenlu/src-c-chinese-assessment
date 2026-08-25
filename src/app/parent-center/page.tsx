"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Users, Plus, TrendingUp, BookOpen, Calendar, ChevronRight } from "lucide-react";

/**
 * 家长中心页面
 * - 显示所有孩子的成长概览
 * - 添加孩子入口
 * - 未来扩展：订阅管理、账单等
 */
export default function ParentCenterPage() {
  const router = useRouter();
  const { user, children, loading, setActiveChild, authFetch } = useAuth();

  const [showAddChild, setShowAddChild] = useState(false);
  const [childResults, setChildResults] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  // 加载每个孩子的最新测试结果
  useEffect(() => {
    if (!children || children.length === 0) return;
    children.forEach((kid) => {
      authFetch(`/api/quick-results?child_id=${kid.id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.results && data.results.length > 0) {
            setChildResults((prev) => ({ ...prev, [kid.id]: data.results[0] }));
          }
        })
        .catch(() => {});
    });
  }, [children, authFetch]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    );
  }

  const handleSelectChild = (child: any) => {
    setActiveChild(child);
    router.push("/hub");
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1
          className="mb-2 text-3xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          家长中心
        </h1>
        <p className="mb-8 text-muted-foreground">
          管理孩子的中文成长档案
        </p>

        {/* 家长信息卡 */}
        <div className="mb-8 rounded-3xl border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Users className="h-6 w-6" style={{ color: "var(--color-primary)" }} />
              </div>
              <div>
                <p className="font-bold text-foreground">{user.email}</p>
                <p className="text-sm text-muted-foreground">
                  {children.length} 个孩子 · {user.subscription_status === "free" ? "免费版" : user.subscription_status}
                </p>
              </div>
            </div>
            <Link
              href="/settings"
              className="text-sm font-medium"
              style={{ color: "var(--color-primary)" }}
            >
              账户设置 →
            </Link>
          </div>
        </div>

        {/* 孩子列表 */}
        <div className="mb-6 flex items-center justify-between">
          <h2
            className="text-xl font-bold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            我的孩子
          </h2>
          <button
            onClick={() => setShowAddChild(!showAddChild)}
            className="flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ backgroundColor: "var(--color-primary, #FF6B35)" }}
          >
            <Plus className="h-4 w-4" />
            添加孩子
          </button>
        </div>

        {/* 添加孩子表单 */}
        {showAddChild && (
          <AddChildForm
            onClose={() => setShowAddChild(false)}
            onAdded={() => {
              setShowAddChild(false);
              window.location.reload();
            }}
          />
        )}

        {/* 孩子卡片列表 */}
        <div className="space-y-4">
          {children.length === 0 ? (
            <div className="rounded-3xl border border-border bg-card p-12 text-center">
              <p className="text-muted-foreground">还没有添加孩子</p>
              <button
                onClick={() => setShowAddChild(true)}
                className="mt-4 text-sm font-medium"
                style={{ color: "var(--color-primary)" }}
              >
                + 添加第一个孩子
              </button>
            </div>
          ) : (
            children.map((child) => {
              const result = childResults[child.id];
              const readingBase = result?.reading_base || null;
              const confidence = result?.confidence || null;
              const testDate = result?.created_at
                ? new Date(result.created_at).toLocaleDateString("zh-CN")
                : null;

              return (
                <div
                  key={child.id}
                  className="flex items-center gap-4 rounded-3xl border border-border bg-card p-5 transition-all hover:shadow-md cursor-pointer"
                  onClick={() => handleSelectChild(child)}
                >
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold text-white"
                    style={{
                      backgroundColor: "var(--color-primary, #FF6B35)",
                      fontFamily: "var(--font-heading)",
                    }}
                  >
                    {child.nickname?.charAt(0) || "?"}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-foreground">
                        {child.nickname || "未命名"}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {child.age}岁 · {child.grade}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{child.country}</span>
                      {readingBase && (
                        <span className="flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" style={{ color: "var(--color-secondary)" }} />
                          SRC{readingBase}
                          {confidence && (
                            <span className="text-[10px] text-muted-foreground">
                              · 置信度{confidence === "high" ? "高" : confidence === "medium" ? "中" : "低"}
                            </span>
                          )}
                        </span>
                      )}
                      {testDate && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {testDate}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              );
            })
          )}
        </div>

        {/* 更多内容占位 */}
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-dashed border-border bg-card/50 p-6 text-center">
            <BookOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">阅读记录</p>
            <p className="mt-1 text-xs text-muted-foreground/70">敬请期待</p>
          </div>
          <div className="rounded-3xl border border-dashed border-border bg-card/50 p-6 text-center">
            <TrendingUp className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">闯关记录</p>
            <p className="mt-1 text-xs text-muted-foreground/70">敬请期待</p>
          </div>
        </div>
      </main>
    </div>
  );
}

// 添加孩子表单组件
function AddChildForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { authFetch } = useAuth();
  const [nickname, setNickname] = useState("");
  const [age, setAge] = useState(6);
  const [grade, setGrade] = useState("Kindergarten");
  const [country, setCountry] = useState("Canada");
  const [homeLanguage, setHomeLanguage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const gradeOptions = [
    "Kindergarten",
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
    "Grade 5",
    "Grade 6",
  ];

  const handleSubmit = async () => {
    if (!nickname.trim()) {
      setError("请输入孩子昵称");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await authFetch("/api/children", {
        method: "POST",
        body: JSON.stringify({
          nickname: nickname.trim(),
          age,
          grade,
          country,
          home_language: homeLanguage || null,
        }),
      });
      const data = await res.json();
      if (data.success || data.child) {
        onAdded();
      } else {
        setError(data.error || "创建失败");
      }
    } catch (e: any) {
      setError(e.message || "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-3xl border-2 border-dashed border-primary/30 bg-primary/5 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold text-foreground">添加新孩子</h3>
        <button
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          取消
        </button>
      </div>
      {error && (
        <p className="mb-3 text-sm text-red-500">{error}</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium text-foreground">孩子昵称 *</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
            placeholder="如：小明、Leo"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">年龄</label>
          <select
            value={age}
            onChange={(e) => setAge(Number(e.target.value))}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
          >
            {Array.from({ length: 12 }, (_, i) => i + 5).map((a) => (
              <option key={a} value={a}>{a}岁</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">年级</label>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
          >
            {gradeOptions.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium text-foreground">国家/地区</label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
          >
            {["Canada", "USA", "UK", "Australia", "Singapore", "Hong Kong", "Other"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <button
        onClick={handleSubmit}
        disabled={saving || !nickname.trim()}
        className="mt-4 w-full rounded-xl py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: "var(--color-primary, #FF6B35)" }}
      >
        {saving ? "添加中..." : "添加孩子"}
      </button>
    </div>
  );
}
