"use client";

import { useAuth } from "@/lib/auth-context";
import { ChildSelectGate } from "@/components/ChildSelectGate";

/**
 * 全局孩子选择门控（P2 GLOBAL-GATE）
 *
 * 统一拦截「已登录 + 有孩子 + 尚未选定孩子」的所有页面（含深链 /start、/settings、
 * /book-select、/growth-map 等），在选定孩子前不加载任何孩子的测评/阅读数据，
 * 避免无限加载或错误孩子数据。
 *
 * 透传条件（不阻断）：
 *  - loading：身份尚未就绪（由各页面自行展示加载态）
 *  - !user：未登录（游客路径，如快速测试 /growth-map 游客结果页）
 *  - kids.length === 0：零孩子账号（保留各页面/ hub 的创建孩子流程）
 *  - activeChild 已选定（含恢复的有效偏好/单一孩子）：直接放行
 *
 * 选定孩子后，本组件从 select 分支切换回 children 分支，
 * 原请求目标页面（router 栈）保持不变，继续渲染。
 */
export function GlobalChildGate({ children }: { children: React.ReactNode }) {
  const { user, children: kids, activeChild, loading } = useAuth();

  // 未登录 / 身份加载中 / 零孩子 / 已有有效孩子 → 一律放行
  if (loading || !user || kids.length === 0 || activeChild) {
    return <>{children}</>;
  }

  // 多孩子且未选定 → 全屏选择门控（阻断所有子页面渲染）
  return <ChildSelectGate />;
}