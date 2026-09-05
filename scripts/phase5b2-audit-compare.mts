/**
 * Phase 5B.2 — Audit & 对比分析脚本 (纯 Node + 动态 import)
 */
import { runAudit } from '../src/lib/book-rewrite/audit/audit-engine.js';
import { query } from '../src/storage/database/pg-client.js';

const REWRITE_A = 21;
const REWRITE_B = 22;

async function getRewrite(id: number) {
  const rows = await query(
    `SELECT id, episode_id, target_level, pages_json, frontier_targets, status,
            generation_params, validation_result
     FROM book_rewrite_versions WHERE id = $1`,
    [id]
  );
  return rows[0];
}

async function doAudit(id: number, label: string) {
  console.log(`\n[${label}] 开始审计 rewrite_id=${id}`);
  const rewrite = await getRewrite(id);
  const result = runAudit({
    pages: rewrite.pages_json,
    target_level: rewrite.target_level,
    frontier_targets: rewrite.frontier_targets || [],
    rewrite_id: id,
  });
  return result;
}

function summarize(label: string, audit: any) {
  console.log(`\n--- ${label} Summary ---`);
  console.log(`  总汉字数: ${audit.character.total_char_occurrences}`);
  console.log(`  唯一汉字数: ${audit.character.unique_chars}`);
  console.log(`  SRC范围内: ${audit.character.src_in_occurrences} (${(audit.character.src_in_occurrence_rate * 100).toFixed(1)}%)`);
  console.log(`  SRC范围外: ${audit.character.src_out_occurrences} (${(audit.character.external_char_occurrence_rate * 100).toFixed(1)}%)`);
  console.log(`  语言单位数: ${audit.language_unit.total_units}`);
  console.log(`  四级分类:`);
  for (const lvl of ['I', 'I+1A', 'I+1B', 'High-load']) {
    const c = audit.level_classification[lvl];
    console.log(`    ${lvl}: ${c.count} (${(c.ratio * 100).toFixed(1)}%)`);
  }
  console.log(`  Frontiers: 目标${audit.frontier.frontier_targets_count}, 命中${audit.frontier.frontiers_found_count}, 有效${audit.frontier.valid_frontiers_count}`);
  console.log(`  重复度: max=${audit.repetition.max_repetition_count}, avg=${audit.repetition.average_repetition_count.toFixed(2)}`);
}

function compareAudits(auditA: any, auditB: any) {
  console.log('\n========== A vs B 定量对比 ==========');
  
  console.log(`\n[字符层]`);
  console.log(`  总汉字数: A=${auditA.character.total_char_occurrences}, B=${auditB.character.total_char_occurrences}, Δ=${auditA.character.total_char_occurrences - auditB.character.total_char_occurrences}`);
  console.log(`  SRC范围内率: A=${(auditA.character.src_in_occurrence_rate*100).toFixed(1)}%, B=${(auditB.character.src_in_occurrence_rate*100).toFixed(1)}%`);
  console.log(`  SRC范围外率: A=${(auditA.character.external_char_occurrence_rate*100).toFixed(1)}%, B=${(auditB.character.external_char_occurrence_rate*100).toFixed(1)}%`);

  console.log(`\n[四级分类]`);
  for (const lvl of ['I', 'I+1A', 'I+1B', 'High-load']) {
    const a = auditA.level_classification[lvl];
    const b = auditB.level_classification[lvl];
    const deltaCount = a.count - b.count;
    const deltaRatio = ((a.ratio - b.ratio) * 100).toFixed(1);
    console.log(`  ${lvl}: A=${a.count}(${(a.ratio*100).toFixed(1)}%), B=${b.count}(${(b.ratio*100).toFixed(1)}%), Δ=${deltaCount >= 0 ? '+' : ''}${deltaCount} (${deltaRatio >= 0 ? '+' : ''}${deltaRatio}pp)`);
  }

  console.log(`\n[Frontier]`);
  console.log(`  目标: A=${auditA.frontier.frontier_targets_count}, B=${auditB.frontier.frontier_targets_count}`);
  console.log(`  命中: A=${auditA.frontier.frontiers_found_count}, B=${auditB.frontier.frontiers_found_count}`);
  console.log(`  有效: A=${auditA.frontier.valid_frontiers_count}, B=${auditB.frontier.valid_frontiers_count}`);
}

async function outputTextSamples() {
  const ra = await getRewrite(REWRITE_A);
  const rb = await getRewrite(REWRITE_B);
  const pagesA = ra.pages_json;
  const pagesB = rb.pages_json;
  
  console.log('\n\n========== 文本逐页对比 ==========');
  for (let i = 0; i < Math.min(pagesA.length, pagesB.length); i++) {
    const pA = pagesA[i];
    const pB = pagesB[i];
    console.log(`\n--- 第${pA.page}页 ---`);
    console.log(`A: ${pA.text}`);
    console.log(`B: ${pB.text}`);
    if (pA.frontier?.length || pB.frontier?.length) {
      console.log(`  A-Frontiers: [${pA.frontier?.join(', ') || ''}]`);
      console.log(`  B-Frontiers: [${pB.frontier?.join(', ') || ''}]`);
    }
  }
}

async function main() {
  console.log('Phase 5B.2 — Audit Comparison');
  console.log(`exp-A (action-focused): rewrite_id=${REWRITE_A}`);
  console.log(`exp-B (object-focused + weak signals): rewrite_id=${REWRITE_B}`);

  const auditA = await doAudit(REWRITE_A, 'exp-A');
  const auditB = await doAudit(REWRITE_B, 'exp-B');

  summarize('exp-A (action)', auditA);
  summarize('exp-B (object)', auditB);
  compareAudits(auditA, auditB);
  await outputTextSamples();

  console.log('\n\n✅ 对比分析完成');
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
