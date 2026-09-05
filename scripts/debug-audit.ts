// Debug script - check runAudit output structure
import { runAudit } from '../src/lib/book-rewrite/audit/audit-engine.ts';
import { query } from '../src/storage/database/pg-client.ts';

async function main() {
  const rows = await query(
    'SELECT id, pages_json, target_level, frontier_targets FROM book_rewrite_versions WHERE id = 21',
  );
  const row = (rows as any[])[0];
  console.log('row keys:', Object.keys(row));
  
  const result = runAudit({
    pages: row.pages_json,
    target_level: row.target_level,
    frontier_targets: row.frontier_targets || [],
    rewrite_id: 21,
  });
  
  console.log('\nresult keys:', Object.keys(result));
  console.log('character:', JSON.stringify(result.character).slice(0, 300));
  console.log('level_classification keys:', Object.keys(result.level_classification || {}));
  console.log('frontier keys:', Object.keys(result.frontier || {}));
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
