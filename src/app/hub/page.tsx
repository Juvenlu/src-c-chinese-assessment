'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';

export default function HubPage() {
  const router = useRouter();
  const { user, children, activeChild, setActiveChild, loading, logout, latestResult } = useAuth();
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  if (loading || !user || !activeChild) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-warm)' }}>
        <div className="text-xl text-gray-600">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-10" style={{ backgroundColor: 'var(--color-bg-warm)' }}>
      {/* 顶部导航 */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-sm border-b border-orange-100">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🐵</span>
            <span className="font-bold text-gray-800">SRC 中文世界</span>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: 'var(--color-src-primary)' }}
              >
                {activeChild.nickname.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-gray-700 hidden sm:inline">{activeChild.nickname}</span>
            </button>
            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-sm text-gray-500">当前孩子</p>
                  <p className="font-medium text-gray-800">{activeChild.nickname}</p>
                  <p className="text-xs text-gray-500">{activeChild.age}岁 · {activeChild.grade}</p>
                </div>
                {children.length > 1 && (
                  <div className="py-1 border-b border-gray-100">
                    <p className="px-4 py-1.5 text-xs text-gray-500">切换孩子</p>
                    {children.filter(c => c.id !== activeChild.id).map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setActiveChild(c.id); setShowProfileMenu(false); }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        {c.nickname}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => { setShowProfileMenu(false); router.push('/profile'); }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  孩子资料
                </button>
                <button
                  onClick={async () => { setShowProfileMenu(false); await logout(); router.push('/'); }}
                  className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-red-50"
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {/* 欢迎语 */}
        <div>
          <p className="text-sm text-gray-500 mb-1">欢迎回来</p>
          <h1
            className="text-3xl font-bold"
            style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}
          >
            {activeChild.nickname}，你好呀！
          </h1>
        </div>

        {/* 成长状态卡片 */}
        <div className="bg-white rounded-2xl shadow-md p-5 border border-orange-100">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">📊</span>
            <h2 className="font-bold text-gray-800 text-lg">我的中文成长</h2>
          </div>
          {latestResult ? (
            <div>
              <div className="flex items-baseline gap-2 mb-3">
                <span
                  className="text-3xl font-bold"
                  style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}
                >
                  SRC{latestResult.reading_base_level}
                </span>
                <span className="text-sm text-gray-500">左右</span>
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: latestResult.confidence === 'high' ? '#d1fae5' :
                      latestResult.confidence === 'medium' ? '#fef3c7' : '#fee2e2',
                    color: latestResult.confidence === 'high' ? '#065f46' :
                      latestResult.confidence === 'medium' ? '#92400e' : '#991b1b',
                  }}
                >
                  {latestResult.confidence === 'high' ? '置信度高' :
                    latestResult.confidence === 'medium' ? '置信度中' : '置信度低'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-orange-50 rounded-xl py-3">
                  <p className="text-xs text-gray-500 mb-1">单字基础</p>
                  <p className="font-bold text-gray-800">SRC{latestResult.character_level_upper}</p>
                </div>
                <div className="bg-teal-50 rounded-xl py-3">
                  <p className="text-xs text-gray-500 mb-1">词语基础</p>
                  <p className="font-bold text-gray-800">SRC{latestResult.word_level_upper}</p>
                </div>
                <div className="bg-amber-50 rounded-xl py-3">
                  <p className="text-xs text-gray-500 mb-1">推荐阅读</p>
                  <p className="font-bold text-gray-800 text-sm">
                    {latestResult.recommended_reading}
                  </p>
                </div>
              </div>
              <Link
                href="/growth-map"
                className="mt-4 block text-center py-2.5 rounded-xl border border-orange-200 text-orange-600 text-sm font-medium hover:bg-orange-50 transition-colors"
              >
                🗺 查看我的成长地图
              </Link>
            </div>
          ) : (
            <div>
              <p className="text-gray-500 text-sm mb-3">还没有测字记录，先开始第一次测试吧！</p>
              <Link
                href="/profile?mode=fulltest"
                className="block text-center py-3 rounded-xl text-white font-medium transition-all hover:scale-[1.02]"
                style={{ backgroundColor: 'var(--color-src-primary)' }}
              >
                开始第一次测字
              </Link>
            </div>
          )}
        </div>

        {/* 功能入口卡片 */}
        <div className="grid grid-cols-2 gap-4">
          <Link href="/growth-map" className="bg-white rounded-2xl shadow-md p-5 hover:shadow-lg transition-shadow block">
            <div className="text-4xl mb-3">🎮</div>
            <h3 className="font-bold text-gray-800 mb-1">今日闯关</h3>
            <p className="text-sm text-gray-500">开始今天的挑战</p>
            <p className="text-xs text-orange-500 mt-2 font-medium">即将开放</p>
          </Link>

          <Link href="/book-select" className="bg-white rounded-2xl shadow-md p-5 hover:shadow-lg transition-shadow block">
            <div className="text-4xl mb-3">📚</div>
            <h3 className="font-bold text-gray-800 mb-1">今日故事</h3>
            <p className="text-sm text-gray-500">适合你的中文故事</p>
            <p className="text-xs text-teal-500 mt-2 font-medium">绘本工坊</p>
          </Link>

          <Link href="/history" className="bg-white rounded-2xl shadow-md p-5 hover:shadow-lg transition-shadow block">
            <div className="text-4xl mb-3">📈</div>
            <h3 className="font-bold text-gray-800 mb-1">历史记录</h3>
            <p className="text-sm text-gray-500">查看成长曲线</p>
          </Link>

          <Link href="/profile" className="bg-white rounded-2xl shadow-md p-5 hover:shadow-lg transition-shadow block">
            <div className="text-4xl mb-3">📝</div>
            <h3 className="font-bold text-gray-800 mb-1">正式测字</h3>
            <p className="text-sm text-gray-500">更全面的识字测评</p>
          </Link>
        </div>

        {/* 今日成长提示 */}
        <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-2xl p-5 border border-teal-100">
          <h3 className="font-bold text-gray-800 mb-2">⭐ 今日成长</h3>
          <p className="text-sm text-gray-600">
            每天花 10 分钟，认识 5 个新字，积累就从今天开始！
          </p>
        </div>
      </main>
    </div>
  );
}
