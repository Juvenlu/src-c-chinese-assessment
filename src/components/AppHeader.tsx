"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  BookOpen,
  Gamepad2,
  Map,
  ChevronDown,
  User,
  Settings,
  LogOut,
  Users,
  Plus,
  Home,
} from "lucide-react";

/**
 * 登录后的顶部导航栏
 * - 左侧：SRC 标识 + 导航（故事 / 闯关 / 成长）
 * - 右侧：孩子切换下拉菜单
 */
export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, children: kids, activeChild, setActiveChild, logout } = useAuth();

  const isActive = (path: string) => pathname?.startsWith(path);

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  const handleSwitchChild = (childId: string) => {
    setActiveChild(childId);
    router.push("/hub");
  };

  if (!user || !activeChild) return null;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        {/* 左侧：Logo + 导航 */}
        <div className="flex items-center gap-8">
          <Link href="/hub" className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
              style={{ backgroundColor: "var(--color-primary, #FF6B35)" }}
            >
              <span className="text-lg font-bold">S</span>
            </div>
            <span className="text-lg font-bold text-foreground">SRC中文</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <Link
              href="/books"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive("/books")
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <BookOpen className="h-4 w-4" />
              故事
            </Link>
            <Link
              href="/game"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive("/game")
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Gamepad2 className="h-4 w-4" />
              闯关
            </Link>
            <Link
              href="/growth-map"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive("/growth-map")
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Map className="h-4 w-4" />
              成长
            </Link>
          </nav>
        </div>

        {/* 右侧：孩子下拉菜单 */}
        <div className="relative">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--color-accent, #FFE66D)" }}
              >
                <User className="h-4 w-4 text-foreground" />
              </div>
              <span className="hidden text-sm font-medium text-foreground sm:block">
                {activeChild.nickname}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </summary>

            <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
              {/* 孩子列表 */}
              {kids.length > 1 && (
                <div className="border-b border-border p-2">
                  <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
                    我的孩子
                  </p>
                  {kids.map((child: { id: string; nickname: string }) => (
                    <button
                      key={child.id}
                      onClick={() => handleSwitchChild(child.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                        child.id === activeChild.id
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <User className="h-4 w-4" />
                      {child.nickname}
                      {child.id === activeChild.id && (
                        <span className="ml-auto text-xs">✓</span>
                      )}
                    </button>
                  ))}
                  <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-muted-foreground hover:bg-muted">
                    <Plus className="h-4 w-4" />
                    添加孩子
                  </button>
                </div>
              )}

              {/* 菜单 */}
              <div className="p-2">
                <Link
                  href="/growth-map"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <Map className="h-4 w-4" />
                  我的成长
                </Link>
                <Link
                  href="/parent-center"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <Users className="h-4 w-4" />
                  家长中心
                </Link>
                <Link
                  href="/settings"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <Settings className="h-4 w-4" />
                  账户设置
                </Link>
              </div>

              <div className="border-t border-border p-2">
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-red-500 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
