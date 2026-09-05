import { auditRewriteById } from '../src/lib/book-rewrite/audit'

async function main() {
  const emmaAudit = await auditRewriteById(10, {
    childId: '93bf1578-7751-4234-83c3-e70932c6dd21',
  })
  const e = emmaAudit as any

  console.log('=== Page Audit Structure ===')
  console.log('page_audit keys:', Object.keys(e.page_audit))
  console.log('page_audit.peak keys:', Object.keys(e.page_audit.peak || {}))
  console.log('page_audit.total keys:', Object.keys(e.page_audit.total || {}))
  console.log('page_audit.pages is array:', Array.isArray(e.page_audit.pages))
  console.log('page_audit.pages.length:', e.page_audit.pages?.length)
  if (e.page_audit.pages?.[0]) {
    console.log('page[0] keys:', Object.keys(e.page_audit.pages[0]))
    console.log('page[0].character_audit keys:', Object.keys(e.page_audit.pages[0].character_audit || {}))
    console.log('page[0].language_unit_audit keys:', Object.keys(e.page_audit.pages[0].language_unit_audit || {}))
    console.log('page[0].text:', e.page_audit.pages[0].text ? 'yes' : 'no')
  }

  console.log('\n=== unique_units ===')
  console.log('lu.unique_units is array:', Array.isArray(e.language_unit_audit.unique_units))
  console.log('lu.unique_units.length:', e.language_unit_audit.unique_units?.length)

  console.log('\n=== frontier_audit ===')
  console.log('frontier_audit keys:', e.frontier_audit ? Object.keys(e.frontier_audit) : 'null')

  console.log('\n=== src_out_unique ===')
  console.log('src_out_unique is array:', Array.isArray(e.character_audit.src_out_unique))
  console.log('src_out_unique.length:', e.character_audit.src_out_unique?.length)
}

main().catch(console.error)
