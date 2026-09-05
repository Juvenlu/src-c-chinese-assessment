import { auditRewriteById, saveAuditResult } from '../src/lib/book-rewrite/audit'

async function main() {
  const emmaId = 10
  const hellennaId = 13

  const emmaAudit = await auditRewriteById(emmaId, {
    childId: '93bf1578-7751-4234-83c3-e70932c6dd21',
  })
  const emmaAuditId = await saveAuditResult(emmaId, emmaAudit)
  console.log(`Emma saved as audit_id=${emmaAuditId}`)

  const hellennaAudit = await auditRewriteById(hellennaId, {
    childId: '5ac5cdc8-17d4-4758-8241-c3fa6408ab0c',
  })
  const helAuditId = await saveAuditResult(hellennaId, hellennaAudit)
  console.log(`Hellenna saved as audit_id=${helAuditId}`)

  // Just dump key paths
  console.log('\n=== KEY STRUCTURE CHECK ===')
  console.log('Emma keys:', Object.keys(emmaAudit))
  console.log('Emma character_audit keys:', Object.keys(emmaAudit.character_audit))
  console.log('Emma language_unit_audit keys:', Object.keys(emmaAudit.language_unit_audit))
  console.log('Emma lu summary:', JSON.stringify(emmaAudit.language_unit_audit.summary || 'NO SUMMARY'))
  console.log('Emma repetition_audit keys:', Object.keys(emmaAudit.repetition_audit))
  console.log('Emma page_audit keys:', Object.keys(emmaAudit.page_audit))
  console.log('Emma page_audit summary keys:', Object.keys(emmaAudit.page_audit.summary || {}))
  console.log('Emma frontier_audit:', emmaAudit.frontier_audit ? 'yes' : 'no')
}

main().catch(console.error)
