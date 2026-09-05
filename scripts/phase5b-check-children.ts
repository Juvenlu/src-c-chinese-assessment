/**
 * Phase 5B: 快速查询 Emma & Hellenna SRC300 相关数据
 */
import { query } from '../src/storage/database/pg-client';

const EMMA_ID = '93bf1578-7751-4234-83c3-e70932c6dd21';
const HELLENNA_ID = '5ac5cdc8-17d4-4758-8241-c3fa6408ab0c';

async function getChildInfo(childId: string) {
  const rows = await query<any>(
    `SELECT id, nickname, age, grade, country, home_language FROM children WHERE id = $1`,
    [childId]
  );
  return rows[0] || null;
}

async function getLatestFormalTest(childId: string) {
  const rows = await query<any>(
    `SELECT * FROM test_results
     WHERE child_id = $1 AND (test_mode = 'full' OR test_mode = 'formal')
     ORDER BY created_at DESC LIMIT 5`,
    [childId]
  );
  return rows;
}

async function getWrongAnswers(childId: string) {
  // 从 test_answers + question_bank 获取错误的字/词
  const rows = await query<any>(
    `SELECT DISTINCT qb.character, qb.word, qb.level, qb.id as qid
     FROM test_answers ta
     JOIN test_sessions ts ON ta.session_id = ts.id
     LEFT JOIN question_bank qb ON ta.question_id = qb.id
     WHERE ts.child_id = $1 AND ta.is_correct = false
       AND ts.test_mode IN ('full', 'formal')
     ORDER BY qb.level, qb.character`,
    [childId]
  );
  return rows;
}

async function main() {
  console.log('========== Emma & Hellenna 数据查询 ==========\n');

  for (const [name, childId] of [['Emma', EMMA_ID], ['Hellenna', HELLENNA_ID]]) {
    console.log(`--- ${name} (${childId}) ---`);

    const info = await getChildInfo(childId);
    if (info) {
      console.log(`  基本信息: age=${info.age}, grade=${info.grade}, country=${info.country}, home_lang=${info.home_language}`);
    }

    const tests = await getLatestFormalTest(childId);
    if (tests.length === 0) {
      console.log('  无正式测试结果');
      console.log('');
      continue;
    }

    const latest = tests[0];
    console.log(`  最新正式测试: level=${latest.level}, mode=${latest.test_mode}`);
    console.log(`  stable_char_count=${latest.stable_char_count}, stable_vocab_count=${latest.stable_vocab_count}`);
    console.log(`  character_mastery_rate=${latest.character_mastery_rate}%, vocab_mastery_rate=${latest.vocab_mastery_rate}%`);

    // known_characters
    const knownChars = latest.known_characters || [];
    console.log(`  known_characters: ${knownChars.length} 字`);
    if (knownChars.length > 0) {
      console.log(`  前30字: ${knownChars.slice(0, 30).join(' ')}`);
      console.log(`  全部: ${knownChars.join('')}`);
    }

    // confirmed_level
    const stableCount = latest.stable_char_count || 0;
    const countLevel = stableCount >= 800 ? 'SRC800' : stableCount >= 500 ? 'SRC500' : stableCount >= 300 ? 'SRC300' : 'SRC100';
    const testLevel = latest.level;
    const levels = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
    const ci = levels.indexOf(countLevel);
    const ti = levels.indexOf(testLevel);
    const confirmed = levels[Math.max(ci, ti)];
    console.log(`  confirmed_level = ${confirmed} (stable_count→${countLevel}, test_level→${testLevel})`);

    // 错误答案
    const wrong = await getWrongAnswers(childId);
    const wrongChars = new Set<string>();
    const wrongWords = new Set<string>();
    for (const w of wrong) {
      if (w.character) wrongChars.add(w.character);
      if (w.word) wrongWords.add(w.word);
    }
    console.log(`  Weak char signals: ${wrongChars.size} 个 → ${Array.from(wrongChars).join(' ')}`);
    console.log(`  Weak word signals: ${wrongWords.size} 个 → ${Array.from(wrongWords).slice(0, 20).join(', ')}`);

    console.log('');
  }

  console.log('--- 西游记第1集 episode_id ---');
  const eps = await query<any>(
    `SELECT id, series_name, episode_number, episode_title, page_count, status
     FROM book_episodes WHERE series_name ILIKE '%西游记%' ORDER BY id`
  );
  for (const e of eps) {
    console.log(`  id=${e.id}  ${e.series_name} - 第${e.episode_number}集: ${e.episode_title}  (${e.page_count}页, ${e.status})`);
  }

  console.log('\n--- 已有 rewrite 版本 ---');
  const rewrites = await query<any>(
    `SELECT brv.id, brv.episode_id, brv.target_level, brv.status, brv.child_id,
            brv.version, brv.created_at,
            c.nickname as child_name
     FROM book_rewrite_versions brv
     LEFT JOIN children c ON brv.child_id = c.id
     ORDER BY brv.id ASC`
  );
  for (const r of rewrites) {
    console.log(`  id=${r.id}  ep${r.episode_id}  ${r.target_level}  ${r.status}  child=${r.child_name || 'N/A'}  v${r.version}  ${r.created_at.toISOString()}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
