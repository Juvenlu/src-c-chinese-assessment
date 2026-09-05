import { getPgPool } from '../src/storage/database/pg-client';

async function main() {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    const emmaId = '93bf1578-7751-4234-83c3-e70932c6dd21';
    const helId = '5ac5cdc8-17d4-4758-8241-c3fa6408ab0c';

    for (const [name, id] of [['Emma', emmaId], ['Hellenna', helId]] as const) {
      console.log(`\n========== ${name} ==========`);

      // children 表
      const c = await client.query(`SELECT * FROM children WHERE id = $1`, [id]);
      if (c.rows.length === 0) { console.log('NOT FOUND'); continue; }
      console.log(`nickname: ${c.rows[0].nickname}`);
      console.log(`age: ${c.rows[0].age}  grade: ${c.rows[0].grade}`);
      console.log(`status: ${c.rows[0].status}`);
      console.log(`home_language: ${c.rows[0].home_language}`);

      // quick_assessment_results
      const qa = await client.query(`
        SELECT * FROM quick_assessment_results
        WHERE child_id = $1
        ORDER BY created_at DESC
      `, [id]);
      console.log(`\nQuick Assessment Results (${qa.rows.length}):`);
      qa.rows.forEach(r => {
        console.log(`  ${r.created_at.toISOString().slice(0,16)}  id=${r.id}`);
        console.log(`    target_level=${r.target_level}`);
        console.log(`    char_L=${r.character_level_l}  char_U=${r.character_level_u}`);
        console.log(`    word_L=${r.word_level_l}  word_U=${r.word_level_u}`);
        console.log(`    reading_base=${r.reading_base_level}  confidence=${r.confidence}`);
        console.log(`    stable_char_count=${r.stable_char_count}  stable_vocab_count=${r.stable_vocab_count}`);
      });

      // 有没有 formal test_results / test_sessions 表
      const tables = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('test_results', 'test_sessions', 'test_answers')
      `);
      console.log(`\nFormal test tables: ${tables.rows.map(r=>r.table_name).join(', ') || 'none'}`);

      if (tables.rows.some(r => r.table_name === 'test_results')) {
        const tr = await client.query(`
          SELECT * FROM test_results WHERE child_id = $1 ORDER BY created_at DESC LIMIT 5
        `, [id]);
        console.log(`Test Results (${tr.rows.length}):`);
        tr.rows.forEach(r => console.log(`  ${JSON.stringify(r)}`));
      }

      // parents_profiles
      const pp = await client.query(`
        SELECT id, email, subscription_status, plan_type FROM parents_profiles
        WHERE id = $1
      `, [c.rows[0].parent_id]);
      if (pp.rows.length > 0) {
        console.log(`\nParent: email=${pp.rows[0].email}  plan=${pp.rows[0].plan_type}  sub=${pp.rows[0].subscription_status}`);
      }
    }

    // 确认: Hellenna 的 confirmed_level 在哪里？
    // children 表没有 confirmed_level 字段 → 可能在 quick_assessment_results 里是最后一次
    // 也可能在 test_results
    console.log('\n========== Confirmed Level Source Analysis ==========');

    // 看 level-service 确认 source of truth
    const src = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE '%child%'
    `);
    console.log(`child-related tables: ${src.rows.map(r=>r.table_name).join(', ')}`);

    // quick_assessment_results 是否有 is_confirmed 字段
    const qaCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'quick_assessment_results' ORDER BY ordinal_position
    `);
    console.log(`qa columns: ${qaCols.rows.map(r=>r.column_name).join(', ')}`);

    // book_rewrite_versions 中 Hellenna 相关
    const rew = await client.query(`
      SELECT id, episode_id, target_level, status, child_id, version, created_at
      FROM book_rewrite_versions
      WHERE child_id = $1
      ORDER BY created_at DESC
    `, [helId]);
    console.log(`\nHellenna rewrites (${rew.rows.length}):`);
    rew.rows.forEach(r => console.log(`  id=${r.id}  ep=${r.episode_id}  level=${r.target_level}  status=${r.status}  v=${r.version}`));
  } finally {
    client.release();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
