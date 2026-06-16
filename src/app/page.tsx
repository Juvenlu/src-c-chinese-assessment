'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function HomePage() {
  const [hoverStart, setHoverStart] = useState(false);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-[var(--color-src-bg)]">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-10 left-10 w-32 h-32 bg-[var(--color-src-accent)] rounded-full opacity-20 blur-3xl" />
        <div className="absolute bottom-20 right-20 w-40 h-40 bg-[var(--color-src-secondary)] rounded-full opacity-20 blur-3xl" />
        <div className="absolute top-1/3 right-10 w-24 h-24 bg-[var(--color-src-primary)] rounded-full opacity-15 blur-2xl" />
      </div>

      <div className="relative z-10 text-center max-w-lg">
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

        {/* Start button */}
        <Link href="/profile">
          <button
            className="btn-game bg-[var(--color-src-primary)] text-white text-2xl px-12 py-5 shadow-lg"
            onMouseEnter={() => setHoverStart(true)}
            onMouseLeave={() => setHoverStart(false)}
          >
            开始测试 🚀
            {hoverStart && (
              <span className="ml-2 inline-block animate-bounce">✨</span>
            )}
          </button>
        </Link>

        {/* Admin link */}
        <div className="mt-8">
          <Link
            href="/admin"
            className="text-[var(--color-src-text-light)] text-sm hover:text-[var(--color-src-primary)] transition-colors"
          >
            管理后台 →
          </Link>
        </div>

        {/* Level info */}
        <div className="mt-10 grid grid-cols-3 gap-3">
          <div className="bg-white/60 rounded-2xl p-3 text-center">
            <div className="font-display text-lg text-[var(--color-src-primary)]">SRC300</div>
            <div className="text-xs text-[var(--color-src-text-light)]">5分钟</div>
          </div>
          <div className="bg-white/60 rounded-2xl p-3 text-center">
            <div className="font-display text-lg text-[var(--color-src-secondary)]">SRC500</div>
            <div className="text-xs text-[var(--color-src-text-light)]">8分钟</div>
          </div>
          <div className="bg-white/60 rounded-2xl p-3 text-center">
            <div className="font-display text-lg text-[var(--color-src-primary)]">SRC800</div>
            <div className="text-xs text-[var(--color-src-text-light)]">10分钟</div>
          </div>
        </div>
      </div>
    </div>
  );
}
