import { auditRewriteById, saveAuditResult } from '../src/lib/book-rewrite/audit'

async function main() {
  const emmaId = 10
  const hellennaId = 13

  console.log('=== Emma (rewrite=10) ===')
  const emmaAudit = await auditRewriteById(emmaId, {
    childId: '93bf1578-7751-4234-83c3-e70932c6dd21',
  })
  const emmaId2 = await saveAuditResult(emmaId, emmaAudit)
  console.log(`Saved as audit_id=${emmaId2}`)
  printAuditSummary('Emma', emmaAudit)

  console.log('\n=== Hellenna (rewrite=13) ===')
  const hellennaAudit = await auditRewriteById(hellennaId, {
    childId: '5ac5cdc8-17d4-4758-8241-c3fa6408ab0c',
  })
  const helId = await saveAuditResult(hellennaId, hellennaAudit)
  console.log(`Saved as audit_id=${helId}`)
  printAuditSummary('Hellenna', hellennaAudit)

  // Comparison table
  console.log('\n=== COMPARISON TABLE ===')
  const e = emmaAudit
  const h = hellennaAudit
  const lu = (a: any) => a.language_unit_audit.summary

  console.log(`Metric,Emma,Hellenna,Diff`)
  console.log(`Chinese chars,${e.character_audit.total_chinese_chars},${h.character_audit.total_chinese_chars},${h.character_audit.total_chinese_chars - e.character_audit.total_chinese_chars}`)
  console.log(`External char occur,${e.character_audit.src_out_count},${h.character_audit.src_out_count},${h.character_audit.src_out_count - e.character_audit.src_out_count}`)
  console.log(`External char rate,${(e.character_audit.external_char_occurrence_rate * 100).toFixed(2)}%,${(h.character_audit.external_char_occurrence_rate * 100).toFixed(2)}%,`)
  console.log(`Unique external chars,${e.character_audit.src_out_unique_chars.length},${h.character_audit.src_out_unique_chars.length},`)
  console.log(`LU total occurrences,${lu(e).total_occurrences},${lu(h).total_occurrences},`)
  console.log(`LU unique,${lu(e).unique_count},${lu(h).unique_count},`)
  console.log(`I occurrences,${lu(e).level_breakdown.I.occurrences},${lu(h).level_breakdown.I.occurrences},`)
  console.log(`I+1A occurrences,${lu(e).level_breakdown['I+1A'].occurrences},${lu(h).level_breakdown['I+1A'].occurrences},`)
  console.log(`I+1B occurrences,${lu(e).level_breakdown['I+1B'].occurrences},${lu(h).level_breakdown['I+1B'].occurrences},`)
  console.log(`High-load occurrences,${lu(e).level_breakdown['High-load'].occurrences},${lu(h).level_breakdown['High-load'].occurrences},`)
  console.log(`I rate,${lu(e).I_rate.toFixed(1)}%,${lu(h).I_rate.toFixed(1)}%,`)
  console.log(`I+1A rate,${lu(e).I_plus_1A_rate.toFixed(1)}%,${lu(h).I_plus_1A_rate.toFixed(1)}%,`)
  console.log(`I+1B rate,${lu(e).I_plus_1B_rate.toFixed(1)}%,${lu(h).I_plus_1B_rate.toFixed(1)}%,`)
  console.log(`High-load rate,${lu(e).high_load_rate.toFixed(1)}%,${lu(h).high_load_rate.toFixed(1)}%,`)

  // Repetition
  const rep = (a: any) => a.repetition_audit.summary
  console.log(`\nRepeated +1 units,${rep(e).repeated_plus_1_unique},${rep(h).repeated_plus_1_unique},`)
  console.log(`One-time +1 units,${rep(e).one_time_plus_1_unique},${rep(h).one_time_plus_1_unique},`)
  console.log(`Repeated +1 occurrences,${rep(e).repeated_plus_1_occurrences},${rep(h).repeated_plus_1_occurrences},`)

  // Page peak
  const pa = (a: any) => a.page_audit.summary
  console.log(`\nMax page chars,${pa(e).max_chinese_chars},${pa(h).max_chinese_chars},`)
  console.log(`Max page external rate,${(pa(e).max_external_rate * 100).toFixed(1)}%,${(pa(h).max_external_rate * 100).toFixed(1)}%,`)
  console.log(`Max page I+1 total,${pa(e).max_i_plus_1_occurrences},${pa(h).max_i_plus_1_occurrences},`)
  console.log(`Max page high_load,${pa(e).max_high_load_occurrences},${pa(h).max_high_load_occurrences},`)

  // Frontier
  if (e.frontier_audit && h.frontier_audit) {
    console.log(`\nFrontier total,${e.frontier_audit.total_frontiers},${h.frontier_audit.total_frontiers},`)
    console.log(`Valid frontier,${e.frontier_audit.valid_count},${h.frontier_audit.valid_count},`)
    console.log(`Invalid frontier,${e.frontier_audit.invalid_count},${h.frontier_audit.invalid_count},`)
  }

  // Page-level detail
  console.log('\n=== PAGE-LEVEL DETAIL ===')
  console.log('Page,Emma_chars,Emma_ext%,Emma_I,Emma_I+1A,Emma_I+1B,Emma_HL,Hel_chars,Hel_ext%,Hel_I,Hel_I+1A,Hel_I+1B,Hel_HL')
  for (let i = 0; i < Math.min(e.page_audit.pages.length, h.page_audit.pages.length); i++) {
    const ep = e.page_audit.pages[i]
    const hp = h.page_audit.pages[i]
    console.log(`P${i+1},${ep.character_audit.total_chinese_chars},${(ep.character_audit.external_char_occurrence_rate*100).toFixed(1)}%,${ep.language_unit_audit.level_breakdown.I.occurrences},${ep.language_unit_audit.level_breakdown['I+1A'].occurrences},${ep.language_unit_audit.level_breakdown['I+1B'].occurrences},${ep.language_unit_audit.level_breakdown['High-load'].occurrences},${hp.character_audit.total_chinese_chars},${(hp.character_audit.external_char_occurrence_rate*100).toFixed(1)}%,${hp.language_unit_audit.level_breakdown.I.occurrences},${hp.language_unit_audit.level_breakdown['I+1A'].occurrences},${hp.language_unit_audit.level_breakdown['I+1B'].occurrences},${hp.language_unit_audit.level_breakdown['High-load'].occurrences}`)
  }

  // Text diff - print first 200 chars per page
  console.log('\n=== PAGE TEXT SIDE BY SIDE (first 100 chars) ===')
  for (let i = 0; i < Math.min(e.page_audit.pages.length, h.page_audit.pages.length); i++) {
    const et = (e.page_audit.pages[i] as any).text || ''
    const ht = (h.page_audit.pages[i] as any).text || ''
    const same = et === ht
    console.log(`\nP${i+1} ${same ? '=== SAME ===' : '=== DIFFERENT ==='}`)
    console.log(`E: ${et.slice(0, 80)}`)
    console.log(`H: ${ht.slice(0, 80)}`)
  }
}

function printAuditSummary(name: string, audit: any) {
  console.log(`\n--- ${name} Summary ---`)
  console.log(`Engine: ${audit.engine_version}`)
  console.log(`Char lib: ${audit.src_char_library_version}`)
  console.log(`Vocab lib: ${audit.src_vocab_library_version}`)
  console.log(`Target level: ${audit.target_level}`)
  console.log(`Chars: ${audit.character_audit.total_chinese_chars}`)
  console.log(`External rate: ${(audit.character_audit.external_char_occurrence_rate*100).toFixed(2)}%`)
  console.log(`LU total: ${audit.language_unit_audit.summary.total_occurrences}`)
  console.log(`LU unique: ${audit.language_unit_audit.summary.unique_count}`)
}

main().catch(console.error)
