'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Level, TestPart, QuestionItem, PART_NAMES, SubmitAnswerInput } from '@/lib/types';
import { getXP, getStarsForPart, getBadgeForPart } from '@/lib/scoring';

// Readable Chinese font stack (KaiTi > Microsoft YaHei > SimHei > sans-serif)
const CHINESE_READABLE_FONT: React.CSSProperties = {
  fontFamily: "'KaiTi', 'STKaiti', '楷体', 'Microsoft YaHei', '微软雅黑', 'SimHei', '黑体', 'PingFang SC', 'Hiragino Sans GB', sans-serif",
};

// Fisher-Yates shuffle with seed for consistent ordering per question
function shuffleArray<T>(array: T[], seed: number): T[] {
  const arr = [...array];
  let s = seed;
  const random = () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface PartProgress {
  completed: boolean;
  correctCount: number;
  totalCount: number;
  stars: number;
  badge: string | null;
}

function TestContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const level = searchParams.get('level') as Level;

  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [currentPart, setCurrentPart] = useState<TestPart>(1);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalXP, setTotalXP] = useState(0);
  const [partProgress, setPartProgress] = useState<Record<TestPart, PartProgress>>({
    1: { completed: false, correctCount: 0, totalCount: 0, stars: 0, badge: null },
    2: { completed: false, correctCount: 0, totalCount: 0, stars: 0, badge: null },
    3: { completed: false, correctCount: 0, totalCount: 0, stars: 0, badge: null },
    4: { completed: false, correctCount: 0, totalCount: 0, stars: 0, badge: null },
  });
  const [showFeedback, setShowFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [showPartComplete, setShowPartComplete] = useState(false);
  const [xpPopup, setXpPopup] = useState<{ amount: number; id: number } | null>(null);
  const questionStartTime = useRef<number>(Date.now());
  const xpPopupId = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  // Pre-shuffled options for each question (consistent across re-renders)
  // Key: `${part}-${questionIndex}`, Value: shuffled options
  const shuffledOptionsMap = useRef<Record<string, string[]>>({});

  const getShuffledOptions = (key: string, options: string[]): string[] => {
    if (!shuffledOptionsMap.current[key]) {
      // Use hash of key as seed for consistent shuffle
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
      }
      shuffledOptionsMap.current[key] = shuffleArray(options, Math.abs(hash) + 1);
    }
    return shuffledOptionsMap.current[key];
  };

  // Load questions
  useEffect(() => {
    async function loadQuestions() {
      if (!level) return;
      try {
        // Seed first
        await fetch('/api/seed', { method: 'POST' });
        
        const res = await fetch(`/api/questions?level=${level}`);
        const { data, error } = await res.json();
        if (error) throw new Error(error);
        setQuestions(data || []);

        // Set timer based on level
        const timeLimits: Record<Level, number> = { SRC300: 480, SRC500: 720, SRC800: 900 };
        setTimeLeft(timeLimits[level]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadQuestions();
  }, [level]);

  // Timer
  useEffect(() => {
    if (loading || !questions.length) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          finishTest();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, questions.length]);

  // Shuffled question indices per part (stable per session, randomized order)
  const shuffledPartQuestions = useRef<Record<number, QuestionItem[]>>({});

  const getCurrentPartQuestions = useCallback((): QuestionItem[] => {
    if (!questions.length) return [];

    // Allocate questions: Part 1 (30%), Part 2 (30%), Part 3 (23%), Part 4 (17%)
    // Part 4 reduced by ~1/3 compared to equal distribution to fit within time limit
    const n = questions.length;
    const p1End = Math.round(n * 0.30);
    const p2End = p1End + Math.round(n * 0.30);
    const p3End = p2End + Math.round(n * 0.23);
    // Part 4 gets the rest (~17%)

    let partQuestions: QuestionItem[];
    switch (currentPart) {
      case 1: partQuestions = questions.slice(0, p1End); break;
      case 2: partQuestions = questions.slice(p1End, p2End); break;
      case 3: partQuestions = questions.slice(p2End, p3End); break;
      case 4: partQuestions = questions.slice(p3End); break;
      default: partQuestions = questions.slice(0, p1End);
    }

    // Shuffle questions within each part (using session-based seed for consistency)
    if (!shuffledPartQuestions.current[currentPart] && partQuestions.length > 0) {
      // Use sessionId as seed base for deterministic but random-looking order
      const sessionSeed = sessionId ? sessionId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : 42;
      shuffledPartQuestions.current[currentPart] = shuffleArray(partQuestions, sessionSeed + currentPart * 1000);
    }

    return shuffledPartQuestions.current[currentPart] || partQuestions;
  }, [questions, currentPart, sessionId]);

  const currentPartQuestions = getCurrentPartQuestions();
  const currentQuestion = currentPartQuestions[currentQuestionIdx];
  const totalParts = 4;
  const overallProgress = ((currentPart - 1) * 25 + (currentQuestionIdx / Math.max(currentPartQuestions.length, 1)) * 25);

  const submitAnswer = async (input: SubmitAnswerInput) => {
    try {
      const res = await fetch('/api/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const { error } = await res.json();
      if (error) console.error('Submit answer error:', error);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePart1Answer = async (isRecognized: boolean) => {
    if (!currentQuestion) return;
    const reactionTime = Date.now() - questionStartTime.current;
    const isCorrect = isRecognized;

    await submitAnswer({
      session_id: sessionId!,
      question_id: currentQuestion.id,
      part: 1,
      is_recognized: isRecognized,
      is_correct: isCorrect,
      reaction_time_ms: reactionTime,
    });

    // Update progress
    const xp = getXP(1, isCorrect);
    setTotalXP((prev) => prev + xp);
    setXpPopup({ amount: xp, id: ++xpPopupId.current });
    setTimeout(() => setXpPopup(null), 1000);

    setPartProgress((prev) => ({
      ...prev,
      1: {
        ...prev[1],
        correctCount: prev[1].correctCount + (isCorrect ? 1 : 0),
        totalCount: prev[1].totalCount + 1,
      },
    }));

    advanceQuestion(isCorrect);
  };

  const handlePart2Answer = async (selectedAnswer: string) => {
    if (!currentQuestion) return;
    const reactionTime = Date.now() - questionStartTime.current;
    const isCorrect = selectedAnswer === currentQuestion.answer;

    await submitAnswer({
      session_id: sessionId!,
      question_id: currentQuestion.id,
      part: 2,
      selected_answer: selectedAnswer,
      is_correct: isCorrect,
      reaction_time_ms: reactionTime,
    });

    setShowFeedback(isCorrect ? 'correct' : 'wrong');
    setTimeout(() => setShowFeedback(null), 600);

    const xp = getXP(2, isCorrect);
    setTotalXP((prev) => prev + xp);
    setXpPopup({ amount: xp, id: ++xpPopupId.current });
    setTimeout(() => setXpPopup(null), 1000);

    setPartProgress((prev) => ({
      ...prev,
      2: {
        ...prev[2],
        correctCount: prev[2].correctCount + (isCorrect ? 1 : 0),
        totalCount: prev[2].totalCount + 1,
      },
    }));

    advanceQuestion(isCorrect);
  };

  const handlePart3Answer = async (selectedAnswer: string) => {
    if (!currentQuestion) return;
    const reactionTime = Date.now() - questionStartTime.current;
    const isCorrect = selectedAnswer === currentQuestion.answer;

    await submitAnswer({
      session_id: sessionId!,
      question_id: currentQuestion.id,
      part: 3,
      selected_answer: selectedAnswer,
      is_correct: isCorrect,
      reaction_time_ms: reactionTime,
    });

    setShowFeedback(isCorrect ? 'correct' : 'wrong');
    setTimeout(() => setShowFeedback(null), 600);

    const xp = getXP(3, isCorrect);
    setTotalXP((prev) => prev + xp);
    setXpPopup({ amount: xp, id: ++xpPopupId.current });
    setTimeout(() => setXpPopup(null), 1000);

    setPartProgress((prev) => ({
      ...prev,
      3: {
        ...prev[3],
        correctCount: prev[3].correctCount + (isCorrect ? 1 : 0),
        totalCount: prev[3].totalCount + 1,
      },
    }));

    advanceQuestion(isCorrect);
  };

  const handlePart4Answer = async (selectedAnswer: string) => {
    if (!currentQuestion) return;
    const reactionTime = Date.now() - questionStartTime.current;
    const storyAnswer = currentQuestion.story_answer || currentQuestion.answer;
    const isCorrect = selectedAnswer === storyAnswer;

    await submitAnswer({
      session_id: sessionId!,
      question_id: currentQuestion.id,
      part: 4,
      selected_answer: selectedAnswer,
      is_correct: isCorrect,
      reaction_time_ms: reactionTime,
    });

    setShowFeedback(isCorrect ? 'correct' : 'wrong');
    setTimeout(() => setShowFeedback(null), 600);

    const xp = getXP(4, isCorrect);
    setTotalXP((prev) => prev + xp);
    setXpPopup({ amount: xp, id: ++xpPopupId.current });
    setTimeout(() => setXpPopup(null), 1000);

    setPartProgress((prev) => ({
      ...prev,
      4: {
        ...prev[4],
        correctCount: prev[4].correctCount + (isCorrect ? 1 : 0),
        totalCount: prev[4].totalCount + 1,
      },
    }));

    advanceQuestion(isCorrect);
  };

  const advanceQuestion = (isCorrect: boolean) => {
    setTimeout(() => {
      if (currentQuestionIdx + 1 >= currentPartQuestions.length) {
        // Part completed
        const stars = getStarsForPart(
          partProgress[currentPart].correctCount + (isCorrect ? 1 : 0),
          partProgress[currentPart].totalCount + 1
        );
        const badge = getBadgeForPart(currentPart, stars);
        setPartProgress((prev) => ({
          ...prev,
          [currentPart]: { ...prev[currentPart], completed: true, stars, badge },
        }));
        setShowPartComplete(true);
      } else {
        setCurrentQuestionIdx((prev) => prev + 1);
        questionStartTime.current = Date.now();
      }
    }, 300);
  };

  const handleNextPart = () => {
    setShowPartComplete(false);
    if (currentPart < 4) {
      setCurrentPart((prev) => (prev + 1) as TestPart);
      setCurrentQuestionIdx(0);
      questionStartTime.current = Date.now();
    } else {
      finishTest();
    }
  };

  const finishTest = async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    
    try {
      // Complete the session
      await fetch('/api/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, status: 'completed' }),
      });

      // Calculate and save results
      await fetch('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });

      router.push(`/result?sessionId=${sessionId}`);
    } catch (err) {
      console.error(err);
      router.push(`/result?sessionId=${sessionId}`);
    }
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🐵</div>
          <p className="font-display text-xl text-[var(--color-src-text)]">正在准备题目...</p>
        </div>
      </div>
    );
  }

  if (!questions.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-center card-game p-8">
          <div className="text-5xl mb-4">😕</div>
          <p className="font-display text-xl text-[var(--color-src-text)] mb-4">题库暂时为空</p>
          <p className="text-[var(--color-src-text-light)]">请管理员导入题库后重试</p>
        </div>
      </div>
    );
  }

  // Part completion overlay
  if (showPartComplete) {
    const progress = partProgress[currentPart];
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)] px-4">
        <div className="card-game text-center max-w-sm w-full animate-bounce-in">
          <div className="text-6xl mb-4">
            {progress.stars >= 3 ? '🎉' : progress.stars >= 2 ? '👏' : '👍'}
          </div>
          <h2 className="font-display text-2xl text-[var(--color-src-text)] mb-2">
            {PART_NAMES[currentPart]}完成！
          </h2>
          <div className="flex justify-center gap-1 mb-4">
            {[1, 2, 3].map((s) => (
              <span key={s} className={`text-3xl ${s <= progress.stars ? 'animate-star-spin' : 'opacity-30'}`} style={{ animationDelay: `${s * 0.15}s` }}>
                ⭐
              </span>
            ))}
          </div>
          {progress.badge && (
            <div className="inline-block bg-[var(--color-src-accent)] px-4 py-2 rounded-full mb-4">
              <span className="font-display text-[var(--color-src-text)]">🏅 {progress.badge}</span>
            </div>
          )}
          <div className="text-[var(--color-src-text-light)] mb-6">
            正确 {progress.correctCount}/{progress.totalCount} · +{totalXP} XP
          </div>
          <button
            onClick={handleNextPart}
            className="btn-game bg-[var(--color-src-primary)] text-white w-full"
          >
            {currentPart < 4 ? `${PART_NAMES[(currentPart + 1) as TestPart]} →` : '查看结果 🎊'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-src-bg)]">
      {/* Top bar: timer + progress */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-sm shadow-sm px-4 py-3">
        <div className="max-w-lg mx-auto">
          <div className="flex justify-between items-center mb-2">
            <div className="font-display text-sm text-[var(--color-src-text)]">
              {PART_NAMES[currentPart]}
            </div>
            <div className={`font-display text-lg ${timeLeft <= 30 ? 'text-[var(--color-src-error)] animate-pulse' : 'text-[var(--color-src-text)]'}`}>
              ⏱ {formatTime(timeLeft)}
            </div>
            <div className="text-sm text-[var(--color-src-accent)] font-bold">
              +{totalXP} XP
            </div>
          </div>
          <div className="progress-bar-game">
            <div style={{ width: `${overallProgress}%` }} />
          </div>
          <div className="flex justify-between mt-2">
            {[1, 2, 3, 4].map((p) => (
              <div key={p} className="flex items-center gap-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  partProgress[p as TestPart].completed
                    ? 'bg-[var(--color-src-success)] text-white'
                    : p === currentPart
                    ? 'bg-[var(--color-src-primary)] text-white'
                    : 'bg-[var(--color-src-text-light)]/20 text-[var(--color-src-text-light)]'
                }`}>
                  {partProgress[p as TestPart].completed ? '✓' : p}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg">
          {/* XP popup */}
          {xpPopup && (
            <div key={xpPopup.id} className="fixed top-20 right-8 font-display text-2xl text-[var(--color-src-accent)] animate-float-up z-30">
              +{xpPopup.amount} XP
            </div>
          )}

          {/* Feedback overlay */}
          {showFeedback && (
            <div className={`fixed inset-0 flex items-center justify-center z-40 pointer-events-none ${
              showFeedback === 'correct' ? 'bg-[var(--color-src-success)]/10' : 'bg-[var(--color-src-error)]/10'
            }`}>
              <div className={`text-8xl animate-bounce-in ${showFeedback === 'wrong' ? 'animate-shake' : ''}`}>
                {showFeedback === 'correct' ? '✨' : '💪'}
              </div>
            </div>
          )}

          {currentQuestion && (
            <div className="card-game animate-bounce-in" key={`${currentPart}-${currentQuestionIdx}`}>
              {/* Part 1: Character Recognition */}
              {currentPart === 1 && (
                <div className="text-center">
                  <div className="text-sm text-[var(--color-src-text-light)] mb-4">
                    你认识这个字吗？
                  </div>
                  <div className="w-32 h-32 mx-auto bg-[var(--color-src-accent)]/30 rounded-3xl flex items-center justify-center mb-8">
                    <span className="text-6xl text-[var(--color-src-text)]" style={CHINESE_READABLE_FONT}>
                      {currentQuestion.character}
                    </span>
                  </div>
                  <div className="text-sm text-[var(--color-src-text-light)] mb-6">
                    {currentQuestionIdx + 1} / {currentPartQuestions.length}
                  </div>
                  <div className="flex gap-4">
                    <button
                      onClick={() => handlePart1Answer(false)}
                      className="btn-game flex-1 bg-[var(--color-src-text-light)]/10 text-[var(--color-src-text)] border-2 border-[var(--color-src-text-light)]/20"
                    >
                      😕 不认识
                    </button>
                    <button
                      onClick={() => handlePart1Answer(true)}
                      className="btn-game flex-1 bg-[var(--color-src-primary)] text-white"
                    >
                      😊 认识
                    </button>
                  </div>
                </div>
              )}

              {/* Part 2: Vocabulary Recognition */}
              {currentPart === 2 && (
                <div className="text-center">
                  <div className="text-sm text-[var(--color-src-text-light)] mb-4">
                    请选择正确意思
                  </div>
                  <div className="w-40 h-20 mx-auto bg-[var(--color-src-secondary)]/20 rounded-2xl flex items-center justify-center mb-4">
                    <span className="text-4xl text-[var(--color-src-text)]" style={CHINESE_READABLE_FONT}>
                      {currentQuestion.word}
                    </span>
                  </div>
                  <p className="text-[var(--color-src-text)] mb-6">{currentQuestion.meaning_question}</p>
                  <div className="space-y-3">
                    {getShuffledOptions(`p2-${currentQuestion.id}`, currentQuestion.options).map((option: string, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => handlePart2Answer(option)}
                        className="btn-game w-full bg-white border-2 border-[var(--color-src-primary)]/20 text-[var(--color-src-text)] text-lg hover:border-[var(--color-src-primary)]"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Part 3: Sentence Recognition */}
              {currentPart === 3 && (
                <div className="text-center">
                  <div className="text-sm text-[var(--color-src-text-light)] mb-4">
                    阅读句子，回答问题
                  </div>
                  <div className="bg-[var(--color-src-secondary)]/10 rounded-2xl p-5 mb-6">
                    <p className="text-xl text-[var(--color-src-text)] leading-relaxed" style={CHINESE_READABLE_FONT}>
                      {currentQuestion.sentence}
                    </p>
                  </div>
                  <p className="text-[var(--color-src-text)] font-medium mb-6">
                    {currentQuestion.meaning_question}
                  </p>
                  <div className="space-y-3">
                    {getShuffledOptions(`p3-${currentQuestion.id}`, currentQuestion.options).map((option: string, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => handlePart3Answer(option)}
                        className="btn-game w-full bg-white border-2 border-[var(--color-src-primary)]/20 text-[var(--color-src-text)] text-lg hover:border-[var(--color-src-primary)]"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Part 4: Comprehension */}
              {currentPart === 4 && (
                <div className="text-center">
                  <div className="text-sm text-[var(--color-src-text-light)] mb-4">
                    📖 阅读理解
                  </div>
                  <div className="bg-[var(--color-src-accent)]/20 rounded-2xl p-5 mb-6 text-left">
                    <p className="text-[var(--color-src-text)] leading-relaxed text-lg" style={CHINESE_READABLE_FONT}>
                      {currentQuestion.story_text || currentQuestion.sentence}
                    </p>
                  </div>
                  <p className="text-[var(--color-src-text)] font-medium mb-6">
                    {currentQuestion.story_question || currentQuestion.meaning_question}
                  </p>
                  <div className="space-y-3">
                    {getShuffledOptions(`p4-${currentQuestion.id}`, currentQuestion.story_options || currentQuestion.options).map((option: string, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => handlePart4Answer(option)}
                        className="btn-game w-full bg-white border-2 border-[var(--color-src-primary)]/20 text-[var(--color-src-text)] text-lg hover:border-[var(--color-src-primary)]"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TestPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-2xl">加载中...</div>
      </div>
    }>
      <TestContent />
    </Suspense>
  );
}
