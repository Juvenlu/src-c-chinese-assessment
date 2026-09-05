import { runAudit, auditRewriteById, saveAuditResult, pagesFromTexts } from '../src/lib/book-rewrite/audit';
import { getRewriteById } from '../src/lib/book-rewrite/rewrite-store';

const EXP_REWRITES = [
  { name: 'Emma-A1 (Personalized)', id: 15, child: 'emma', mode: 'personalized' },
  { name: 'Emma-A2 (Personalized)', id: 16, child: 'emma', mode: 'personalized' },
  { name: 'Emma-Generic', id: 17, child: null, mode: 'generic' },
  { name: 'Hellenna-SRC300', id: 18, child: 'hellenna', mode: 'personalized' },
];

async function main() {
  const results: Record<string, any> = {};
  
  for (const exp of EXP_REWRITES) {
    try {
      const r = await auditRewriteById(exp.id);
      results[exp.name] = r;
      console.log(`✅ ${exp.name} (rew=${exp.id}): ${r.character_audit.total_chinese_chars} chars, ext=${r.character_audit.external_char_occurrence_rate.toFixed(2)}%`);
    } catch (e: any) {
      console.error(`❌ ${exp.name}: ${e.message}`);
    }
  }

  const names = Object.keys(results);
  
  console.log('\n' + '='.repeat(80));
  console.log('PHASE 5B.1 — EXPERIMENT COMPARISON');
  console.log('='.repeat(80));

  // 1. Character Layer
  console.log('\n## 1. Character Layer');
  console.log('| Metric | ' + names.join(' | ') + ' |');
  console.log('| --- |' + names.map(() => ' ---: |').join(''));
  
  const charR = results[names[0]].character_audit;
  for (const key of Object.keys(charR)) {
    const row = [key];
    for (const n of names) {
      const v = results[n].character_audit[key];
      if (typeof v === 'number') {
        if (key.includes('rate') || key.includes('_rate')) row.push((v * 100).toFixed(2) + '%');
        else row.push(v.toString());
      } else if (v instanceof Set) row.push(`${v.size}`);
      else row.push(String(v?.length ?? '-'));
    }
    console.log('| ' + row.join(' | ') + ' |');
  }

  // 2. Language Unit Layer
  console.log('\n## 2. Language Unit Layer');
  const luR = results[names[0]].language_unit_audit;
  console.log('| Metric | ' + names.join(' | ') + ' |');
  console.log('| --- |' + names.map(() => ' ---: |').join(''));
  
  for (const key of Object.keys(luR)) {
    const v0 = luR[key];
    if (typeof v0 === 'object' && v0 !== null) continue; // skip arrays/objects
    if (typeof v0 !== 'number' && typeof v0 !== 'string') continue;
    const row = [key];
    for (const n of names) {
      const v = results[n].language_unit_audit[key];
      if (typeof v === 'number') {
        if (key.includes('rate') || key.includes('_rate')) row.push((v * 100).toFixed(2) + '%');
        else row.push(v.toString());
      } else row.push(String(v ?? '-'));
    }
    console.log('| ' + row.join(' | ') + ' |');
  }

  // 3. Repetition
  console.log('\n## 3. Repetition');
  const repR = results[names[0]].repetition_audit;
  console.log('| Metric | ' + names.join(' | ') + ' |');
  console.log('| --- |' + names.map(() => ' ---: |').join(''));
  
  for (const key of Object.keys(repR)) {
    const v0 = repR[key];
    if (typeof v0 === 'object' && v0 !== null) continue;
    const row = [key];
    for (const n of names) {
      const v = results[n].repetition_audit[key];
      row.push(String(v ?? '-'));
    }
    console.log('| ' + row.join(' | ') + ' |');
  }

  // 4. Page-level summary
  console.log('\n## 4. Page-level Summary');
  const paR = results[names[0]].page_audit;
  console.log('| Metric | ' + names.join(' | ') + ' |');
  console.log('| --- |' + names.map(() => ' ---: |').join(''));
  
  // Page counts and peaks
  const metrics = [
    'total_pages',
    'peak_external_rate_page',
    'peak_external_rate',
    'peak_high_load_page',
    'peak_high_load_count',
  ];
  for (const m of metrics) {
    const row = [m];
    for (const n of names) {
      row.push(String(results[n].page_audit[m] ?? '-'));
    }
    console.log('| ' + row.join(' | ') + ' |');
  }

  // Per-page table
  console.log('\n### Per-page External Rate (%)');
  const pages = results[names[0]].page_audit.pages;
  console.log('| Page | ' + names.join(' | ') + ' |');
  console.log('| --- |' + names.map(() => ' ---: |').join(''));
  
  for (let i = 0; i < pages.length; i++) {
    const row = [`P${i+1}`];
    for (const n of names) {
      const p = results[n].page_audit.pages[i];
      const rate = p ? (p.external_char_occurrences / Math.max(p.chinese_chars, 1) * 100) : 0;
      row.push(rate.toFixed(1) + '%');
    }
    console.log('| ' + row.join(' | ') + ' |');
  }

  // Per-page High-load
  console.log('\n### Per-page High-load LU');
  console.log('| Page | ' + names.join(' | ') + ' |');
  console.log('| --- |' + names.map(() => ' ---: |').join(''));
  
  for (let i = 0; i < pages.length; i++) {
    const row = [`P${i+1}`];
    for (const n of names) {
      const p = results[n].page_audit.pages[i];
      row.push(String(p?.high_load_lu ?? 0));
    }
    console.log('| ' + row.join(' | ') + ' |');
  }

  // 5. Frontier
  console.log('\n## 5. Frontier Audit');
  const fR = results[names[0]].frontier_audit;
  console.log('| Metric | ' + names.join(' | ') + ' |');
  console.log('| --- |' + names.map(() => ' ---: |').join(''));
  
  for (const key of Object.keys(fR ?? {})) {
    const v0 = fR[key];
    if (typeof v0 === 'object' && v0 !== null) continue;
    const row = [key];
    for (const n of names) {
      const v = results[n].frontier_audit?.[key];
      row.push(String(v ?? '-'));
    }
    console.log('| ' + row.join(' | ') + ' |');
  }

  // 6. Summary comparison
  console.log('\n## 6. Summary');
  const sR = results[names[0]].summary;
  console.log('| Metric | ' + names.join(' | ') + ' |');
  console.log('| --- |' + names.map(() => ' ---: |').join(''));
  
  for (const key of Object.keys(sR)) {
    const v0 = sR[key];
    if (typeof v0 === 'object' && v0 !== null) continue;
    const row = [key];
    for (const n of names) {
      const v = results[n].summary[key];
      if (typeof v === 'number') {
        if (key.includes('rate') || key.includes('_rate')) row.push((v * 100).toFixed(2) + '%');
        else row.push(v.toString());
      } else row.push(String(v ?? '-'));
    }
    console.log('| ' + row.join(' | ') + ' |');
  }

  // 7. Same Child Variation (A1 vs A2)
  console.log('\n## 7. Same-Child Random Variation (A1 vs A2)');
  const a1 = results['Emma-A1 (Personalized)'];
  const a2 = results['Emma-A2 (Personalized)'];
  const charDiff = Math.abs(a1.character_audit.total_chinese_chars - a2.character_audit.total_chinese_chars);
  const extDiff = Math.abs(a1.character_audit.external_char_occurrence_rate - a2.character_audit.external_char_occurrence_rate) * 100;
  const iDiff = Math.abs(a1.language_unit_audit.i_rate - a2.language_unit_audit.i_rate) * 100;
  const hlDiff = Math.abs(a1.language_unit_audit.high_load_rate - a2.language_unit_audit.high_load_rate) * 100;
  
  console.log(`- Char count diff: ${charDiff} (${((charDiff / a1.character_audit.total_chinese_chars) * 100).toFixed(1)}%)`);
  console.log(`- External rate diff: ${extDiff.toFixed(2)}pp`);
  console.log(`- I rate diff: ${iDiff.toFixed(2)}pp`);
  console.log(`- High-load rate diff: ${hlDiff.toFixed(2)}pp`);
  console.log(`- Total LU occ diff: ${Math.abs(a1.language_unit_audit.total_occurrences - a2.language_unit_audit.total_occurrences)}`);

  // 8. Generic vs Personalized
  console.log('\n## 8. Generic vs Personalized (A1 vs Generic)');
  const gen = results['Emma-Generic'];
  const charDiffGP = Math.abs(a1.character_audit.total_chinese_chars - gen.character_audit.total_chinese_chars);
  const extDiffGP = Math.abs(a1.character_audit.external_char_occurrence_rate - gen.character_audit.external_char_occurrence_rate) * 100;
  const iDiffGP = Math.abs(a1.language_unit_audit.i_rate - gen.language_unit_audit.i_rate) * 100;
  const hlDiffGP = Math.abs(a1.language_unit_audit.high_load_rate - gen.language_unit_audit.high_load_rate) * 100;
  
  console.log(`- Char count diff: ${charDiffGP} (${((charDiffGP / gen.character_audit.total_chinese_chars) * 100).toFixed(1)}%)`);
  console.log(`- External rate diff: ${extDiffGP.toFixed(2)}pp`);
  console.log(`- I rate diff: ${iDiffGP.toFixed(2)}pp`);
  console.log(`- I+1A rate diff: ${Math.abs(a1.language_unit_audit.i_plus_1a_rate - gen.language_unit_audit.i_plus_1a_rate) * 100}pp`);
  console.log(`- High-load rate diff: ${hlDiffGP.toFixed(2)}pp`);

  // 9. Text-level comparison
  console.log('\n## 9. Text-Level Comparison (First 3 pages sample)');
  const r15 = await getRewriteById(15);
  const r16 = await getRewriteById(16);
  const r17 = await getRewriteById(17);
  const r18 = await getRewriteById(18);

  const textSets = {
    'A1': r15?.pages_json?.map((p: any) => p.text || ''),
    'A2': r16?.pages_json?.map((p: any) => p.text || ''),
    'G': r17?.pages_json?.map((p: any) => p.text || ''),
    'H': r18?.pages_json?.map((p: any) => p.text || ''),
  };

  for (let p = 0; p < 3; p++) {
    console.log(`\n### Page ${p+1}`);
    for (const [k, texts] of Object.entries(textSets)) {
      if (texts) console.log(`[${k}] ${texts[p].substring(0, 60)}...`);
    }
  }
}

main().catch(console.error);
