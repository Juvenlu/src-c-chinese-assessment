import { query } from './src/lib/book-rewrite/rewrite-store';

const LEGACY_REWRITE_ID = 24;

// 1. 读取 Legacy PG Rewrite #24 全部字段
async function getLegacyRewrite() {
  const rows = await query<any>(
    `SELECT * FROM book_rewrite_versions WHERE id = $1`,
    [LEGACY_REWRITE_ID]
  );
  if (rows.length === 0) return null;
  return rows[0];
}

// 2. 计算字符统计
function calcCharStats(pages: any[]) {
  const CHINESE_REGEX = /[\u4e00-\u9fff]/g;

  let total_chars = 0;
  let max_page_chars = 0;
  const charSet = new Set<string>();

  for (const p of pages) {
    const text = p.text || p.adapted_text || '';
    const chars = text.match(CHINESE_REGEX) || [];
    total_chars += chars.length;
    max_page_chars = Math.max(max_page_chars, chars.length);
    for (const c of chars) charSet.add(c);
  }

  return {
    total_chars,
    unique_chars: charSet.size,
    max_page_chars,
  };
}

async function main() {
  console.log('=== LEGACY REWRITE #24 ===\n');

  const r = await getLegacyRewrite();
  if (!r) {
    console.log('NOT FOUND');
    process.exit(1);
  }

  // 1. 基础字段
  console.log('## 1. Basic Fields');
  const fields = [
    'id', 'episode_id', 'child_id', 'target_level', 'status',
    'version', 'retry_count', 'failure_reason', 'finalized_by'
  ];
  for (const f of fields) {
    const val = r[f];
    console.log(`  ${f}: ${val === null ? 'NULL' : typeof val === 'string' && val.length > 80 ? val.slice(0, 80) + '...' : val}`);
  }

  // 2. 时间戳
  console.log('\n## 2. Timestamps');
  console.log(`  created_at (TIMESTAMPTZ): ${r.created_at}`);
  console.log(`  created_at unix (sec): ${Math.floor(new Date(r.created_at).getTime() / 1000)}`);
  console.log(`  finalized_at (TIMESTAMPTZ): ${r.finalized_at}`);
  console.log(`  finalized_at unix (sec): ${r.finalized_at ? Math.floor(new Date(r.finalized_at).getTime() / 1000) : 'NULL'}`);
  console.log(`  updated_at (TIMESTAMPTZ): ${r.updated_at || 'NULL'}`);
  console.log(`  updated_at unix (sec): ${r.updated_at ? Math.floor(new Date(r.updated_at).getTime() / 1000) : 'NULL'}`);

  // 3. JSON 字段类型和结构
  console.log('\n## 3. JSON Fields');
  const jsonFields = ['pages_json', 'frontier_targets', 'generation_params', 'validation_result'];
  for (const f of jsonFields) {
    const val = r[f];
    const type = typeof val;
    if (val === null) {
      console.log(`  ${f}: NULL`);
    } else if (Array.isArray(val)) {
      console.log(`  ${f}: Array(${val.length}) - type: ${type}`);
    } else if (type === 'object') {
      console.log(`  ${f}: Object with keys: ${Object.keys(val).length} - type: ${type}`);
    } else {
      console.log(`  ${f}: type=${type}, length=${String(val).length}`);
    }
  }

  // 4. Pages JSON 详细分析
  console.log('\n## 4. Pages JSON Detail');
  const pages = r.pages_json;
  console.log(`  page_count: ${pages.length}`);
  console.log(`  page_numbering: ${pages.map((p: any) => p.page).join(',')}`);

  // 每页字段
  const allKeys = new Set<string>();
  for (const p of pages) {
    for (const k of Object.keys(p)) allKeys.add(k);
  }
  console.log(`  all page fields: ${[...allKeys].join(', ')}`);

  // 覆盖检查
  let imageUrlCount = 0, textCount = 0, frontierCount = 0, originalTextCount = 0, adaptedTextCount = 0;
  for (const p of pages) {
    if (p.image_url) imageUrlCount++;
    if (p.text) textCount++;
    if (p.frontier) frontierCount++;
    if (p.original_text) originalTextCount++;
    if (p.adapted_text) adaptedTextCount++;
  }
  console.log(`  image_url coverage: ${imageUrlCount}/${pages.length}`);
  console.log(`  text coverage: ${textCount}/${pages.length}`);
  console.log(`  adapted_text coverage: ${adaptedTextCount}/${pages.length}`);
  console.log(`  frontier coverage: ${frontierCount}/${pages.length}`);
  console.log(`  original_text coverage: ${originalTextCount}/${pages.length}`);

  // 5. 字符统计
  console.log('\n## 5. Character Statistics');
  const stats = calcCharStats(pages);
  console.log(`  total_chars (Chinese only, exclude punctuation/space/number/english): ${stats.total_chars}`);
  console.log(`  unique_chars: ${stats.unique_chars}`);
  console.log(`  max_page_chars: ${stats.max_page_chars}`);

  // 每页字数
  console.log('\n  每页中文字数:');
  const CHINESE_REGEX = /[\u4e00-\u9fff]/g;
  for (const p of pages) {
    const text = p.text || p.adapted_text || '';
    const chars = text.match(CHINESE_REGEX) || [];
    const f = p.frontier || [];
    console.log(`    P${p.page}: ${chars.length} chars, frontier: ${JSON.stringify(f)}`);
  }

  // 6. Frontier Targets
  console.log('\n## 6. frontier_targets');
  console.log(`  value: ${JSON.stringify(r.frontier_targets)}`);

  // 7. Generation params summary
  console.log('\n## 7. generation_params');
  const gp = r.generation_params;
  if (gp && typeof gp === 'object') {
    for (const [k, v] of Object.entries(gp)) {
      const valStr = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80);
      console.log(`  ${k}: ${valStr}`);
    }
  } else {
    console.log(`  value: ${gp}`);
  }

  // 8. Validation result summary
  console.log('\n## 8. validation_result');
  const vr = r.validation_result;
  if (vr && typeof vr === 'object') {
    console.log(`  overall_pass: ${vr.overall_pass}`);
    console.log(`  passed_count: ${vr.passed_count}/${vr.total_checks || vr.checks?.length || '?'}`);
    if (vr.checks && Array.isArray(vr.checks)) {
      for (const c of vr.checks) {
        console.log(`    ${c.check_type || c.name}: ${c.passed ? 'PASS' : 'FAIL'}${c.details ? ' - ' + JSON.stringify(c.details).slice(0, 60) : ''}`);
      }
    }
  } else {
    console.log(`  value: ${vr}`);
  }

  console.log('\n=== PRECHECK DATA COMPLETE ===');
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
