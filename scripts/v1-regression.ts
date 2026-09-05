// V1.0 回归测试脚本
// - Golden Sample (rewrite_id=9) 审计验证
// - Phase 5B 实验版本审计验证
// - 新生成一个 SRC300 实验版本并审计

import { runAudit, AUDIT_ENGINE_VERSION } from "../src/lib/book-rewrite/audit";
import { getStandardV1 } from "../src/lib/book-rewrite/standard-v1";
import { query as pgQuery } from "../src/storage/database/pg-client";

async function loadRewrite(id: number) {
  const rows: any[] = await pgQuery("SELECT * FROM book_rewrite_versions WHERE id = $1", [id]);
  if (rows.length === 0) throw new Error(`rewrite ${id} not found`);
  return rows[0];
}

function auditRewrite(row: any) {
  const pages = row.pages_json.map((p: any) => ({
    page: p.page,
    text: p.text,
    image_url: p.image_url,
    original_text: p.original_text,
  }));
  return runAudit({
    pages,
    target_level: row.target_level,
    frontiers: row.frontier_targets,
    rewrite_id: row.id,
  });
}

function printAudit(label: string, result: any) {
  const la = result.length_audit;
  const ca = result.character_audit;
  const lu = result.language_unit_audit;
  const rep = result.repetition_audit;
  const pa = result.page_audit;
  const std = getStandardV1(result.target_level);

  console.log(`\n=== ${label} (${result.target_level}, engine=${result.engine_version}) ===`);
  console.log(`  Length:        ${la.actual} 字 (target ${la.target_min}-${la.target_max}, allowed ${la.allowed_max}) → ${la.status}`);
  console.log(`  Ext char rate: ${ca.external_char_occurrence_rate.toFixed(1)}% (max ${std.external_char_rate_max}%)`);
  console.log(`  I rate:        ${lu.i_rate.toFixed(1)}%`);
  console.log(`  I+1A rate:     ${lu.i_plus_1a_rate.toFixed(1)}% (target ${std.i_plus_1a_target_min}-${std.i_plus_1a_target_max}%)`);
  console.log(`  I+1B rate:     ${lu.i_plus_1b_rate.toFixed(1)}%`);
  console.log(`  High-load:     ${lu.high_load_rate.toFixed(1)}% (max ${std.high_load_rate_max}%)`);
  console.log(`  Total LU occ:  ${lu.total_occurrences}`);
  console.log(`  +1 unique:     ${rep.plus1_unique_total}, occ: ${rep.plus1_total_occurrences}`);
  console.log(`  +1 repeated:   ${rep.repeated_unique} unique / ${rep.repeated_occurrences} occ`);
  console.log(`  +1 dist:       1×=${rep.one_time}  2×=${rep.two_time}  3×=${rep.three_time}  4+=${rep.four_plus}`);
  console.log(`  Page peak:     ${pa.max_page_load.toFixed(1)}% @ p${pa.max_page_number} → ${pa.page_peak_status}`);
  console.log(`  Pages:         ${pa.total_pages}页, avg ${pa.avg_chars_per_page.toFixed(0)}字/页`);
}

async function main() {
  console.log("Audit Engine Version:", AUDIT_ENGINE_VERSION);
  console.log("V1 Standard check: SRC300 target =", getStandardV1("SRC300").length_target_min, "-", getStandardV1("SRC300").length_target_max);

  // A. Golden Sample
  console.log("\n--- A. Golden Sample Regression ---");
  const golden = await loadRewrite(9);
  const goldenAudit = auditRewrite(golden);
  printAudit("Golden Sample (rew=9)", goldenAudit);
  // Golden 473字 vs SRC300目标300-350 → 预期 STRONG_WARNING，符合预期

  // B. Phase 5B 实验版本
  console.log("\n--- B. Phase 5B Experiments ---");
  for (const id of [15, 16, 17, 21, 22]) {
    const row = await loadRewrite(id);
    const audit = auditRewrite(row);
    const mode = row.generation_params?.generation_mode || 'unknown';
    const label = row.generation_params?.profile_snapshot?.experimental_label || `rew=${id}`;
    printAudit(`${label} (${mode})`, audit);
  }

  console.log("\n✅ Regression tests completed.");
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
