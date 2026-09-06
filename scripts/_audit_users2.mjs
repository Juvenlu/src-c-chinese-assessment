import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.PGDATABASE_URL, max: 1 });

(async () => {
  const names = ['tina', '米粒', 'millet', '小行者', '希希', 'siqi', '思琪', 'amily', '艾米丽', 'hellen', '海伦', 'nina', '妮娜', 'emma', 'mia', '米娅', 'alex', 'jason'];
  
  console.log('=== 逐个搜索 ===\n');
  
  for (const name of names) {
    // children
    const ch = await pool.query(`SELECT id, nickname FROM children WHERE nickname ILIKE $1 LIMIT 3`, ['%' + name + '%']);
    // auth.users
    const au = await pool.query(`SELECT id, email FROM auth.users WHERE email ILIKE $1 LIMIT 3`, ['%' + name + '%']);
    // parents
    const pa = await pool.query(`SELECT id, email FROM parents_profiles WHERE email ILIKE $1 LIMIT 3`, ['%' + name + '%']);
    
    if (ch.rows.length > 0 || au.rows.length > 0 || pa.rows.length > 0) {
      console.log(`[${name}]`);
      ch.rows.forEach(r => console.log(`  child: ${r.nickname}`));
      au.rows.forEach(r => console.log(`  auth: ${r.email}`));
      pa.rows.forEach(r => console.log(`  parent: ${r.email}`));
      console.log('');
    }
  }
  
  pool.end();
})();
