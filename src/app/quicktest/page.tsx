'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  generateAdaptiveAssessment,
  calculateQuickResult,
  type AssessmentQuestion,
  type AnswerRecord,
  type QuickAssessmentResult,
  ASSESSMENT_CONFIG,
} from '@/lib/quick-assessment';
import { Star, Sparkles, ChevronRight } from 'lucide-react';

// 测试阶段
type Phase = 'intro' | 'testing' | 'result';

export default function QuickTestPage() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [questionStart, setQuestionStart] = useState(0);
  const [sessionStart, setSessionStart] = useState(0);
  const [result, setResult] = useState<QuickAssessmentResult | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [answerAnim, setAnswerAnim] = useState<'' | 'correct' | 'wrong'>('');
  const [showLevelUp, setShowLevelUp] = useState(false);

  // 生成/获取稳定的匿名 device_id
  const getDeviceId = (): string => {
    let devId = typeof window !== 'undefined' ? localStorage.getItem('src_device_id') : null;
    if (!devId) {
      devId = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      if (typeof window !== 'undefined') {
        localStorage.setItem('src_device_id', devId);
      }
    }
    return devId;
  };

  // 初始化测试
  const startTest = () => {
    const { questions: qs } = generateAdaptiveAssessment();
    setQuestions(qs);
    setCurrentIndex(0);
    setAnswers([]);
    setSessionStart(Date.now());
    setQuestionStart(Date.now());
    setPhase('testing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  // 当前题目
  const currentQ = questions[currentIndex];

  // 进度：计分题数 / 预估总题数
  const progress = useMemo(() => {
    if (questions.length === 0) return 0;
    const scoredSoFar = answers.filter((a) => a.scoring).length;
    // 预估总题数（四级基础题的计分题量）
    const estimated =
      ASSESSMENT_CONFIG.questionsPerLevelCharacter * 4 +
      ASSESSMENT_CONFIG.questionsPerLevelWord * 4;
    return Math.min(100, Math.round((scoredSoFar / estimated) * 100));
  }, [answers, questions.length]);

  // 处理答案
  const handleAnswer = (userAnswer: boolean) => {
    if (!currentQ) return;
    const now = Date.now();
    const rt = now - questionStart;

    const record: AnswerRecord = {
      questionId: currentQ.id,
      questionContent: currentQ.content,
      questionType: currentQ.type,
      minimumSrcLevel: currentQ.minimumSrcLevel,
      questionRole: currentQ.role,
      userAnswer,
      correct: userAnswer, // 自报型，"认识"本身就是答案
      responseTimeMs: rt,
      sequenceNumber: currentIndex,
      scoring: currentQ.scoring,
    };

    const newAnswers = [...answers, record];
    setAnswers(newAnswers);

    // 反馈动画
    setAnswerAnim(userAnswer ? 'correct' : 'wrong');
    setTimeout(() => setAnswerAnim(''), 350);

    // 判断是否需要结束测试（基于已答计分题的粗略自适应）
    // 这里简化处理：按顺序推进，所有题做完即结束
    // 真实自适应会在服务端根据答题情况动态生成边界确认题
    setTimeout(() => {
      if (currentIndex + 1 >= questions.length) {
        // 测试完成
        const totalTime = Date.now() - sessionStart;
        const res = calculateQuickResult(newAnswers, totalTime);
        setResult(res);
        // 保存到 localStorage（当前结果）
        localStorage.setItem('src_quick_test_results_v2', JSON.stringify(res));
        const deviceId = getDeviceId();
        // 提交到后端保存 guest session
        fetch('/api/guest/test-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: deviceId,
            result_data: res,
            answers: newAnswers.map(a => ({
              question_id: a.questionId,
              question_type: a.questionType,
              minimum_src_level: a.minimumSrcLevel,
              question_role: a.questionRole,
              item_content: a.questionContent,
              user_answer: a.userAnswer,
              correct: a.correct,
              response_time_ms: a.responseTimeMs,
              scoring: a.scoring,
              sequence_number: a.sequenceNumber,
            })),
          }),
        }).then(async (resp) => {
          if (resp.ok) {
            const data = await resp.json();
            if (data.guest_session_id) {
              setCurrentSessionId(data.guest_session_id);
              localStorage.setItem('src_guest_session_id', data.guest_session_id);
              // 将 session_id 写入 result 并重新保存，供 quickresult 页面读取
              const resWithSession = { ...res, guestSessionId: data.guest_session_id };
              localStorage.setItem('src_quick_test_results_v2', JSON.stringify(resWithSession));
              setResult(resWithSession);
            }
          }
          // 保存完成后再跳转，确保 result 带 session_id
          window.location.href = '/quickresult';
        }).catch(() => {
          // 失败不影响用户体验，仍然跳转
          window.location.href = '/quickresult';
        });
      } else {
        setCurrentIndex(currentIndex + 1);
        setQuestionStart(Date.now());
      }
    }, 300);
  };

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase !== 'testing') return;
      if (e.key === 'ArrowLeft' || e.key === '1') handleAnswer(true);
      if (e.key === 'ArrowRight' || e.key === '2') handleAnswer(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex]);

  // ============== 渲染 ==============

  if (phase === 'intro') {
    return <IntroPage onStart={startTest} />;
  }

  if (phase === 'result' && result) {
    return null; // 已经跳转到结果页
  }

  if (!currentQ) return null;

  const isChar = currentQ.type === 'character';
  const scoredCount = answers.filter((a) => a.scoring).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-amber-50 to-white flex flex-col">
      {/* 顶部进度条 */}
      <div className="w-full px-4 pt-4 pb-2">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground font-medium">
              第 {scoredCount + (currentQ.scoring ? 1 : 0)} 题
            </span>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(10, scoredCount) }).map((_, i) => (
                <Star
                  key={i}
                  size={14}
                  className="fill-yellow-400 text-yellow-400"
                />
              ))}
            </div>
          </div>
          <div className="w-full h-3 bg-white/80 rounded-full border border-orange-200 overflow-hidden shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-orange-400 to-amber-400 transition-all duration-500 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* 主题目区 */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="max-w-lg w-full">
          {/* 题型小提示 */}
          <div className="text-center mb-6">
            <span className="inline-block px-4 py-1 bg-white/80 rounded-full text-sm text-muted-foreground border border-orange-100">
              {isChar ? '看看你认不认识这个字' : '看看你认不认识这个词'}
            </span>
          </div>

          {/* 大字显示 */}
          <div
            className={`text-center py-12 mb-8 transition-all duration-300 ${
              answerAnim === 'correct' ? 'scale-105' : ''
            } ${answerAnim === 'wrong' ? 'opacity-80' : ''}`}
          >
            <div
              className="inline-block font-medium leading-none tracking-wider text-[120px] md:text-[160px] text-foreground"
              style={{
                fontFamily: "'KaiTi', 'STKaiti', '楷体', 'Kaiti SC', 'DFKai-SB', serif",
                textShadow: '0 4px 16px rgba(0,0,0,0.08)',
              }}
            >
              {currentQ.content}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
            <button
              onClick={() => handleAnswer(true)}
              className="group relative py-6 px-4 rounded-2xl bg-gradient-to-br from-green-400 to-emerald-500 text-white font-bold text-xl shadow-lg shadow-green-500/30 hover:scale-105 hover:shadow-xl hover:shadow-green-500/40 active:scale-95 transition-all duration-200"
            >
              <div className="text-3xl mb-1">✓</div>
              <div>认识</div>
            </button>
            <button
              onClick={() => handleAnswer(false)}
              className="group relative py-6 px-4 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600 font-bold text-xl shadow-md hover:scale-105 hover:shadow-lg active:scale-95 transition-all duration-200 border border-slate-200"
            >
              <div className="text-3xl mb-1">?</div>
              <div>还不认识</div>
            </button>
          </div>

          {/* 键盘提示 */}
          <p className="text-center text-xs text-muted-foreground mt-6">
            小提示：也可以用键盘 ← 认识 / → 还不认识
          </p>
        </div>
      </div>
    </div>
  );
}

// ==================== 说明页 ====================
function IntroPage({ onStart }: { onStart: () => void }) {
  const features = [
    { icon: '⏱️', title: '约3分钟', desc: '快速了解中文基础' },
    { icon: '🎯', title: '智能适应', desc: '根据表现调整难度' },
    { icon: '📖', title: '阅读建议', desc: '找到适合的故事难度' },
    { icon: '🎮', title: '轻松体验', desc: '边玩边测没有压力' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-amber-50 to-white flex flex-col items-center justify-center px-4 py-8">
      <div className="max-w-md w-full">
        {/* 标题区 */}
        <div className="text-center mb-8">
          <div className="inline-block mb-4">
            <div className="text-6xl mb-2">🐵</div>
          </div>
          <h1
            className="text-3xl md:text-4xl font-bold text-foreground mb-3"
            style={{ fontFamily: "'ZCOOL KuaiLe', 'Noto Sans SC', cursive, sans-serif" }}
          >
            免费中文基础测试
          </h1>
          <p className="text-muted-foreground text-lg">
            快速了解孩子目前的中文阅读字词基础
          </p>
        </div>

        {/* 特色卡片 */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-white/80 backdrop-blur rounded-2xl p-4 border border-orange-100 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="text-3xl mb-2">{f.icon}</div>
              <div className="font-bold text-foreground">{f.title}</div>
              <div className="text-sm text-muted-foreground">{f.desc}</div>
            </div>
          ))}
        </div>

        {/* 测试说明 */}
        <div className="bg-white/60 rounded-2xl p-5 border border-orange-100 mb-6">
          <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
            <Sparkles size={18} className="text-yellow-500" />
            测试说明
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-orange-500">●</span>
              屏幕上会出现一个汉字或词语
            </li>
            <li className="flex gap-2">
              <span className="text-orange-500">●</span>
              认识就点"认识"，不认识就点"还不认识"
            </li>
            <li className="flex gap-2">
              <span className="text-orange-500">●</span>
              凭第一感觉回答，不需要想太久
            </li>
            <li className="flex gap-2">
              <span className="text-orange-500">●</span>
              无需注册登录，测试完全免费
            </li>
          </ul>
        </div>

        {/* 开始按钮 */}
        <button
          onClick={onStart}
          className="w-full py-5 px-6 rounded-2xl bg-gradient-to-r from-orange-400 to-amber-400 text-white font-bold text-xl shadow-xl shadow-orange-400/30 hover:scale-[1.02] hover:shadow-2xl hover:shadow-orange-400/40 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
        >
          开始测试
          <ChevronRight size={24} />
        </button>

        <p className="text-center text-xs text-muted-foreground mt-4">
          测试结果仅供参考，不等同于完整SRC正式测评
        </p>
      </div>
    </div>
  );
}

