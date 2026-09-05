/**
 * Phase 5B: 找出所有 confirmed_level = SRC300 的孩子
 */
import { query } from '../src/storage/database/pg-client';

async function main() {
  // 获取所有有正式测试的孩子
  const rows = await query<any>(
    `SELECT DISTINCT ON (tr.child_id)
            c.id, c.nickname, c.age, c.grade, c.country,
            tr.level as test_level,
            tr.stable_char_count,
            tr.stable_vocab_count,
            tr.character_mastery_rate,
            tr.vocab_mastery_rate,
            jsonb_array_length(tr.known_characters) as kc_len,
            tr.created_at
     FROM test_results tr
     JOIN children c ON tr.child_id = c.id
     WHERE tr.test_mode IN ('full', 'formal')
     ORDER BY tr.child_id, tr.created_at DESC`
  );

  const levels = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];
  const src300Kids = [];

  console.log('=== 所有有正式测试的孩子 ===');
  for (const r of rows) {
    const stableCount = r.stable_char_count || 0;
    const countLevel = stableCount >= 800 ? 'SRC800' : stableCount >= 500 ? 'SRC500' : stableCount >= 300 ? 'SRC300' : 'SRC100';
    const testLevel = r.test_level;
    const ci = levels.indexOf(countLevel);
    const ti = levels.indexOf(testLevel);
    const confirmed = levels[Math.max(ci, ti)];

    const line = `  ${r.nickname || '(无名)'}  confirmed=${confirmed}  stable=${stableCount}  test_level=${testLevel}  kc=${r.kc_len}  age=${r.age}  grade=${r.grade}`;

    if (confirmed === 'SRC300') {
      src300Kids.push({ ...r, confirmed_level: confirmed, count_level: countLevel });
      console.log(line);
    }
  }

  console.log(`\n共 ${src300Kids.length} 个 SRC300 confirmed 孩子`);

  // 打印详细信息
  console.log('\n=== SRC300 孩子详情 ===');
  for (const k of src300Kids) {
    console.log(`\n  ${k.nickname} (${k.id})`);
    console.log(`    age=${k.age}, grade=${k.grade}, country=${k.country}`);
    console.log(`    test_level=${k.test_level}, stable_char=${k.stable_char_count}, stable_vocab=${k.stable_vocab_count}`);
    console.log(`    char_mastery=${k.character_mastery_rate}%, vocab_mastery=${k.vocab_mastery_rate}%`);
    console.log(`    known_chars_count=${k.kc_len}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
