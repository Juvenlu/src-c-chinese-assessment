// V1.0 新 SRC300 生成测试
import { query as pgQuery } from "../src/storage/database/pg-client";

async function main() {
  console.log("Generating new V1.0 SRC300 test version...");

  // 获取 master pages
  const pagesRows: any[] = await pgQuery(
    `SELECT page_number, image_url, original_text 
     FROM book_episode_pages 
     WHERE episode_id = 2 
     ORDER BY page_number`
  );
  console.log(`Master pages: ${pagesRows.length}`);

  const { generateRewrite } = await import("../src/lib/book-rewrite/generator");

  const result = await generateRewrite(
    pagesRows.map((r: any) => ({
      page: r.page_number,
      text: r.original_text,
      image_url: r.image_url,
    })),
    "SRC300",
    [], // 无 frontiers
    undefined // 无 child profile（generic mode）
  );

  console.log(`\nGenerated ${result.pages.length} pages`);
  console.log(`Status: ${result.volume_validation.volume_status}`);
  console.log(`Chars: ${result.volume_validation.actual_count} (target ${result.volume_validation.target_min}-${result.volume_validation.target_max})`);

  // 运行 audit
  const { runAudit } = await import("../src/lib/book-rewrite/audit");
  const audit = runAudit({
    pages: result.pages,
    target_level: "SRC300",
  });

  const la = audit.length_audit;
  const ca = audit.character_audit;
  const lu = audit.language_unit_audit;
  const rep = audit.repetition_audit;
  const pa = audit.page_audit;

  console.log(`\n=== V1.0 New SRC300 Test (generic, no frontiers) ===`);
  console.log(`  Length:        ${la.actual} 字 → ${la.status}`);
  console.log(`  Ext char rate: ${ca.external_char_occurrence_rate.toFixed(1)}%`);
  console.log(`  I+1A rate:     ${lu.i_plus_1a_rate.toFixed(1)}%`);
  console.log(`  High-load:     ${lu.high_load_rate.toFixed(1)}%`);
  console.log(`  +1 unique:     ${rep.plus1_unique_total}, occ: ${rep.plus1_total_occurrences}`);
  console.log(`  +1 repeated:   ${rep.repeated_unique} unique`);
  console.log(`  Page peak:     ${pa.max_page_load.toFixed(1)}% @ p${pa.max_page_number} → ${pa.page_peak_status}`);

  // 保存到数据库
  const insert: any[] = await pgQuery(
    `INSERT INTO book_rewrite_versions 
     (episode_id, target_level, pages_json, frontier_targets, status, generation_params, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      2,
      "SRC300",
      JSON.stringify(result.pages),
      JSON.stringify([]),
      "review",
      JSON.stringify({
        generation_mode: "experimental",
        profile_snapshot: { label: "v10-generic-test" },
        volume_validation: result.volume_validation,
        v1_guidance: true,
        audit_engine_version: audit.engine_version,
      }),
      1,
    ]
  );
  console.log(`\nSaved as rewrite_id = ${insert[0].id}`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
