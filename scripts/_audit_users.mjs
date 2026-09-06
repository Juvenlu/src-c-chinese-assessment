import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.PGDATABASE_URL, max: 1 });

(async () => {
  // 统计
  const c1 = await pool.query('SELECT count(*) FROM parents_profiles');
  const c2 = await pool.query('SELECT count(*) FROM children');
  console.log('沙箱数据库总数:');
  console.log('  家长:', c1.rows[0].count);
  console.log('  孩子:', c2.rows[0].count);

  // 中文昵称
  const cn = await pool.query(
    "SELECT count(*) as cnt FROM children WHERE nickname ~ '[\u4e00-\u9fa5]'"
  );
  console.log('  中文昵称孩子:', cn.rows[0].cnt);

  const cnList = await pool.query(
    "SELECT nickname FROM children WHERE nickname ~ '[\u4e00-\u9fa5]' ORDER BY created_at DESC LIMIT 30"
  );
  console.log('  中文昵称列表:', cnList.rows.map(x => x.nickname).join(', '));

  // 搜索具体名字
  const names = ['tina', '米粒', 'millet', '小行者', '希希', 'siqi', '思琪', 'amily', '艾米丽', 'hellen', '海伦', 'nina', '妮娜', 'emma', 'mia', '米娅', 'alex', 'jason', 'tina@', '米粒@'];
  console.log('\n=== 搜索具体用户 ===');
  for (const name of names) {
    const r = await pool.query(
      `SELECT id, nickname, 'child' as type FROM children WHERE nickname ILIKE $1 
       UNION ALL 
       SELECT id::text, email as nickname, 'auth' as type FROM auth.users WHERE email ILIKE $1 
       UNION ALL 
       SELECT id, COALESCE(nickname, email) as nickname, 'parent' as type FROM parents_profiles 
       WHERE email ILIKE $1 OR nickname ILIKE $1 
       LIMIT 5`,
      ['%' + name + '%']
    );
    if (r.rows.length > 0) {
      console.log(`\n  [${name}]: ${r.rows.length} 个匹配`);
      r.rows.forEach(row => 
        console.log(`    ${row.type}: ${row.nickname} (${row.id.slice(0, 10)}...)`)
      );
    }
  }

  pool.end();
})();
