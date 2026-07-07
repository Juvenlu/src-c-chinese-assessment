'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function HomePage() {
  const [hoverFull, setHoverFull] = useState(false);
  const [hoverSampling, setHoverSampling] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);

  const handleShare = async () => {
    const url = window.location.href;
    const shareData = {
      title: 'SRC-C 中文成长评估',
      text: '来测试你的中文识字量吧！🐵',
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // user cancelled
      }
    } else {
      await navigator.clipboard.writeText(url);
      setShowShareToast(true);
      setTimeout(() => setShowShareToast(false), 2500);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-[var(--color-src-bg)]">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-10 left-10 w-32 h-32 bg-[var(--color-src-accent)] rounded-full opacity-20 blur-3xl" />
        <div className="absolute bottom-20 right-20 w-40 h-40 bg-[var(--color-src-secondary)] rounded-full opacity-20 blur-3xl" />
        <div className="absolute top-1/3 right-10 w-24 h-24 bg-[var(--color-src-primary)] rounded-full opacity-15 blur-2xl" />
      </div>

      <div className="relative z-10 text-center max-w-lg w-full">
        {/* Monkey mascot */}
        <div className="mb-6 animate-bounce-in">
          <div className="w-32 h-32 mx-auto bg-[var(--color-src-accent)] rounded-full flex items-center justify-center shadow-lg">
            <span className="text-6xl">🐵</span>
          </div>
        </div>

        {/* Title */}
        <h1 className="font-display text-4xl md:text-5xl text-[var(--color-src-text)] mb-3">
          SRC-C
        </h1>
        <h2 className="font-display text-2xl md:text-3xl text-[var(--color-src-primary)] mb-2">
          中文成长评估
        </h2>
        <p className="text-[var(--color-src-text-light)] text-lg mb-8">
          Stable Reading Chinese & Culture
        </p>

        {/* Feature cards */}
        <div className="grid grid-cols-3 gap-3 mb-10">
          <div className="card-game text-center p-4">
            <div className="text-3xl mb-2">📖</div>
            <div className="text-sm font-medium text-[var(--color-src-text)]">识字测评</div>
          </div>
          <div className="card-game text-center p-4">
            <div className="text-3xl mb-2">📈</div>
            <div className="text-sm font-medium text-[var(--color-src-text)]">成长追踪</div>
          </div>
          <div className="card-game text-center p-4">
            <div className="text-3xl mb-2">⭐</div>
            <div className="text-sm font-medium text-[var(--color-src-text)]">趣味闯关</div>
          </div>
        </div>

        {/* Mode selection - Two cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {/* 逐字测试 */}
          <Link href="/profile?mode=full" className="block">
            <div
              className="relative bg-white rounded-3xl p-6 shadow-md border-2 border-transparent transition-all duration-300 hover:shadow-xl hover:border-[var(--color-src-primary)] hover:-translate-y-1 cursor-pointer"
              onMouseEnter={() => setHoverFull(true)}
              onMouseLeave={() => setHoverFull(false)}
            >
              <div className="text-4xl mb-3">📝</div>
              <h3 className="font-display text-xl text-[var(--color-src-text)] mb-2">
                逐字测试
              </h3>
              <p className="text-sm text-[var(--color-src-text-light)] mb-3">
                300字库逐个测试，全面了解每个字的掌握情况
              </p>
              <div className="flex items-center gap-2 text-xs text-[var(--color-src-text-light)]">
                <span className="inline-flex items-center gap-1 bg-[var(--color-src-accent)]/20 px-2 py-1 rounded-full">
                  300字
                </span>
                <span className="inline-flex items-center gap-1 bg-[var(--color-src-secondary)]/20 px-2 py-1 rounded-full">
                  不限时
                </span>
                <span className="inline-flex items-center gap-1 bg-[var(--color-src-primary)]/20 px-2 py-1 rounded-full">
                  全面检测
                </span>
              </div>
              {hoverFull && (
                <div className="absolute -top-2 -right-2 text-2xl animate-bounce">✨</div>
              )}
            </div>
          </Link>

          {/* 抽测闯关 */}
          <Link href="/profile?mode=sampling" className="block">
            <div
              className="relative bg-white rounded-3xl p-6 shadow-md border-2 border-transparent transition-all duration-300 hover:shadow-xl hover:border-[var(--color-src-secondary)] hover:-translate-y-1 cursor-pointer"
              onMouseEnter={() => setHoverSampling(true)}
              onMouseLeave={() => setHoverSampling(false)}
            >
              <div className="text-4xl mb-3">🎮</div>
              <h3 className="font-display text-xl text-[var(--color-src-text)] mb-2">
                抽测闯关
              </h3>
              <p className="text-sm text-[var(--color-src-text-light)] mb-3">
                限时闯关模式，抽样评估识字量，快速出结果
              </p>
              <div className="flex items-center gap-2 text-xs text-[var(--color-src-text-light)]">
                <span className="inline-flex items-center gap-1 bg-[var(--color-src-accent)]/20 px-2 py-1 rounded-full">
                  抽样
                </span>
                <span className="inline-flex items-center gap-1 bg-[var(--color-src-primary)]/20 px-2 py-1 rounded-full">
                  限时5-10分钟
                </span>
                <span className="inline-flex items-center gap-1 bg-[var(--color-src-secondary)]/20 px-2 py-1 rounded-full">
                  趣味闯关
                </span>
              </div>
              {hoverSampling && (
                <div className="absolute -top-2 -right-2 text-2xl animate-bounce">🎯</div>
              )}
            </div>
          </Link>
        </div>

        {/* Share button */}
        <button
          onClick={handleShare}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white/80 shadow-sm text-[var(--color-src-text)] font-medium transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:scale-95 mb-6"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          分享给家长，让孩子来测试
        </button>

        {/* Share toast */}
        {showShareToast && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[var(--color-src-text)] text-white px-6 py-3 rounded-2xl shadow-lg animate-bounce-in z-50">
            链接已复制到剪贴板！
          </div>
        )}

        {/* Admin link - hidden from regular users, admin accesses via /admin directly */}

        {/* Level info */}
        <div className="mt-8 grid grid-cols-3 gap-3">
          <div className="bg-white/60 rounded-2xl p-3 text-center">
            <div className="font-display text-lg text-[var(--color-src-primary)]">SRC300</div>
            <div className="text-xs text-[var(--color-src-text-light)]">300字库</div>
          </div>
          <div className="bg-white/60 rounded-2xl p-3 text-center">
            <div className="font-display text-lg text-[var(--color-src-secondary)]">SRC500</div>
            <div className="text-xs text-[var(--color-src-text-light)]">500字库</div>
          </div>
          <div className="bg-white/60 rounded-2xl p-3 text-center">
            <div className="font-display text-lg text-[var(--color-src-primary)]">SRC800</div>
            <div className="text-xs text-[var(--color-src-text-light)]">800字库</div>
          </div>
        </div>
      </div>
    </div>
  );
}
