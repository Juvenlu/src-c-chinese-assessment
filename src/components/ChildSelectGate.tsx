"use client";

import { Users, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/**
 * 孩子选择门控（P2 设备级偏好）
 *
 * 触发场景：当前家长有多个孩子，但本设备尚未保存有效偏好
 * （首次登录 / 偏好失效 / 偏好不属于当前家长 / localStorage 不可用）。
 *
 * 在选定孩子前，不加载任何孩子的 Growth Map 数据（activeChildId 为 null，
 * 上游 useLayoutEffect 的 identityReadyRef + 门控会阻塞请求）。
 * 选定后由 setActiveChild 触发偏好持久化 + 对应孩子数据加载。
 */
export function ChildSelectGate() {
  const { children: kids, setActiveChild } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: "var(--color-primary, #FF6B35)22" }}
          >
            <Users
              className="h-8 w-8"
              style={{ color: "var(--color-primary, #FF6B35)" }}
            />
          </div>
          <h1
            className="text-2xl font-bold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            选择一个小伙伴
          </h1>
          <p className="mt-2 text-muted-foreground">你想以哪位小朋友的身份开始今天的中文世界？</p>
        </div>

        <div className="space-y-3">
          {kids.map((child) => (
            <button
              key={child.id}
              onClick={() => setActiveChild(child.id)}
              className="group flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left transition-all hover:scale-[1.02] hover:shadow-lg"
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white"
                  style={{ backgroundColor: "var(--color-primary, #FF6B35)" }}
                >
                  {child.nickname?.slice(0, 1) || "宝"}
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">{child.nickname}</p>
                  <p className="text-xs text-muted-foreground">
                    {child.age} 岁 · {child.grade || "未设置年级"}
                  </p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}