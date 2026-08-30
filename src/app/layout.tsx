import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

// 所有页面均依赖用户登录态与 searchParams，统一动态渲染避免 SSG 预渲染报错
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    default: 'SRC-C 中文成长评估',
    template: '%s | SRC-C',
  },
  description: 'SRC-C 中文成长评估系统 - 为海外华人青少年量身打造的中文识字量测评工具',
  keywords: ['中文识字', '识字量测评', '海外华人', '中文学习', '阅读评估'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased min-h-screen bg-[var(--color-src-bg)]">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
