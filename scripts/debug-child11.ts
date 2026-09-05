import { query } from '../src/storage/database/pg-client'

async function main() {
  // Find all test_results with a child_id and known_characters
  const r = await query(
    `SELECT tr.id, tr.child_id, tr.test_mode, tr.level, tr.stable_char_count, 
       jsonb_array_length(tr.known_characters) as known_len,
       tr.created_at,
       c.nickname
     FROM public.test_results tr
     LEFT JOIN public.children c ON tr.child_id = c.id
     WHERE tr.known_characters IS NOT NULL
       AND tr.known_characters != '[]'::jsonb
     ORDER BY tr.created_at DESC
     LIMIT 30`
  )
  console.log('test_results with known_characters:', JSON.stringify(r, null, 2))
}

main().catch(console.error)
