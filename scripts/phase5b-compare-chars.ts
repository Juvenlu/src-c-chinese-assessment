/**
 * Phase 5B: 详细比较 Emma 和 TestKidA（逐字测试01，290字）的 known_characters 差异
 *
 * Emma: 94 chars, stable=314
 * 逐字测试01: 290 chars, stable=154
 * 两个都是 confirmed SRC300
 */
import { query } from '../src/storage/database/pg-client';

const EMMA_ID = '93bf1578-7751-4234-83c3-e70932c6dd21';
// 逐字测试01 - 290 known chars
const TEST_A_ID = 'f0619e5d-5a1a-4111-aaa6-4de7c2c5f1eb';
// 20260822-300 - 93 known chars
const TEST_B_ID = 'b511c463-2aae-4e42-ae7e-be1a9b09fd2f';
// 20260730逐字-300-02 - 308 known chars
const TEST_C_ID = 'ba788baa-9243-4314-88cb-810ae74c71a8';

async function getKnownChars(childId: string): Promise<Set<string>> {
  const rows = await query<any>(
    `SELECT known_characters FROM test_results
     WHERE child_id = $1 AND test_mode IN ('full', 'formal')
     ORDER BY created_at DESC LIMIT 1`,
    [childId]
  );
  if (rows.length === 0 || !rows[0].known_characters) return new Set();
  return new Set(rows[0].known_characters);
}

async function main() {
  const emmaChars = await getKnownChars(EMMA_ID);
  const testAChars = await getKnownChars(TEST_A_ID);
  const testBChars = await getKnownChars(TEST_B_ID);
  const testCChars = await getKnownChars(TEST_C_ID);

  console.log('=== Known Characters 对比 ===\n');
  console.log(`Emma:        ${emmaChars.size} 字`);
  console.log(`逐字测试01:   ${testAChars.size} 字`);
  console.log(`20260822-300: ${testBChars.size} 字`);
  console.log(`20260730逐字: ${testCChars.size} 字`);

  // Emma vs TestA (字数差异较大)
  const emmaOnly = new Set([...emmaChars].filter(c => !testAChars.has(c)));
  const testAOnly = new Set([...testAChars].filter(c => !emmaChars.has(c)));
  const common = new Set([...emmaChars].filter(c => testAChars.has(c)));

  console.log('\n--- Emma vs 逐字测试01 ---');
  console.log(`共同掌握: ${common.size} 字`);
  console.log(`Emma特有: ${emmaOnly.size} 字 → ${[...emmaOnly].join('')}`);
  console.log(`逐字01特有: ${testAOnly.size} 字 → ${[...testAOnly].join('')}`);

  // Emma vs TestB (字数相近)
  const emmaB = new Set([...emmaChars].filter(c => testBChars.has(c)));
  const emmaOnlyB = new Set([...emmaChars].filter(c => !testBChars.has(c)));
  const testBOnly = new Set([...testBChars].filter(c => !emmaChars.has(c)));

  console.log('\n--- Emma vs 20260822-300 (字数相近) ---');
  console.log(`共同掌握: ${emmaB.size} 字`);
  console.log(`Emma特有: ${emmaOnlyB.size} 字 → ${[...emmaOnlyB].join('')}`);
  console.log(`220822特有: ${testBOnly.size} 字 → ${[...testBOnly].join('')}`);

  // Emma vs TestC (字数差异更大)
  const emmaC = new Set([...emmaChars].filter(c => testCChars.has(c)));
  const emmaOnlyC = new Set([...emmaChars].filter(c => !testCChars.has(c)));
  const testCOnly = new Set([...testCChars].filter(c => !emmaChars.has(c)));

  console.log('\n--- Emma vs 20260730逐字 (字数差异大) ---');
  console.log(`共同掌握: ${emmaC.size} 字`);
  console.log(`Emma特有: ${emmaOnlyC.size} 字 → ${[...emmaOnlyC].join('')}`);
  console.log(`0730逐字特有: ${testCOnly.size} 字 → ${[...testCOnly].join('')}`);

  // 检查每个孩子的 weak character signals（错答）
  console.log('\n=== Weak Character Signals (错答字) ===');
  for (const [name, id] of [['Emma', EMMA_ID], ['逐字测试01', TEST_A_ID], ['20260822', TEST_B_ID], ['20260730逐字', TEST_C_ID]]) {
    const wrong = await query<any>(
      `SELECT DISTINCT qb.character
       FROM test_answers ta
       JOIN test_sessions ts ON ta.session_id = ts.id
       LEFT JOIN question_bank qb ON ta.question_id = qb.id
       WHERE ts.child_id = $1 AND ta.is_correct = false
         AND ts.test_mode IN ('full', 'formal')
         AND qb.character IS NOT NULL`,
      [id]
    );
    const chars = wrong.map((w: any) => w.character).filter(Boolean);
    console.log(`  ${name}: ${chars.length} 个弱字信号 → ${chars.join(' ')}`);
  }

  console.log('\n=== 各孩子 stable_char_count & mastery_rate ===');
  for (const [name, id] of [['Emma', EMMA_ID], ['逐字测试01', TEST_A_ID], ['20260822', TEST_B_ID], ['20260730逐字', TEST_C_ID]]) {
    const rows = await query<any>(
      `SELECT stable_char_count, stable_vocab_count, character_mastery_rate, vocab_mastery_rate, level
       FROM test_results
       WHERE child_id = $1 AND test_mode IN ('full', 'formal')
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    if (rows.length > 0) {
      const r = rows[0];
      console.log(`  ${name}: level=${r.level}, stable_char=${r.stable_char_count}, stable_vocab=${r.stable_vocab_count}, char_rate=${r.character_mastery_rate}%, vocab_rate=${r.vocab_mastery_rate}%`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
