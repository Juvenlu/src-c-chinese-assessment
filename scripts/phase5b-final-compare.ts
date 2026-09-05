import { auditRewriteById, saveAuditResult } from '../src/lib/book-rewrite/audit'

async function main() {
  const emmaId = 10
  const hellennaId = 13

  const emmaAudit = await auditRewriteById(emmaId, {
    childId: '93bf1578-7751-4234-83c3-e70932c6dd21',
  })

  const hellennaAudit = await auditRewriteById(hellennaId, {
    childId: '5ac5cdc8-17d4-4758-8241-c3fa6408ab0c',
  })

  const e = emmaAudit as any
  const h = hellennaAudit as any

  // ========================================
  // COMPARISON TABLE
  // ========================================
  console.log('# Phase 5B — Audit Comparison\n')
  console.log('| Metric | Emma (r=10) | Hellenna (r=13) | Diff |')
  console.log('| --- | ---: | ---: | ---: |')

  // Character
  const ec = e.character_audit
  const hc = h.character_audit
  console.log(`| Chinese chars | ${ec.total_chinese_chars} | ${hc.total_chinese_chars} | ${hc.total_chinese_chars - ec.total_chinese_chars} |`)
  console.log(`| SRC-in occurrences | ${ec.src_in_occurrences} | ${hc.src_in_occurrences} | ${hc.src_in_occurrences - ec.src_in_occurrences} |`)
  console.log(`| SRC-out occurrences | ${ec.src_out_occurrences} | ${hc.src_out_occurrences} | ${hc.src_out_occurrences - ec.src_out_occurrences} |`)
  console.log(`| Unique external chars | ${ec.src_out_unique.length} | ${hc.src_out_unique.length} | ${hc.src_out_unique.length - ec.src_out_unique.length} |`)
  console.log(`| External char rate | ${(ec.external_char_occurrence_rate*100).toFixed(2)}% | ${(hc.external_char_occurrence_rate*100).toFixed(2)}% | |`)

  // Language Unit
  const el = e.language_unit_audit
  const hl = h.language_unit_audit
  console.log(`| LU total occurrences | ${el.total_occurrences} | ${hl.total_occurrences} | ${hl.total_occurrences - el.total_occurrences} |`)
  console.log(`| LU unique | ${el.unique_units.length} | ${hl.unique_units.length} | ${hl.unique_units.length - el.unique_units.length} |`)
  console.log(`| I occurrences | ${el.I_occurrences} | ${hl.I_occurrences} | ${hl.I_occurrences - el.I_occurrences} |`)
  console.log(`| I rate | ${el.I_occurrence_rate.toFixed(1)}% | ${hl.I_occurrence_rate.toFixed(1)}% | |`)
  console.log(`| I+1A occurrences | ${el.I1A_occurrences} | ${hl.I1A_occurrences} | ${hl.I1A_occurrences - el.I1A_occurrences} |`)
  console.log(`| I+1A rate | ${el.I1A_occurrence_rate.toFixed(1)}% | ${hl.I1A_occurrence_rate.toFixed(1)}% | |`)
  console.log(`| I+1B occurrences | ${el.I1B_occurrences} | ${hl.I1B_occurrences} | ${hl.I1B_occurrences - el.I1B_occurrences} |`)
  console.log(`| I+1B rate | ${el.I1B_occurrence_rate.toFixed(1)}% | ${hl.I1B_occurrence_rate.toFixed(1)}% | |`)
  console.log(`| High-load occurrences | ${el.high_load_occurrences} | ${hl.high_load_occurrences} | ${hl.high_load_occurrences - el.high_load_occurrences} |`)
  console.log(`| High-load rate | ${el.high_load_occurrence_rate.toFixed(1)}% | ${hl.high_load_occurrence_rate.toFixed(1)}% | |`)
  console.log(`| Narrow i+1 (A+B) rate | ${el.narrow_i1_occurrence_rate.toFixed(1)}% | ${hl.narrow_i1_occurrence_rate.toFixed(1)}% | |`)

  // Repetition
  const er = e.repetition_audit
  const hr = h.repetition_audit
  console.log(`| +1 unique total | ${er.plus1_total_unique} | ${hr.plus1_total_unique} | |`)
  console.log(`| +1 total occurrences | ${er.plus1_total_occurrences} | ${hr.plus1_total_occurrences} | |`)
  console.log(`| +1 one-time (unique) | ${er.one_time_unique} | ${hr.one_time_unique} | |`)
  console.log(`| +1 two-time (unique) | ${er.two_time_unique} | ${hr.two_time_unique} | |`)
  console.log(`| +1 three-time (unique) | ${er.three_time_unique} | ${hr.three_time_unique} | |`)
  console.log(`| +1 four+ (unique) | ${er.four_plus_unique} | ${hr.four_plus_unique} | |`)
  console.log(`| Repeated +1 (unique) | ${er.repeated_unique_count} | ${hr.repeated_unique_count} | |`)
  console.log(`| Repeated +1 occurrences | ${er.repeated_occurrence_count} | ${hr.repeated_occurrence_count} | |`)

  // Page peak
  const ep = e.page_audit
  const hp = h.page_audit
  console.log(`\n| Max page chars | ${ep.peak.max_chinese_chars} | ${hp.peak.max_chinese_chars} | |`)
  console.log(`| Max page external rate | ${(ep.peak.max_external_rate*100).toFixed(1)}% | ${(hp.peak.max_external_rate*100).toFixed(1)}% | |`)
  console.log(`| Max page I+1 total | ${ep.peak.max_i_plus_1} | ${hp.peak.max_i_plus_1} | |`)
  console.log(`| Max page High-load | ${ep.peak.max_high_load} | ${hp.peak.max_high_load} | |`)

  // Frontier
  if (e.frontier_audit && h.frontier_audit) {
    console.log(`\n| Frontier total | ${e.frontier_audit.total} | ${h.frontier_audit.total} | |`)
    console.log(`| Valid frontier | ${e.frontier_audit.valid_count} | ${h.frontier_audit.valid_count} | |`)
    console.log(`| Invalid frontier | ${e.frontier_audit.invalid_count} | ${h.frontier_audit.invalid_count} | |`)
  }

  // ========================================
  // PAGE-LEVEL TABLE
  // ========================================
  console.log('\n## Page-level Comparison\n')
  console.log('| Page | Emma chars | Emma ext% | Emma I | Emma I+1A | Emma I+1B | Emma HL | Hel chars | Hel ext% | Hel I | Hel I+1A | Hel I+1B | Hel HL | Same? |')
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |')

  const ePages = ep.pages
  const hPages = hp.pages
  let differentPages = 0
  const diffDetails: {page: number, eText: string, hText: string}[] = []

  for (let i = 0; i < Math.min(ePages.length, hPages.length); i++) {
    const epg: any = ePages[i]
    const hpg: any = hPages[i]
    const eText = epg.text || ''
    const hText = hpg.text || ''
    const same = eText === hText
    if (!same) {
      differentPages++
      diffDetails.push({ page: i+1, eText, hText })
    }
    console.log(`| P${i+1} | ${epg.character_audit.total_chinese_chars} | ${(epg.character_audit.external_char_occurrence_rate*100).toFixed(1)}% | ${epg.language_unit_audit.I_occurrences} | ${epg.language_unit_audit.I1A_occurrences} | ${epg.language_unit_audit.I1B_occurrences} | ${epg.language_unit_audit.high_load_occurrences} | ${hpg.character_audit.total_chinese_chars} | ${(hpg.character_audit.external_char_occurrence_rate*100).toFixed(1)}% | ${hpg.language_unit_audit.I_occurrences} | ${hpg.language_unit_audit.I1A_occurrences} | ${hpg.language_unit_audit.I1B_occurrences} | ${hpg.language_unit_audit.high_load_occurrences} | ${same ? '✓' : '✗'} |`)
  }

  console.log(`\n**Different pages: ${differentPages} / ${Math.min(ePages.length, hPages.length)}**`)

  // ========================================
  // TEXT DIFF DETAIL
  // ========================================
  console.log('\n## Text Difference Detail\n')
  for (const d of diffDetails) {
    console.log(`### Page ${d.page}\n`)
    console.log(`**Emma:** ${d.eText}\n`)
    console.log(`**Hellenna:** ${d.hText}\n`)
    console.log('---\n')
  }

  // High-load lists
  console.log('\n## High-load Lists\n')
  console.log('### Emma High-load Units\n')
  const eHL = el.units.filter((u: any) => u.level === 'High-load')
  for (const u of eHL) {
    console.log(`- ${u.unit} (occurrences: ${u.occurrences})`)
  }
  console.log('\n### Hellenna High-load Units\n')
  const hHL = hl.units.filter((u: any) => u.level === 'High-load')
  for (const u of hHL) {
    console.log(`- ${u.unit} (occurrences: ${u.occurrences})`)
  }

  // I+1A lists
  console.log('\n## I+1A Lists\n')
  console.log('### Emma I+1A Units\n')
  const eI1A = el.units.filter((u: any) => u.level === 'I+1A')
  for (const u of eI1A) {
    console.log(`- ${u.unit} (occurrences: ${u.occurrences})`)
  }
  console.log('\n### Hellenna I+1A Units\n')
  const hI1A = hl.units.filter((u: any) => u.level === 'I+1A')
  for (const u of hI1A) {
    console.log(`- ${u.unit} (occurrences: ${u.occurrences})`)
  }
}

main().catch(console.error)
