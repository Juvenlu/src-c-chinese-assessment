/**
 * 直接测试 V2.0 验收测试
 * 5组用例，验证：低水平/SRC300水平/SRC500水平/单字高于词语/全SRC800
 */
import {
  calculateQuickResult,
  ASSESSMENT_CONFIG,
  type AnswerRecord,
} from '../src/lib/quick-assessment';
import type { Level } from '../src/lib/types';

const ALL_LEVELS: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];

/**
 * 生成一组答题记录（模拟"在targetLevel及以下都对，以上都错"）
 * charTargetLevel: 单字能力目标等级
 * wordTargetLevel: 词语能力目标等级
 * 每级：6单字 + 3词语 = 9计分题
 */
function generateMockAnswers(
  charTargetLevel: Level,
  wordTargetLevel: Level,
  opts: { includeBooster?: boolean; borderlineAt?: Level | null } = {},
): AnswerRecord[] {
  const answers: AnswerRecord[] = [];
  let seq = 0;
  const { includeBooster = true } = opts;

  for (const lv of ALL_LEVELS) {
    // 如果目标等级比当前级低很多，就没必要继续了（实际自适应会停止）
    // 这里为了测试完整数据，生成所有级别的模拟答案
    const charIdx = ALL_LEVELS.indexOf(charTargetLevel);
    const wordIdx = ALL_LEVELS.indexOf(wordTargetLevel);
    const lvIdx = ALL_LEVELS.indexOf(lv);

    // Confidence Booster（不计分）
    if (includeBooster && lvIdx > 0) {
      answers.push({
        questionId: `booster-${lv}-${seq}`,
        questionContent: '的',
        questionType: 'character',
        minimumSrcLevel: ALL_LEVELS[lvIdx - 1],
        questionRole: 'confidence_booster',
        userAnswer: true,
        correct: true,
        responseTimeMs: 800 + Math.random() * 500,
        sequenceNumber: seq++,
        scoring: false,
      });
    }

    // 单字题 6道 - 当前级<=目标级时全对，否则全错
    const charPassed = lvIdx <= charIdx;
    const charAccuracy = charPassed
      ? (lvIdx === charIdx ? 0.83 : 1.0)  // 刚好在目标级时83%（5/6）
      : (lvIdx === charIdx + 1 ? 0.33 : 0.0); // 目标级下一级33%（2/6）
    const charCorrect = Math.round(6 * charAccuracy);
    for (let i = 0; i < 6; i++) {
      answers.push({
        questionId: `char-${lv}-${i}`,
        questionContent: `字${lv}-${i}`,
        questionType: 'character',
        minimumSrcLevel: lv,
        questionRole: 'scoring',
        userAnswer: i < charCorrect,
        correct: i < charCorrect,
        responseTimeMs: 800 + Math.random() * 1000,
        sequenceNumber: seq++,
        scoring: true,
      });
    }

    // 词语题 3道
    const wordPassed = lvIdx <= wordIdx;
    const wordAccuracy = wordPassed
      ? (lvIdx === wordIdx ? 0.67 : 1.0)  // 刚好在目标级时67%（2/3）
      : (lvIdx === wordIdx + 1 ? 0.33 : 0.0);
    const wordCorrect = Math.round(3 * wordAccuracy);
    for (let i = 0; i < 3; i++) {
      answers.push({
        questionId: `word-${lv}-${i}`,
        questionContent: `词${lv}-${i}`,
        questionType: 'word',
        minimumSrcLevel: lv,
        questionRole: 'scoring',
        userAnswer: i < wordCorrect,
        correct: i < wordCorrect,
        responseTimeMs: 1200 + Math.random() * 1000,
        sequenceNumber: seq++,
        scoring: true,
      });
    }
  }

  return answers;
}

function runCase(name: string, charTarget: Level, wordTarget: Level) {
  console.log(`\n========== Case: ${name} ==========`);
  console.log(`模拟：单字目标=${charTarget}, 词语目标=${wordTarget}`);

  const answers = generateMockAnswers(charTarget, wordTarget);
  const result = calculateQuickResult(answers, 180000);

  console.log(`单字能力: ${result.characterLevelLower}~${result.characterLevelUpper} (估计: ${result.characterLevel})`);
  console.log(`词语能力: ${result.wordLevelLower}~${result.wordLevelUpper} (估计: ${result.wordLevel})`);
  console.log(`阅读基础: ${result.readingBaseLevel} (${result.readingBaseDesc})`);
  console.log(`推荐阅读: ${result.recommendedReadingDesc}`);
  console.log(`置信度: ${result.confidence}`);
  console.log(`总题数: ${result.totalQuestions} (单字${result.totalCharQuestions}+词语${result.totalWordQuestions})`);
  console.log(`质量标记: ${result.qualityFlags.length > 0 ? result.qualityFlags.join(', ') : '无'}`);

  console.log(`\n各等级明细:`);
  for (const lr of result.levelResults) {
    console.log(`  ${lr.level}: 单字${lr.charCorrect}/${lr.charTested}(${Math.round(lr.charAccuracy*100)}%)  词语${lr.wordCorrect}/${lr.wordTested}(${Math.round(lr.wordAccuracy*100)}%)  → ${lr.status}`);
  }

  // 核心规则校验
  const charIdx = ALL_LEVELS.indexOf(result.characterLevel);
  const wordIdx = ALL_LEVELS.indexOf(result.wordLevel);
  const readIdx = ALL_LEVELS.indexOf(result.readingBaseLevel);

  console.log(`\n规则校验:`);
  const r1 = readIdx <= wordIdx;
  console.log(`  ReadingBase ≤ WordLevel: ${r1 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  三指标齐全: ${result.characterLevel && result.wordLevel && result.readingBaseLevel ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  有置信度: ${['high','medium','low'].includes(result.confidence) ? '✅ PASS' : '❌ FAIL'}`);

  return result;
}

console.log('=== 直接测试 V2.0 验收测试 ===');
console.log(`配置: 每级${ASSESSMENT_CONFIG.questionsPerLevelCharacter}单字+${ASSESSMENT_CONFIG.questionsPerLevelWord}词语 = 9计分题/级`);
console.log(`通过阈值: SRC100/300(${Math.round(ASSESSMENT_CONFIG.characterPassThreshold.SRC100*100)}%) SRC500/800(${Math.round(ASSESSMENT_CONFIG.characterPassThreshold.SRC500*100)}%)`);

// Case A: 低水平 - SRC100都不稳
runCase('A - 低水平 (SRC100不稳定)', 'SRC100', 'SRC100');

// Case B: SRC300水平
runCase('B - SRC300水平', 'SRC300', 'SRC300');

// Case C: SRC500水平
runCase('C - SRC500水平', 'SRC500', 'SRC500');

// Case D: 单字明显高于词语（char=SRC800, word=SRC500）
const resD = runCase('D - 单字高于词语 (C=800/W=500)', 'SRC800', 'SRC500');
console.log(`  重点：ReadingBase(${resD.readingBaseLevel}) 不得高于 WordLevel(${resD.wordLevel})`);
console.log(`  ${ALL_LEVELS.indexOf(resD.readingBaseLevel) <= ALL_LEVELS.indexOf(resD.wordLevel) ? '✅ PASS - 阅读基础受词语短板限制' : '❌ FAIL'}`);

// Case E: 全部SRC800
runCase('E - 全部SRC800水平', 'SRC800', 'SRC800');

console.log('\n=== 验收完成 ===');
