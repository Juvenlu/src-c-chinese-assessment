/**
 * Phase 5B: 查看所有有正式测试的真实孩子（排除明显测试账号）
 */
import { query } from '../src/storage/database/pg-client';

async function main() {
  // 列出所有有正式测试、名字像真实孩子的（排除"测试"、"Test"、"2026"、"抽测"等）
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
       AND c.nickname NOT ILIKE '%测试%'
       AND c.nickname NOT ILIKE '%Test%'
       AND c.nickname NOT ILIKE '%test%'
       AND c.nickname NOT ILIKE '%2026%'
       AND c.nickname NOT ILIKE '%2027%'
       AND c.nickname NOT ILIKE '%抽测%'
       AND c.nickname NOT ILIKE '%逐字%'
       AND c.nickname NOT ILIKE '张%'
       AND c.nickname NOT ILIKE '李%'
       AND c.nickname NOT ILIKE '王%'
       AND c.nickname NOT ILIKE '赵%'
       AND c.nickname NOT ILIKE '朱%'
       AND c.nickname NOT ILIKE '杨%'
       AND c.nickname NOT ILIKE '%Kid%'
       AND c.nickname NOT ILIKE '%kid%'
       AND c.nickname NOT ILIKE '%Debug%'
       AND c.nickname NOT ILIKE '%Bind%'
       AND c.nickname NOT ILIKE '%Sess%'
       AND c.nickname NOT ILIKE '%Rate%'
       AND c.nickname NOT ILIKE '%Growth%'
       AND c.nickname NOT ILIKE '%Empty%'
       AND c.nickname NOT ILIKE '%Dep%'
       AND c.nickname NOT ILIKE '%GoLive%'
       AND c.nickname NOT ILIKE '%Sec%'
       AND c.nickname NOT ILIKE '%Hub%'
       AND c.nickname NOT ILIKE '%Self%'
       AND c.nickname NOT ILIKE '%Happy%'
     ORDER BY tr.child_id, tr.created_at DESC`
  );

  const levels = ['SRC100', 'SRC300', 'SRC500', 'SRC800'];

  console.log('=== 真实孩子（去测试账号）===');
  console.log(`共 ${rows.length} 个\n`);

  for (const r of rows) {
    const stableCount = r.stable_char_count || 0;
    const countLevel = stableCount >= 800 ? 'SRC800' : stableCount >= 500 ? 'SRC500' : stableCount >= 300 ? 'SRC300' : 'SRC100';
    const testLevel = r.test_level;
    const ci = levels.indexOf(countLevel);
    const ti = levels.indexOf(testLevel);
    const confirmed = levels[Math.max(ci, ti)];

    console.log(`  ${r.nickname}  confirmed=${confirmed}  stable=${stableCount}  test=${testLevel}  kc=${r.kc_len ?? 'null'}  age=${r.age}  grade=${r.grade}  country=${r.country}`);
  }

  // 筛选 SRC300 的真实孩子
  const src300Real = rows.filter((r: any) => {
    const stableCount = r.stable_char_count || 0;
    const countLevel = stableCount >= 800 ? 'SRC800' : stableCount >= 500 ? 'SRC500' : stableCount >= 300 ? 'SRC300' : 'SRC100';
    const testLevel = r.test_level;
    const ci = levels.indexOf(countLevel);
    const ti = levels.indexOf(testLevel);
    return levels[Math.max(ci, ti)] === 'SRC300';
  });

  console.log(`\n=== SRC300 真实孩子：${src300Real.length} 个 ===`);
  for (const k of src300Real) {
    console.log(`  ${k.nickname} (${k.id}): kc=${k.kc_len}, stable=${k.stable_char_count}, age=${k.age}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
