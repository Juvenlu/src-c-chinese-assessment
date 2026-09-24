import { query } from './src/storage/database/pg-client';
import { exec } from 'child_process';

const LEGACY_REWRITE_ID = 24;
const CHINESE_REGEX = /[\u4e00-\u9fff]/g;

// Legacy 到pg-client 的 query函数定义
async function getLegacyRewrite() {
  const { rows } = await query<any>(
    `SELECT * FROM book_rewrite_versions WHERE id = $1`,
    [LEGACY_REWRITE_ID]
  );
  if (rows.length === 0) return null;
  return rows[0];
}

function calcCharStats(pages: any[]) {
  let total_chars = 0;
  let max_page_chars = 0;
  const charSet = new Set<string>();
  const pageStats: { page: number; chars: number; frontier: string[]; text: string; image_url: string; original_text: string }[] = [];

  for (const p of pages) {
    const text = p.text || p.adapted_text || '';
    const chars = text.match(CHINESE_REGEX) || [];
    const count = chars.length;
    total_chars += count;
    max_page_chars = Math.max(max_page_chars, count);
    for (const c of chars) charSet.add(c);
    pageStats.push({
      page: p.page,
      chars: count,
      frontier: p.frontier || [],
      text: text.slice(0, 50),
      image_url: p.image_url ? 'YES' : 'NO',
      original_text: p.original_text ? 'YES' : 'NO'
    });
  }

  return { total_chars, unique_chars: charSet.size, max_page_chars, pageStats };
}

async function main() {
  console.log('=== LEGACY REWRITE #24 ===\n');

  const r = await getLegacyRewrite();
  if (!r) { console.log('NOT FOUND'); process.exit(1); }

  // 1. 基础字段
  console.log('1. BASIC FIELDS');
  for (const f of ['id','episode_id','child_id','target_level','status','version','retry_count','failure_reason','finalized_by']) {
    console.log(`  ${f}: ${r[f] === null ? 'NULL' : r[f]}`);
  }

  // 2. 时间戳
  console.log('\n2. TIMESTAMPS');
  console.log(`  created_at: ${r.created_at}`);
  console.log(`  created_at_unix: ${Math.floor(new Date(r.created_at).getTime() / 1000)}`);
  console.log(`  finalized_at: ${r.finalized_at}`);
  console.log(`  finalized_at_unix: ${r.finalized_at ? Math.floor(new Date(r.finalized_at).getTime() / 1000) : 'NULL'}`);
  if (r.updated_at) {
    console.log(`  updated_at: ${r.updated_at}`);
    console.log(`  updated_at_unix: ${Math.floor(new Date(r.updated_at).getTime() / 1000)}`);
  } else {
    console.log(`  updated_at: NULL');
  }

  // 3. JSON 字段类型
  console.log('\n3. JSON FIELD TYPES');
  for (const f of ['pages_json','frontier_targets','generation_params','validation_result']) {
    const val = r[f];
    if (val === null || val === undefined) { console.log(`  ${f}: NULL`); continue; }
    if (Array.isArray(val)) console.log(`  ${f}: Array(${val.length})`);
    else if (typeof val === 'object') console.log(`  ${f}: Object (keys: ${Object.keys(val).length})`);
    else console.log(`  ${f}: ${typeof val}`);
  }

  // 4. Pages JSON
  console.log('\n4. PAGES JSON');
  const pages = r.pages_json;
  console.log(`  page_count: ${pages.length}`);
  console.log(`  page_numbering: ${pages.map((p: any) => p.page).join(',')}`);
  const allKeys = new Set<string>();
  for (const p of pages) for (const k of Object.keys(p)) allKeys.add(k);
  console.log(`  page fields: ${[...allKeys].join(', ')}`);

  let imgC = 0, txtC = 0, frC = 0, origC = 0, adapC = 0;
  for (const p of pages) {
    if (p.image_url) imgC++;
    if (p.text) txtC++;
    if (p.frontier && p.frontier.length > 0) frC++;
    if (p.original_text) origC++;
    if (p.adapted_text) adapC++;
  }
  console.log(`  image_url: ${imgC}/${pages.length}`);
  console.log(`  text: ${txtC}/${pages.length}`);
  console.log(`  adapted_text: ${adapC}/${pages.length}`);
  console.log(`  frontier: ${frC}/${pages.length}`);
  console.log(`  original_text: ${origC}/${pages.length}`);

  // 5. 字符统计（只算中文字符
  console.log('\n5. CHARACTER STATISTICS (Chinese only)');
  const stats = calcCharStats(pages);
  console.log(`  total_chars: ${stats.total_chars}`);
  console.log(`  unique_chars: ${stats.unique_chars}`);
  console.log(`  max_page_chars: ${stats.max_page_chars}`);
  console.log('  Per page:');
  for (const ps of stats.pageStats) {
    console.log(`    P${ps.page}: ${ps.chars} chars, frontier=[${ps.frontier.join(',')}]`);
  }

  // 6. Frontier targets
  console.log('\n6. FRONTIER TARGETS');
  console.log(`  value: ${JSON.stringify(r.frontier_targets)}`);

  // 7. Generation params
  console.log('\n7. GENERATION PARAMS');
  const gp = r.generation_params;
  if (gp && typeof gp === 'object') {
    for (const [k, v] of Object.entries(gp)) {
      const s = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80);
      console.log(`  ${k}: ${s}`);
    }
  } else console.log(`  value: ${JSON.stringify(gp)}`);

  // 8. Validation result
  console.log('\n8. VALIDATION RESULT');
  const vr = r.validation_result;
  if (vr && typeof vr === 'object') {
    console.log(`  overall_pass: ${vr.overall_pass}`);
    console.log(`  passed: ${vr.passed_count}/${vr.total_checks || '?'}`);
    if (vr.checks) {
      for (const c of vr.checks) {
      const d = c.details ? ' - ' + JSON.stringify(c.details).slice(0, 70) : '';
      console.log(`    ${c.check_type || c.name}: ${c.passed ? 'PASS' : 'FAIL'}${d}`);
    }
  } else console.log(`  value: ${JSON.stringify(vr).slice(0, 200)}`);

  console.log('\n=== DONE ===');
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
