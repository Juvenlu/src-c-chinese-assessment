import { auditRewriteById, saveAuditResult } from '../src/lib/book-rewrite/audit'

async function main() {
  const emmaId = 10
  const hellennaId = 13

  const emmaAudit = await auditRewriteById(emmaId, {
    childId: '93bf1578-7751-4234-83c3-e70932c6dd21',
  })
  await saveAuditResult(emmaId, emmaAudit)

  const hellennaAudit = await auditRewriteById(hellennaId, {
    childId: '5ac5cdc8-17d4-4758-8241-c3fa6408ab0c',
  })
  await saveAuditResult(hellennaId, hellennaAudit)

  const e = emmaAudit as any
  const h = hellennaAudit as any
  const ec = e.character_audit
  const hc = h.character_audit
  const el = e.language_unit_audit
  const hl = h.language_unit_audit
  const er = e.repetition_audit
  const hr = h.repetition_audit
  const ep = e.page_audit
  const hp = h.page_audit

  // Helper: count Set/Array
  const countOf = (x: any) => {
    if (Array.isArray(x)) return x.length
    if (x instanceof Set) return x.size
    if (typeof x === 'object' && x !== null) return Object.keys(x).length
    return 0
  }

  // ========================================
  // COMPARISON TABLE
  // ========================================
  console.log('# Phase 5B — Audit Comparison\n')
  console.log('| Metric | Emma (rew=10) | Hellenna (rew=13) | Δ |')
  console.log('| --- | ---: | ---: | ---: |')

  // Character
  console.log(`| Chinese chars | ${ec.total_chinese_chars} | ${hc.total_chinese_chars} | ${hc.total_chinese_chars - ec.total_chinese_chars} |`)
  console.log(`| SRC-in occurrences | ${ec.src_in_occurrences} | ${hc.src_in_occurrences} | ${hc.src_in_occurrences - ec.src_in_occurrences} |`)
  console.log(`| SRC-out occurrences | ${ec.src_out_occurrences} | ${hc.src_out_occurrences} | ${hc.src_out_occurrences - ec.src_out_occurrences} |`)
  console.log(`| Unique external chars | ${countOf(ec.src_out_unique)} | ${countOf(hc.src_out_unique)} | ${countOf(hc.src_out_unique) - countOf(ec.src_out_unique)} |`)
  console.log(`| External char rate | ${(ec.external_char_occurrence_rate*100).toFixed(2)}% | ${(hc.external_char_occurrence_rate*100).toFixed(2)}% | |`)

  // LU
  console.log(`| LU total occurrences | ${el.total_occurrences} | ${hl.total_occurrences} | ${hl.total_occurrences - el.total_occurrences} |`)
  console.log(`| LU unique count | ${countOf(el.unique_units)} | ${countOf(hl.unique_units)} | ${countOf(hl.unique_units) - countOf(el.unique_units)} |`)
  console.log(`| I occurrences | ${el.I_occurrences} | ${hl.I_occurrences} | ${hl.I_occurrences - el.I_occurrences} |`)
  console.log(`| I rate | ${(el.I_occurrence_rate*100).toFixed(1)}% | ${(hl.I_occurrence_rate*100).toFixed(1)}% | |`)
  console.log(`| I+1A occurrences | ${el.I1A_occurrences} | ${hl.I1A_occurrences} | ${hl.I1A_occurrences - el.I1A_occurrences} |`)
  console.log(`| I+1A rate | ${(el.I1A_occurrence_rate*100).toFixed(1)}% | ${(hl.I1A_occurrence_rate*100).toFixed(1)}% | |`)
  console.log(`| I+1B occurrences | ${el.I1B_occurrences} | ${hl.I1B_occurrences} | ${hl.I1B_occurrences - el.I1B_occurrences} |`)
  console.log(`| I+1B rate | ${(el.I1B_occurrence_rate*100).toFixed(1)}% | ${(hl.I1B_occurrence_rate*100).toFixed(1)}% | |`)
  console.log(`| High-load occurrences | ${el.high_load_occurrences} | ${hl.high_load_occurrences} | ${hl.high_load_occurrences - el.high_load_occurrences} |`)
  console.log(`| High-load rate | ${(el.high_load_occurrence_rate*100).toFixed(1)}% | ${(hl.high_load_occurrence_rate*100).toFixed(1)}% | |`)
  console.log(`| Narrow i+1 (A+B) rate | ${(el.narrow_i1_occurrence_rate*100).toFixed(1)}% | ${(hl.narrow_i1_occurrence_rate*100).toFixed(1)}% | |`)

  // Repetition
  console.log(`| +1 unique total | ${er.plus1_total_unique} | ${hr.plus1_total_unique} | |`)
  console.log(`| +1 total occurrences | ${er.plus1_total_occurrences} | ${hr.plus1_total_occurrences} | |`)
  console.log(`| +1 one-time | ${er.one_time_unique} | ${hr.one_time_unique} | |`)
  console.log(`| +1 two-time | ${er.two_time_unique} | ${hr.two_time_unique} | |`)
  console.log(`| +1 three-time | ${er.three_time_unique} | ${hr.three_time_unique} | |`)
  console.log(`| +1 four+ | ${er.four_plus_unique} | ${hr.four_plus_unique} | |`)
  console.log(`| Repeated +1 (unique) | ${er.repeated_unique_count} | ${hr.repeated_unique_count} | |`)
  console.log(`| Repeated +1 (occur) | ${er.repeated_occurrence_count} | ${hr.repeated_occurrence_count} | |`)

  // Page peak
  console.log(`\n| Max page external rate page | P${ep.peak.max_external_rate_page} (${(ep.peak.max_external_rate*100).toFixed(1)}%) | P${hp.peak.max_external_rate_page} (${(hp.peak.max_external_rate*100).toFixed(1)}%) | |`)
  console.log(`| Max page High-load page | P${ep.peak.max_high_load_page} (${ep.peak.max_high_load_count}) | P${hp.peak.max_high_load_page} (${hp.peak.max_high_load_count}) | |`)

  // Frontier
  if (e.frontier_audit && h.frontier_audit) {
    console.log(`\n| Frontier total | ${e.frontier_audit.total_frontier} | ${h.frontier_audit.total_frontier} | |`)
    console.log(`| Valid frontier | ${e.frontier_audit.valid_frontier} | ${h.frontier_audit.valid_frontier} | |`)
    console.log(`| Invalid frontier | ${e.frontier_audit.invalid_frontier} | ${h.frontier_audit.invalid_frontier} | |`)
  }

  // ========================================
  // PAGE-LEVEL TABLE
  // ========================================
  console.log('\n## Page-level Comparison\n')
  console.log('| Page | Emma chars | Emma ext% | Emma I | I+1A | I+1B | HL | Hel chars | Hel ext% | Hel I | I+1A | I+1B | HL | Same Text? |')
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |')

  // Get the actual page texts from rewrite-store
  // For now, let me get them via another path
  const ePages = ep.pages
  const hPages = hp.pages
  let differentPages = 0

  // Get full texts from pages_json - we need to import getRewriteById
  const { getRewriteById } = await import('../src/lib/book-rewrite/rewrite-store')
  const eRewrite = await getRewriteById(emmaId)
  const hRewrite = await getRewriteById(hellennaId)

  for (let i = 0; i < Math.min(ePages.length, hPages.length); i++) {
    const epg: any = ePages[i]
    const hpg: any = hPages[i]
    const eText = eRewrite?.pages_json[i]?.text || ''
    const hText = hRewrite?.pages_json[i]?.text || ''
    const same = eText === hText
    if (!same) differentPages++
    console.log(`| P${i+1} | ${epg.chinese_chars} | ${(epg.external_char_rate*100).toFixed(1)}% | ${epg.I} | ${epg['I+1A']} | ${epg['I+1B']} | ${epg['High-load']} | ${hpg.chinese_chars} | ${(hpg.external_char_rate*100).toFixed(1)}% | ${hpg.I} | ${hpg['I+1A']} | ${hpg['I+1B']} | ${hpg['High-load']} | ${same ? '✓' : '✗'} |`)
  }

  console.log(`\n**Different pages: ${differentPages} / ${Math.min(ePages.length, hPages.length)}**`)

  // ========================================
  // TEXT DIFF DETAIL
  // ========================================
  console.log('\n## Text Difference Detail (side by side)\n')
  if (eRewrite && hRewrite) {
    for (let i = 0; i < Math.min(eRewrite.pages_json.length, hRewrite.pages_json.length); i++) {
      const eText = eRewrite.pages_json[i].text
      const hText = hRewrite.pages_json[i].text
      if (eText !== hText) {
        console.log(`### Page ${i+1}\n`)
        console.log(`**Emma:** ${eText}\n`)
        console.log(`**Hellenna:** ${hText}\n`)
        console.log('---\n')
      }
    }
  }

  // ========================================
  // High-load / I+1A lists
  // ========================================
  console.log('\n## High-load Units\n')
  console.log('### Emma\n')
  const eUnits: any[] = el.units || []
  for (const u of eUnits) {
    if (u.level === 'High-load') console.log(`- ${u.unit} ×${u.occurrences}`)
  }
  console.log('\n### Hellenna\n')
  const hUnits: any[] = hl.units || []
  for (const u of hUnits) {
    if (u.level === 'High-load') console.log(`- ${u.unit} ×${u.occurrences}`)
  }

  console.log('\n## I+1A Units\n')
  console.log('### Emma\n')
  for (const u of eUnits) {
    if (u.level === 'I+1A') console.log(`- ${u.unit} ×${u.occurrences}`)
  }
  console.log('\n### Hellenna\n')
  for (const u of hUnits) {
    if (u.level === 'I+1A') console.log(`- ${u.unit} ×${u.occurrences}`)
  }

  console.log('\n## I+1B Units\n')
  console.log('### Emma\n')
  for (const u of eUnits) {
    if (u.level === 'I+1B') console.log(`- ${u.unit} ×${u.occurrences}`)
  }
  console.log('\n### Hellenna\n')
  for (const u of hUnits) {
    if (u.level === 'I+1B') console.log(`- ${u.unit} ×${u.occurrences}`)
  }
}

main().catch(console.error)
