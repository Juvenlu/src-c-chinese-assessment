"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/AppHeader";
import { Settings, User, Lock, Save, Eye, EyeOff, Mail } from "lucide-react";

/**
 * 账户设置页面
 * - 家长邮箱
 * - 修改密码
 * - 孩子资料（昵称、年龄、年级、国家、语言环境）
 */
export default function SettingsPage() {
  const router = useRouter();
  const { user, activeChild, loading, authFetch } = useAuth();

  const [activeTab, setActiveTab] = useState<"password" | "child">("child");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 孩子资料
  const [nickname, setNickname] = useState("");
  const [age, setAge] = useState(7);
  const [grade, setGrade] = useState("Grade 1");
  const [country, setCountry] = useState("Canada");
  const [homeLanguage, setHomeLanguage] = useState("");
  const [homeLanguageOther, setHomeLanguageOther] = useState("");

  // 密码
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  // 加载孩子资料
  useEffect(() => {
    if (activeChild) {
      setNickname(activeChild.nickname || "");
      setAge(activeChild.age || 7);
      setGrade(activeChild.grade || "Grade 1");
      setCountry(activeChild.country || "Canada");
      setHomeLanguage(activeChild.home_language || "");
      setHomeLanguageOther(activeChild.home_language_other || "");
    }
  }, [activeChild]);

  const ageOptions = Array.from({ length: 12 }, (_, i) => i + 5);
  const gradeOptions = [
    "Kindergarten",
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
    "Grade 5",
    "Grade 6",
    "Grade 7",
    "Grade 8",
    "Grade 9",
    "Grade 10",
    "Grade 11",
    "Grade 12",
  ];
  const countryOptions = ["Canada", "USA", "UK", "Australia", "Singapore", "Hong Kong", "Other"];
  const languageOptions = [
    { value: "", label: "请选择（选填）" },
    { value: "chinese", label: "中文为主" },
    { value: "bilingual", label: "中英双语" },
    { value: "english", label: "英文为主" },
    { value: "other", label: "其他" },
  ];

  const handleSaveChild = async () => {
    if (!activeChild) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await authFetch(`/api/children/${activeChild.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          nickname,
          age,
          grade,
          country,
          home_language: homeLanguage || null,
          home_language_other: homeLanguage === "other" ? homeLanguageOther : null,
        }),
      });
      const data = await res.json();
      if (data.success || data.child) {
        setMessage({ type: "success", text: "孩子资料已保存" });
        // 刷新用户信息
        window.location.reload();
      } else {
        setMessage({ type: "error", text: data.error || "保存失败" });
      }
    } catch (e: any) {
      setMessage({ type: "error", text: e.message || "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "新密码至少需要8位" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "两次输入的新密码不一致" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await authFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "密码修改成功" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setMessage({ type: "error", text: data.error || "修改失败" });
      }
    } catch (e: any) {
      setMessage({ type: "error", text: e.message || "修改失败" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !user || !activeChild) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1
          className="mb-8 text-3xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          账户设置
        </h1>

        {/* Tab 切换 */}
        <div className="mb-6 flex gap-2 rounded-2xl bg-muted p-1">
          <button
            onClick={() => setActiveTab("child")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              activeTab === "child"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <User className="h-4 w-4" />
            孩子资料
          </button>
          <button
            onClick={() => setActiveTab("password")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              activeTab === "password"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Lock className="h-4 w-4" />
            修改密码
          </button>
        </div>

        {/* 消息提示 */}
        {message && (
          <div
            className={`mb-4 rounded-xl px-4 py-3 text-sm ${
              message.type === "success"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* 孩子资料 Tab */}
        {activeTab === "child" && (
          <div className="space-y-5 rounded-3xl border border-border bg-card p-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                孩子昵称
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="如：Leo、Emma"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  年龄
                </label>
                <select
                  value={age}
                  onChange={(e) => setAge(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {ageOptions.map((a) => (
                    <option key={a} value={a}>
                      {a}岁
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  年级
                </label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {gradeOptions.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                国家/地区
              </label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {countryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                语言环境（选填）
              </label>
              <select
                value={homeLanguage}
                onChange={(e) => setHomeLanguage(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {languageOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {homeLanguage === "other" && (
                <input
                  type="text"
                  value={homeLanguageOther}
                  onChange={(e) => setHomeLanguageOther(e.target.value)}
                  className="mt-3 w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="请填写其他语言"
                />
              )}
            </div>

            <button
              onClick={handleSaveChild}
              disabled={saving || !nickname}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary, #FF6B35)" }}
            >
              <Save className="h-5 w-5" />
              {saving ? "保存中..." : "保存修改"}
            </button>
          </div>
        )}

        {/* 修改密码 Tab */}
        {activeTab === "password" && (
          <div className="space-y-5 rounded-3xl border border-border bg-card p-6">
            {/* 当前邮箱信息 */}
            <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-5 w-5" style={{ color: "var(--color-primary)" }} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">当前登录邮箱</p>
                <p className="text-sm font-medium text-foreground">{user.email}</p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                当前密码
              </label>
              <div className="relative">
                <input
                  type={showCurrentPwd ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 pr-12 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="请输入当前密码"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrentPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                新密码
              </label>
              <div className="relative">
                <input
                  type={showNewPwd ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 pr-12 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="至少8位"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPwd(!showNewPwd)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                密码至少8位，建议使用字母+数字组合
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                确认新密码
              </label>
              <input
                type={showNewPwd ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="再次输入新密码"
              />
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="mt-1 text-xs text-red-500">两次输入的密码不一致</p>
              )}
            </div>

            <button
              onClick={handleChangePassword}
              disabled={saving || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary, #FF6B35)" }}
            >
              <Lock className="h-5 w-5" />
              {saving ? "修改中..." : "修改密码"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
