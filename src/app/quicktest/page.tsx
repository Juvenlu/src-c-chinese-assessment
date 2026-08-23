'use client';
/* eslint-disable react-hooks/purity */

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  initAdaptiveSession,
  submitAnswer,
  getNextQuestionForLevel,
  AdaptiveSession,
  QAItem,
  QAResult,
  AdaptiveAssessmentResult,
  LEVEL_ORDER,
  ADAPTIVE_CONFIG,
} from '@/lib/quick-assessment';
import { Level } from '@/lib/types';

type TestPhase = 'intro' | 'testing' | 'level-transition' | 'calculating';

/** 保存快速测试session到本地（防刷新/重开） */
const STORAGE_KEY = 'src_quick_test_session';
const STORAGE_RESULTS = 'src_quick_test_results';

export default function QuickTestPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<TestPhase>('intro');
  const [session, setSession] = useState<AdaptiveSession | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<QAItem | null>(null);
  const [allResults, setAllResults] = useState<QAResult[]>([]);
  const [questionStartTime, setQuestionStartTime] = useState(0);
  const [finalResult, setFinalResult] = useState<AdaptiveAssessmentResult | null>(null);
  const [levelTransitionText, setLevelTransitionText] = useState('');

  // 已排除的字/词（避免重复）
  const excludedChars = useMemo(
    () => new Set(allResults.filter(r => r.type === 'character').map(r => r.content)),
    [allResults],
  );
  const excludedWords = useMemo(
    () => new Set(allResults.filter(r => r.type === 'vocabulary').map(r => r.content)),
    [allResults],
  );

  // 计算进度（基于最大可能题数估算）
  const totalEstimated = 40; // 估算上限
  const progressPercent = Math.min(95, (allResults.length / totalEstimated) * 100);

  // 当前等级名字
  const currentLevelName = session ? getLevelDisplayName(session.currentLevel) : '';

  // 开始测试
  function startTest() {
    const { session: s, firstQuestions } = initAdaptiveSession();
    setSession(s);
    // 取第一题
    const firstQ = getNextQuestionForLevel(
      s.currentLevel,
      s.phase,
      s.currentIndexInLevel,
    );
    setCurrentQuestion(firstQ);
    setAllResults([]);
    setPhase('testing');
    setQuestionStartTime(Date.now());
  }

  // 处理答题
  function handleAnswer(known: boolean) {
    if (!session || !currentQuestion) return;

    const reactionTime = Date.now() - questionStartTime;
    const answer: QAResult = {
      id: currentQuestion.id,
      type: currentQuestion.type,
      content: currentQuestion.content,
      level: currentQuestion.level,
      isCorrect: known,
      reactionTimeMs: reactionTime,
    };

    const newAllResults = [...allResults, answer];
    setAllResults(newAllResults);

    const excludeC = new Set(newAllResults.filter(r => r.type === 'character').map(r => r.content));
    const excludeW = new Set(newAllResults.filter(r => r.type === 'vocabulary').map(r => r.content));

    const { nextQuestion, updatedSession, levelCompleted, finalResult: fr } = submitAnswer(
      session,
      answer,
      ADAPTIVE_CONFIG,
      excludeC,
      excludeW,
    );

    setSession(updatedSession);

    if (fr) {
      // 测试结束
      setFinalResult(fr);
      setPhase('calculating');
      // 保存结果到本地
      try {
        localStorage.setItem(STORAGE_RESULTS, JSON.stringify({
          result: fr,
          answers: newAllResults,
          time: Date.now(),
        }));
      } catch (e) { /* 忽略 */ }
      // 延迟跳转
      setTimeout(() => {
        router.push('/quickresult');
      }, 1500);
      return;
    }

    if (levelCompleted && nextQuestion) {
      // 刚完成一个等级，显示过渡提示
      const nextLevelName = getLevelDisplayName(updatedSession.currentLevel);
      setLevelTransitionText(levelCompleted.passed
        ? `很棒！进入${nextLevelName}挑战～`
        : `我们换个难度继续看看～`);
      setPhase('level-transition');
      setTimeout(() => {
        setCurrentQuestion(nextQuestion);
        setQuestionStartTime(Date.now());
        setPhase('testing');
      }, 1200);
    } else if (nextQuestion) {
      setCurrentQuestion(nextQuestion);
      setQuestionStartTime(Date.now());
    }
  }

  // 当前题的类型显示
  const questionTypeText = currentQuestion?.type === 'character' ? '认识这个字吗？' : '认识这个词吗？';

  return (
    <div className="min-h-screen bg-[var(--color-bg-main)] flex flex-col">
      {/* 顶部栏 */}
      <div className="p-4 flex items-center justify-between">
        <button
          onClick={() => router.push('/')}
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors text-sm"
        >
          ← 返回
        </button>
        <div className="text-[var(--color-text-secondary)] text-sm">
          {phase === 'testing' && currentQuestion?.type === 'character' && '📖 单字识别'}
          {phase === 'testing' && currentQuestion?.type === 'vocabulary' && '📚 词语识别'}
        </div>
        <div className="text-[var(--color-text-secondary)] text-sm w-12 text-right">
          {allResults.length > 0 && `${allResults.length}题`}
        </div>
      </div>

      {/* 进度条 */}
      {phase !== 'intro' && (
        <div className="px-4 pb-2">
          <div className="h-2 bg-[var(--color-bg-card)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* 主体内容 */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        {/* 说明页 */}
        {phase === 'intro' && <IntroPage onStart={startTest} />}

        {/* 测试中 */}
        {phase === 'testing' && currentQuestion && (
          <TestQuestion
            question={currentQuestion}
            typeText={questionTypeText}
            levelName={currentLevelName}
            onAnswer={handleAnswer}
          />
        )}

        {/* 等级过渡 */}
        {phase === 'level-transition' && (
          <div className="text-center">
            <div className="text-5xl mb-6 animate-bounce">🌟</div>
            <p className="text-xl text-[var(--color-text-primary)] font-medium">
              {levelTransitionText}
            </p>
          </div>
        )}

        {/* 计算中 */}
        {phase === 'calculating' && (
          <div className="text-center">
            <div className="text-6xl mb-6 animate-pulse">🎯</div>
            <p className="text-xl text-[var(--color-text-primary)] font-medium">
              正在整理你的中文成长结果…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ========== 子组件 ==========

function IntroPage({ onStart }: { onStart: () => void }) {
  return (
    <div className="max-w-md w-full text-center">
      <div className="text-7xl mb-6">🐒</div>
      <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-3" style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}>
        免费中文基础测试
      </h1>
      <p className="text-[var(--color-text-secondary)] mb-8">
        快速了解孩子目前的中文阅读字词基础
      </p>

      <div className="bg-white rounded-2xl p-6 shadow-sm mb-8 text-left space-y-4">
        <FeatureRow icon="⏱️" title="约3分钟" desc="快速估测，不给孩子压力" />
        <FeatureRow icon="📈" title="逐级调整" desc="从简单到复杂，智能匹配难度" />
        <FeatureRow icon="📚" title="阅读建议" desc="给出适合的绘本阅读难度" />
        <FeatureRow icon="🔓" title="免费体验" desc="无需注册，打开即测" />
      </div>

      <button
        onClick={onStart}
        className="w-full py-4 px-8 bg-[var(--color-primary)] text-white text-xl font-bold rounded-2xl shadow-lg hover:scale-105 transition-transform active:scale-95"
        style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}
      >
        开始测试
      </button>
      <p className="text-xs text-[var(--color-text-secondary)] mt-4">
        测试结果为快速估测，不等同于完整正式测评
      </p>
    </div>
  );
}

function FeatureRow({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="text-2xl w-10 text-center">{icon}</div>
      <div>
        <div className="font-medium text-[var(--color-text-primary)]">{title}</div>
        <div className="text-sm text-[var(--color-text-secondary)]">{desc}</div>
      </div>
    </div>
  );
}

function TestQuestion({
  question,
  typeText,
  levelName,
  onAnswer,
}: {
  question: QAItem;
  typeText: string;
  levelName: string;
  onAnswer: (known: boolean) => void;
}) {
  return (
    <div className="max-w-md w-full text-center">
      {/* 等级小标签 */}
      <div className="inline-block px-3 py-1 bg-[var(--color-accent)]/20 text-[var(--color-accent)] rounded-full text-sm font-medium mb-6">
        {levelName}
      </div>

      {/* 题目文字 */}
      <div className="mb-4 text-[var(--color-text-secondary)]">
        {typeText}
      </div>

      {/* 被测字/词 */}
      <div
        className="text-8xl md:text-9xl text-[var(--color-text-primary)] mb-12 tracking-widest"
        style={{ fontFamily: "'KaiTi', 'STKaiti', '楷体', 'Kaiti SC', serif" }}
      >
        {question.content}
      </div>

      {/* 两个大按钮 */}
      <div className="flex gap-4 justify-center">
        <button
          onClick={() => onAnswer(false)}
          className="flex-1 max-w-[140px] py-6 bg-white border-2 border-[var(--color-border-light)] text-[var(--color-text-secondary)] text-xl font-bold rounded-2xl shadow-sm hover:border-[var(--color-error)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/5 transition-all active:scale-95"
          style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}
        >
          不认识
        </button>
        <button
          onClick={() => onAnswer(true)}
          className="flex-1 max-w-[140px] py-6 bg-[var(--color-primary)] text-white text-xl font-bold rounded-2xl shadow-lg hover:scale-105 transition-transform active:scale-95"
          style={{ fontFamily: "'ZCOOL KuaiLe', cursive" }}
        >
          认识
        </button>
      </div>
    </div>
  );
}

// ========== 工具函数 ==========

function getLevelDisplayName(level: Level): string {
  const map: Record<Level, string> = {
    SRC100: 'SRC100 · 入门',
    SRC300: 'SRC300 · 基础',
    SRC500: 'SRC500 · 进阶',
    SRC800: 'SRC800 · 高级',
  };
  return map[level] || level;
}
