'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCharList, getWordList } from '@/lib/questions';
import { generateCharacterTest } from '@/lib/item-selection';
import { selectVocabularyTest, type SampledVocabulary } from '@/lib/vocabulary-sampling';
import { LEVEL_CONFIG, type Level, type CharTestResult, type SampledItem } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[], seed: number): T[] {
  const result = [...array];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Generate a random seed
const randomSeed = Math.floor(Math.random() * 1000000);

function FullTestContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, activeChild, authFetch, loading: authLoading } = useAuth();
  const isLoggedIn = !!user;

  const [childId, setChildId] = useState('');
  const [childName, setChildName] = useState('');
  const rawLevel = searchParams.get('level') || 'SRC300';
  const VALID_LEVELS: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  const levelValid = VALID_LEVELS.includes(rawLevel as Level);
  const level = (levelValid ? rawLevel : 'SRC300') as Level;

  // 已登录时从 activeChild 获取 childId
  useEffect(() => {
    if (isLoggedIn && activeChild) {
      setChildId(activeChild.id);
      setChildName(activeChild.nickname || '');
    } else {
      // 未登录时从 URL 获取
      const urlChildId = searchParams.get('childId') || '';
      const urlChildName = searchParams.get('childName') || '';
      setChildId(urlChildId);
      setChildName(urlChildName);
    }
  }, [isLoggedIn, activeChild, searchParams]);

  // State
  const [phase, setPhase] = useState<'intro' | 'chars' | 'words' | 'done'>('intro');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<CharTestResult[]>([]);
  const [wordResults, setWordResults] = useState<{ word: string; recognized: boolean; reaction_time_ms: number }[]>([]);
  const [showFeedback, setShowFeedback] = useState<'known' | 'unknown' | null>(null);
  const [questionStartTime, setQuestionStartTime] = useState(0);
  const [testStartTime, setTestStartTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Character list (smart sampling, not all)
  const charList = useMemo(() => getCharList(level), [level]);
  const wordList = useMemo(() => getWordList(level), [level]);
  
  // Sampled items (smart selection)
  const [sampledChars, setSampledChars] = useState<SampledItem[]>([]);
  const [sampledWords, setSampledWords] = useState<SampledItem[]>([]);
  const currentCharList = sampledChars.map(s => s.content);
  const currentWordList = sampledWords.map(s => s.content);
  const currentList = phase === 'chars' ? currentCharList : currentWordList;
  const currentItem = currentList[currentIndex];
  const totalItems = currentList.length;
  const progress = ((currentIndex) / totalItems) * 100;

  // Count recognized/unknown
  const knownCount = results.filter(r => r.recognized).length;
  const unknownCount = results.filter(r => !r.recognized).length;
  const wordKnownCount = wordResults.filter(r => r.recognized).length;

  const handleAnswer = (recognized: boolean) => {
    if (!currentItem) return;
    const reactionTime = Date.now() - questionStartTime;

    const result: CharTestResult = {
      character: currentItem,
      recognized,
      reaction_time_ms: reactionTime,
    };

    if (phase === 'chars') {
      setResults(prev => [...prev, result]);
    } else {
      setWordResults(prev => [...prev, { word: currentItem, recognized, reaction_time_ms: reactionTime }]);
    }

    // Show brief feedback
    setShowFeedback(recognized ? 'known' : 'unknown');
    setTimeout(() => {
      setShowFeedback(null);

      if (currentIndex + 1 < totalItems) {
        setCurrentIndex(prev => prev + 1);
        setQuestionStartTime(Date.now());
      } else {
        // Phase complete
        if (phase === 'chars') {
          // V1.0 分层词组抽测算法
          const allCharResults = [...results, { character: currentItem, recognized, reaction_time_ms: reactionTime }];

          const { sampled: sampledVocab } = selectVocabularyTest(
            wordList,
            level,
            charList,
            allCharResults.map(r => ({
              character: r.character,
              is_correct: r.recognized,
              reaction_time_ms: r.reaction_time_ms,
            })),
          );

          // 转换为 SampledItem 格式以兼容现有UI
          const poolMap: Record<string, 'review' | 'new' | 'retention'> = {
            core: 'new',        // 核心词组 → 新题
            validation: 'review', // 单字验证 → 复测
            coverage: 'retention', // 覆盖补充 → 稳定性
          };
          const vocabItems: SampledItem[] = sampledVocab.map(v => ({
            content: v.vocabulary,
            type: 'word',
            poolType: poolMap[v.pool],
            priority: v.selection_score,
            level,
          }));

          setSampledWords(vocabItems);
          setPhase('words');
          setCurrentIndex(0);
          setQuestionStartTime(Date.now());
        } else {
          setPhase('done');
        }
      }
    }, 400);
  };

  // Keyboard support
  useEffect(() => {
    if (phase !== 'chars' && phase !== 'words') return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === '1' || e.key === 'z') {
        handleAnswer(true);
      } else if (e.key === 'ArrowRight' || e.key === '2' || e.key === 'x') {
        handleAnswer(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [phase, currentItem, currentIndex, totalItems, questionStartTime]);

  // Save results to database when done
  const saveAndGoToResult = async () => {
    // 逐字测试：识字量 = 字形识别认识的字数，词汇量 = 词汇识别认识的词数
    // 因为300字库逐个测试了，认识数就是稳定识字量/词汇量
    const charMasteryRate = results.length > 0 ? knownCount / results.length : 0;
    const vocabMasteryRate = wordResults.length > 0 ? wordKnownCount / wordResults.length : 0;
    const stableCharCount = knownCount; // 直接用认识的字数
    const stableVocabCount = wordKnownCount; // 直接用认识的词数
    const totalScore = Math.round((charMasteryRate * 0.5 + vocabMasteryRate * 0.5) * 100);
    const charMasteryPct = Math.round(charMasteryRate * 100);
    const vocabMasteryPct = Math.round(vocabMasteryRate * 100);

    // Collect known characters for the child's character library
    const knownChars = results.filter(r => r.recognized).map(r => r.character);
    const knownWords = wordResults.filter(r => r.recognized).map(r => r.word);

    // Calculate actual completion time in seconds
    const completionTimeSeconds = testStartTime > 0
      ? Math.max(1, Math.round((Date.now() - testStartTime) / 1000))
      : 0;

    // Save to test_results via API in the background (don't wait for it)
    if (childId) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (isLoggedIn) {
          const token = localStorage.getItem('src_session_token');
          if (token) headers['x-session'] = token;
        }
        const sessionRes = await fetch('/api/sessions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ child_id: childId, level, test_mode: 'formal' }),
        });
        const { data: sessionData } = await sessionRes.json();
        if (sessionData?.id) {
          // Save answers for each item (batch mode)
          const allAnswers = [
            ...results.map((r) => ({
              question_content: r.character,
              part: 1 as number,
              is_correct: r.recognized,
              reaction_time_ms: r.reaction_time_ms,
              answer: r.recognized ? 'known' : 'unknown',
            })),
            ...wordResults.map((r) => ({
              question_content: r.word,
              part: 2 as number,
              is_correct: r.recognized,
              reaction_time_ms: r.reaction_time_ms,
              answer: r.recognized ? 'known' : 'unknown',
            })),
          ];
          // Save answers in background (batch)
          fetch('/api/answers', {
            method: 'POST',
            headers,
            body: JSON.stringify({ session_id: sessionData.id, answers: allAnswers }),
          }).catch(() => {});

          // Complete session
          fetch(`/api/sessions?id=${sessionData.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ status: 'completed' }),
          }).catch(() => {});

          // Save result with pre-calculated values
          fetch('/api/results', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              session_id: sessionData.id,
              child_id: childId,
              level,
              character_score: charMasteryPct,
              vocab_score: vocabMasteryPct,
              reading_score: totalScore,
              comprehension_score: totalScore,
              total_score: totalScore,
              stable_char_count: stableCharCount,
              stable_vocab_count: stableVocabCount,
              character_mastery_rate: charMasteryPct,
              vocab_mastery_rate: vocabMasteryPct,
              reading_comprehension_rate: Math.round((charMasteryPct + vocabMasteryPct) / 2),
              completion_time_seconds: completionTimeSeconds,
              skip_recalculate: true,
              known_characters: knownChars,  // 只存单字，词组不计入识字量
            }),
          }).catch(() => {});
        }
      } catch {
        // Background save failed, not critical
      }
    }

    const testedCharCount = results.length;
    const correctCharCount = results.filter(r => r.recognized).length;
    const testedVocabCount = wordResults.length;
    const correctVocabCount = wordResults.filter(r => r.recognized).length;

    // Always navigate with URL params to ensure accurate data display
    router.push(
      `/result?mode=full&level=${level}` +
      `&testedChars=${testedCharCount}&correctChars=${correctCharCount}` +
      `&testedVocab=${testedVocabCount}&correctVocab=${correctVocabCount}` +
      `&score=${totalScore}` +
      `&charMastery=${charMasteryPct}` +
      `&vocabMastery=${vocabMasteryPct}` +
      `&duration=${completionTimeSeconds}`
    );
  };

  // Invalid level screen
  if (phase === 'intro' && !levelValid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-[var(--color-src-bg)]">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-6">🤔</div>
          <h1 className="font-display text-2xl text-[var(--color-src-text)] mb-3">
            等级不正确
          </h1>
          <p className="text-[var(--color-src-text-light)] mb-8">
            请从 Hub 选择正确的测试等级重新进入。
          </p>
          <button
            onClick={() => router.push('/hub')}
            className="w-full rounded-2xl px-8 py-4 font-display text-lg font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105"
            style={{ backgroundColor: 'var(--color-src-primary)' }}
          >
            返回我的中文世界
          </button>
        </div>
      </div>
    );
  }

  // Intro screen
  if (phase === 'intro') {
    const cfg = LEVEL_CONFIG[level];
    const estChars = Math.round(cfg.charCount * cfg.charSampleRatio);
    const estWords = Math.round(cfg.vocabCount * cfg.wordSampleRatio);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-[var(--color-src-bg)]">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-6">📝</div>
          <h1 className="font-display text-3xl text-[var(--color-src-text)] mb-3">
            逐字测试
          </h1>
          <p className="text-[var(--color-src-text-light)] mb-6">
            智能抽选{LEVEL_CONFIG[level].charSampleRatio * 100}%重点字和词，精准掌握度动态调整
          </p>

          <div className="card-game space-y-3 text-left mb-6">
            <div className="flex items-center gap-3 p-3 bg-white rounded-xl">
              <span className="text-2xl">1️⃣</span>
              <div>
                <div className="font-medium text-[var(--color-src-text)]">字形识别</div>
                <div className="text-sm text-[var(--color-src-text-light)]">智能抽选约{Math.round(charList.length * LEVEL_CONFIG[level].charSampleRatio)}个字</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-white rounded-xl">
              <span className="text-2xl">2️⃣</span>
              <div>
                <div className="font-medium text-[var(--color-src-text)]">词汇识别</div>
                <div className="text-sm text-[var(--color-src-text-light)]">智能抽选约{Math.round(wordList.length * LEVEL_CONFIG[level].wordSampleRatio)}个词</div>
              </div>
            </div>
          </div>

          <div className="bg-[var(--color-src-accent)]/20 rounded-2xl p-4 mb-6">
            <p className="text-sm text-[var(--color-src-text)]">
              💡 <strong>提示</strong>：看到字或词后，快速选择「认识」或「不认识」，不需要思考太久
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => {
                // V1.0: Smart character sampling (not full test)
                const sampled = generateCharacterTest({
                  allCharacters: charList,
                  totalCharCount: charList.length,
                  masteryMap: new Map(), // no history, first test
                  level,
                  isFirstTest: true,
                });
                setSampledChars(sampled);
                setPhase('chars');
                setCurrentIndex(0);
                setQuestionStartTime(Date.now());
                setTestStartTime(Date.now());
              }}
              className="w-full rounded-2xl px-8 py-4 font-display text-xl font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg"
              style={{ backgroundColor: 'var(--color-src-primary)' }}
            >
              开始逐字测试 🚀
            </button>
            <button
              onClick={() => router.push('/')}
              className="w-full rounded-2xl px-8 py-3 font-display text-lg transition-all duration-200 active:scale-95 hover:scale-105"
              style={{ backgroundColor: 'rgba(99,110,114,0.15)', color: 'var(--color-src-text)' }}
            >
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Done screen
  if (phase === 'done') {
    const totalKnown = knownCount + wordKnownCount;
    const totalTested = results.length + wordResults.length;
    const masteryRate = totalTested > 0 ? Math.round((totalKnown / totalTested) * 100) : 0;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-[var(--color-src-bg)]">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4 animate-bounce-in">🎉</div>
          <h1 className="font-display text-3xl text-[var(--color-src-text)] mb-3">
            测试完成！
          </h1>

          <div className="card-game space-y-4 mb-6">
            <div className="bg-white rounded-2xl p-4">
              <div className="text-sm text-[var(--color-src-text-light)] mb-1">字形识别</div>
              <div className="flex justify-between items-center">
                <span className="font-display text-2xl text-[var(--color-src-primary)]">
                  {knownCount} / {results.length}
                </span>
                <span className="text-sm text-[var(--color-src-secondary)]">
                  {results.length > 0 ? Math.round((knownCount / results.length) * 100) : 0}% 认识
                </span>
              </div>
            </div>
            <div className="bg-white rounded-2xl p-4">
              <div className="text-sm text-[var(--color-src-text-light)] mb-1">词汇识别</div>
              <div className="flex justify-between items-center">
                <span className="font-display text-2xl text-[var(--color-src-secondary)]">
                  {wordKnownCount} / {wordResults.length}
                </span>
                <span className="text-sm text-[var(--color-src-primary)]">
                  {wordResults.length > 0 ? Math.round((wordKnownCount / wordResults.length) * 100) : 0}% 认识
                </span>
              </div>
            </div>
            <div className="bg-[var(--color-src-accent)]/20 rounded-2xl p-4">
              <div className="text-sm text-[var(--color-src-text-light)] mb-1">综合掌握率</div>
              <div className="font-display text-4xl text-[var(--color-src-primary)]">
                {masteryRate}%
              </div>
            </div>
          </div>

          <button
            onClick={saveAndGoToResult}
            className="w-full rounded-2xl px-8 py-4 font-display text-xl font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg"
            style={{ backgroundColor: 'var(--color-src-primary)' }}
          >
            查看详细结果 ⭐
          </button>
        </div>
      </div>
    );
  }

  // Testing screen (chars or words)
  return (
    <div className="min-h-screen flex flex-col px-4 py-6 bg-[var(--color-src-bg)]">
      {/* Top bar */}
      <div className="max-w-md mx-auto w-full">
        {/* Mode label */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-[var(--color-src-text-light)]">
            {phase === 'chars' ? '🔤 字形识别' : '📖 词汇识别'}
          </span>
          <span className="text-sm text-[var(--color-src-text-light)]">
            {currentIndex + 1} / {totalItems}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-3 bg-white/60 rounded-full overflow-hidden mb-6 shadow-inner">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${progress}%`,
              backgroundColor: phase === 'chars' ? 'var(--color-src-primary)' : 'var(--color-src-secondary)',
            }}
          />
        </div>

        {/* Stats */}
        <div className="flex justify-center gap-6 mb-8">
          <div className="text-center">
            <div className="font-display text-2xl text-[var(--color-src-secondary)]">
              {phase === 'chars' ? knownCount : wordKnownCount}
            </div>
            <div className="text-xs text-[var(--color-src-text-light)]">认识</div>
          </div>
          <div className="text-center">
            <div className="font-display text-2xl text-[var(--color-src-error)]">
              {phase === 'chars' ? unknownCount : (currentIndex - wordKnownCount > 0 ? currentIndex + 1 - wordKnownCount : 0)}
            </div>
            <div className="text-xs text-[var(--color-src-text-light)]">不认识</div>
          </div>
        </div>

        {/* Character/Word display */}
        <div className="flex items-center justify-center mb-6">
          <div
            className={`bg-white rounded-3xl shadow-lg flex items-center justify-center transition-all duration-300 ${
              showFeedback === 'known'
                ? 'scale-110 border-4 border-[var(--color-src-success)]'
                : showFeedback === 'unknown'
                  ? 'scale-95 border-4 border-[var(--color-src-error)]'
                  : ''
            }`}
            style={{
              width: phase === 'chars' ? '200px' : '260px',
              height: phase === 'chars' ? '200px' : '160px',
            }}
          >
            <span
              className="text-[var(--color-src-text)] font-bold"
              style={{
                fontSize: phase === 'chars' ? '96px' : '56px',
                fontFamily: "'KaiTi', 'STKaiti', '楷体', 'Microsoft YaHei', '微软雅黑', 'SimHei', '黑体', sans-serif",
              }}
            >
              {currentItem}
            </span>
          </div>
        </div>

        {/* 智能抽测原因提示（词组测试阶段） */}
        {phase === 'words' && sampledWords[currentIndex] && (
          <div className="text-center mb-8">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-medium"
              style={{
                backgroundColor: 'var(--color-src-accent)',
                color: 'var(--color-src-text)',
                opacity: 0.8,
              }}
            >
              🎯 {sampledWords[currentIndex].poolType === 'review' ? '重点复习' :
                  sampledWords[currentIndex].poolType === 'new' ? '新字挑战' :
                  '巩固检测'}
            </span>
          </div>
        )}

        {/* Answer buttons */}
        <div className="flex gap-4 max-w-sm mx-auto">
          <button
            onClick={() => handleAnswer(true)}
            disabled={showFeedback !== null}
            className="flex-1 rounded-2xl py-5 font-display text-xl font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-src-secondary)' }}
          >
            ✓ 认识
          </button>
          <button
            onClick={() => handleAnswer(false)}
            disabled={showFeedback !== null}
            className="flex-1 rounded-2xl py-5 font-display text-xl font-bold text-white transition-all duration-200 active:scale-95 hover:scale-105 hover:shadow-lg disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-src-error)' }}
          >
            ✗ 不认识
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="text-center mt-4 text-xs text-[var(--color-src-text-light)]">
          键盘快捷键：← 认识 | → 不认识
        </div>

        {/* Feedback overlay */}
        {showFeedback && (
          <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
            <div
              className={`text-6xl animate-bounce-in ${
                showFeedback === 'known' ? 'opacity-80' : 'opacity-60'
              }`}
            >
              {showFeedback === 'known' ? '⭐' : '💪'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FullTestPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)]">
        <div className="text-2xl animate-bounce">🐵</div>
      </div>
    }>
      <FullTestContent />
    </Suspense>
  );
}
