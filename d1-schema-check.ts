import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function queryD1(sql) {
  const { stdout, stderr } = await execAsync(
    `npx wrangler d1 execute src-primary-database --remote --command "${sql.replace(/"/g, '\\"').replace(/\$/g, '\\$')}" 2>&1`,
    { encoding: 'utf8', timeout: 30000 }
  );
  const combined = stdout + stderr;
  // Find the first valid JSON object - it's at position 0 in the output
  // Actually wrangler outputs multiple JSON arrays, let's find the results
  const match = combined.match(/\[\s*\{/);
  if (!match) {
    // Try to find a JSON array
    const arrMatch = combined.match(/\["[^"]/);
    if (!arrMatch) return null;
  }
  
  // More robust: find "results" key
  const resultsMatch = combined.match(/"results"\s*:\s*(\[[\s\S]*?\])\s*[,\}]/);
  if (resultsMatch) {
    try {
      return JSON.parse(resultsMatch[1]);
    } catch(e) {
      // fall through
    }
  }
  
  // Try to parse the first JSON array
  const firstBracket = combined.indexOf('[');
  if (firstBracket >= 0) {
    // Try parsing incrementally
    for (let i = combined.length; i > firstBracket; i--) {
      try {
        const candidate = combined.slice(firstBracket, i);
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        if (Array.isArray(parsed) && parsed.length === 0) return parsed;
      } catch(e) { continue; }
    }
  }
  
  return null;
}

async function getTableInfo(tableName) {
  const columns = await queryD1(`PRAGMA table_info(${tableName})`) || [];
  const fks = await queryD1(`PRAGMA foreign_key_list(${tableName})`) || [];
  const countRes = await queryD1(`SELECT COUNT(*) as cnt FROM ${tableName}`) || [];
  return { columns, fks, count: countRes[0]?.cnt ?? 'unknown' };
}

async function main() {
  console.log('=== Production D1: src-primary-database ===\n');

  const tables = [
    'book_episodes',
    'book_episode_pages', 
    'book_rewrite_versions',
    'custom_books',
    'children',
    'parents',
    'reading_records',
    'book_entitlements',
    'subscriptions',
    'guest_test_sessions',
    'quick_assessment_results',
    'otp_codes',
  ];

  const foundTables = [];
  for (const table of tables) {
    const info = await getTableInfo(table);
    if (info.columns.length === 0) {
      console.log(`  ❌ ${table}: NOT FOUND`);
      continue;
    }
    foundTables.push({ name: table, ...info });
    console.log(`  ✅ ${table}: ${info.count} rows, ${info.columns.length} cols`);
  }

  console.log('\n=== Detailed Table Schema ===\n');
  for (const t of foundTables.filter(t => 
    ['book_episodes','book_episode_pages','book_rewrite_versions','custom_books','children','book_entitlements','reading_records'].includes(t.name)
  )) {
    console.log(`\n## ${t.name} (${t.count} rows)`);
    console.log('  Columns:');
    for (const col of t.columns) {
      console.log(`    ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''} ${col.pk ? 'PK' : ''}`);
    }
    if (t.fks.length > 0) {
      console.log('  Foreign Keys:');
      for (const fk of t.fks) {
        console.log(`    ${fk.from} → ${fk.table}.${fk.to}`);
      }
    }
  }

  // Check rewrite 24
  console.log('\n=== Rewrite #24 in D1 ===');
  try {
    const r = await queryD1(`SELECT id, episode_id, child_id, target_level, status, finalized_at, finalized_by, LENGTH(pages_json) as pages_len FROM book_rewrite_versions WHERE id = 24`);
    if (!r || r.length === 0) {
      console.log('  ❌ NOT FOUND in Production D1');
    } else {
      console.log('  ✅ EXISTS');
      console.log(`    id: ${r[0].id}`);
      console.log(`    episode_id: ${r[0].episode_id}`);
      console.log(`    child_id: ${r[0].child_id || 'NULL'}`);
      console.log(`    target_level: ${r[0].target_level}`);
      console.log(`    status: ${r[0].status}`);
      console.log(`    pages_json length: ${r[0].pages_len} bytes`);
      console.log(`    finalized_at: ${r[0].finalized_at || 'NULL'}`);
      console.log(`    finalized_by: ${r[0].finalized_by || 'NULL'}`);
    }
  } catch (e) {
    console.log(`  Error: ${e.message.slice(0, 100)}`);
  }

  // Ted custom books
  console.log('\n=== Ted Child Book Relations ===');
  const tedId = '49ef4c55-558a-4e9a-b63b-ed888c9f8058';
  
  for (const table of ['custom_books', 'book_entitlements', 'reading_records']) {
    const rows = await queryD1(`SELECT * FROM ${table} WHERE child_id = '${tedId}' LIMIT 5`);
    if (rows === null) {
      console.log(`  ${table}: TABLE NOT FOUND`);
    } else {
      console.log(`  ${table}: ${rows.length} rows for Ted`);
      if (rows.length > 0) {
        for (const r of rows) {
          const short = Object.entries(r).map(([k,v]) => `${k}=${String(v).slice(0,30)}`).join(', ');
          console.log(`    ${short}`);
        }
      }
    }
  }
}

main().catch(console.error);
