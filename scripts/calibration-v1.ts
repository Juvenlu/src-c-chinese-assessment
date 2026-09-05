import { generateRewrite } from '../src/lib/book-rewrite/generator';
import { runAudit } from '../src/lib/book-rewrite/audit/audit-engine';
import type { RewritePage, ChildReadingProfile } from '../src/lib/book-rewrite/audit/types';

// 西游记第1集 Master Pages（与 route.ts 相同逻辑，手动构造最小集合用于测试）
async function getMasterPages(episodeId: number): Promise<RewritePage[]> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.PGDATABASE_URL, max: 1 });
  const res = await pool.query(
    'SELECT page_number, image_url, original_text FROM book_episode_pages WHERE episode_id = $1 ORDER BY page_number',
    [episodeId]
  );
  pool.end();
  return res.rows.map((r: any) => ({
    page: r.page_number,
    text: r.original_text,
    image_url: r.image_url || '',
    original_text: r.original_text,
  }));
}

const genericProfile: ChildReadingProfile = {
  child_nickname: '',
  generation_mode: 'experimental',
  stable_char_count: 250,
  stable_vocab_count: 300,
  character_mastery_rate: 85,
  vocab_mastery_rate: 80,
  known_characters: [],
  known_vocabulary: [],
  weak_char_signals: [],
  weak_word_signals: [],
};

async function run(label: string, masterPages: RewritePage[]) {
  console.log(`\n===== Calibration ${label} =====`);
  const result = await generateRewrite(
    masterPages,
    'SRC300',
    [],
    genericProfile,
  );
  console.log(`${label} pages:`, result.pages.length);
  const totalChars = result.pages.reduce((s, p) => s + (p.text?.match(/[\u4e00-\u9fff]/g)?.length || 0), 0);
  console.log(`${label} total chars:`, totalChars);
  console.log(`${label} volume_status:`, result.volume_validation.volume_status);

  const audit = await runAudit({
    rewrite_id: 0,
    target_level: 'SRC300',
    pages: result.pages,
    child_profile: genericProfile,
  });

  console.log(`${label} Length:`, audit.length_audit);
  console.log(`${label} External Char Rate:`, audit.character_audit.external_char_occurrence_rate?.toFixed(2) + '%');
  console.log(`${label} I+1A Rate:`, audit.language_unit_audit?.i_plus_1a_rate?.toFixed(2) + '%');
  console.log(`${label} High-load Rate:`, audit.language_unit_audit?.high_load_rate?.toFixed(2) + '%');
  console.log(`${label} Page Peak:`, audit.page_audit?.max_page_load?.toFixed(2) + '% @ p' + audit.page_audit?.max_page_number);
  console.log(`${label} I Rate:`, audit.language_unit_audit?.i_rate?.toFixed(2) + '%');
  console.log(`${label} I+1B Rate:`, audit.language_unit_audit?.i_plus_1b_rate?.toFixed(2) + '%');

  return { label, totalChars, audit, pages: result.pages };
}

async function main() {
  const masterPages = await getMasterPages(2);
  console.log('Master pages:', masterPages.length);

  const A = await run('A', masterPages);
  const B = await run('B', masterPages);

  console.log('\n===== SUMMARY =====');
  console.log(`Baseline: 426 chars, 12.4% ext, 40.0% i+1a, 20.0% hl, 25.0% peak`);
  console.log(`A: ${A.totalChars} chars, ${A.audit.character_audit.external_char_occurrence_rate?.toFixed(2)}% ext, ${A.audit.language_unit_audit?.i_plus_1a_rate?.toFixed(2)}% i+1a, ${A.audit.language_unit_audit?.high_load_rate?.toFixed(2)}% hl, ${A.audit.page_audit?.max_page_load?.toFixed(2)}% peak`);
  console.log(`B: ${B.totalChars} chars, ${B.audit.character_audit.external_char_occurrence_rate?.toFixed(2)}% ext, ${B.audit.language_unit_audit?.i_plus_1a_rate?.toFixed(2)}% i+1a, ${B.audit.language_unit_audit?.high_load_rate?.toFixed(2)}% hl, ${B.audit.page_audit?.max_page_load?.toFixed(2)}% peak`);

  // Save first page text for quality check
  console.log('\nA p1:', A.pages[0].text?.slice(0, 80));
  console.log('B p1:', B.pages[0].text?.slice(0, 80));
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
