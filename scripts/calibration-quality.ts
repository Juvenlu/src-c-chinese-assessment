import { generateRewrite } from '../src/lib/book-rewrite/generator';
import type { RewritePage, ChildReadingProfile } from '../src/lib/book-rewrite/audit/types';
import { Pool } from 'pg';

async function getMasterPages(episodeId: number): Promise<RewritePage[]> {
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
  stable_char_count: 250, stable_vocab_count: 300,
  character_mastery_rate: 85, vocab_mastery_rate: 80,
  known_characters: [], known_vocabulary: [],
  weak_char_signals: [], weak_word_signals: [],
};

async function main() {
  const masterPages = await getMasterPages(2);

  // Generate one more for quality check
  const result = await generateRewrite(masterPages, 'SRC300', [], genericProfile);
  const totalChars = result.pages.reduce((s, p) => s + (p.text?.match(/[\u4e00-\u9fff]/g)?.length || 0), 0);
  console.log(`\nTotal chars: ${totalChars}`);
  console.log('\n===== FULL TEXT (quality check) =====');
  for (const p of result.pages) {
    const charCount = p.text?.match(/[\u4e00-\u9fff]/g)?.length || 0;
    console.log(`\n--- P${p.page} (${charCount} chars) ---`);
    console.log(p.text);
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
