#!/usr/bin/env node
/**
 * One-off migration script:
 *   Legacy PG book_rewrite_versions.id=24
 *   → Production D1 book_rewrite_versions.id=24
 *
 * Usage:
 *   DRY_RUN=1     node scripts/migrate-rewrite24.mjs   # preview only, no write
 *   DRY_RUN=0     node scripts/migrate-rewrite24.mjs   # actual INSERT
 *
 * Strictly single-row migration: id=24 only.
 * 
 * Execution method: generates a .sql file, then runs via
 *   npx wrangler d1 execute <db> --remote --file <path>
 * (safer than shell-escaping JSON strings as CLI args)
 */

import pg from "pg";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { Client } = pg;

const DRY_RUN = process.env.DRY_RUN !== "0"; // default dry-run
const D1_DATABASE = "src-primary-database";
const REWRITE_ID = 24;
const SQL_OUT = path.join(os.tmpdir(), `migrate-rewrite-${REWRITE_ID}.sql`);

// ── 1. Read from Legacy PG ──────────────────────────────────────
async function readLegacyRewrite() {
  const client = new Client({
    connectionString: process.env.LEGACY_DATABASE_URL || process.env.DATABASE_URL,
  });
  await client.connect();

  const res = await client.query(
    `SELECT * FROM book_rewrite_versions WHERE id = $1`,
    [REWRITE_ID]
  );

  if (res.rows.length === 0) {
    throw new Error(`Legacy PG rewrite id=${REWRITE_ID} not found`);
  }

  await client.end();
  return res.rows[0];
}

// ── 2. Derive char stats from pages_json ────────────────────────
function deriveStats(pagesArr) {
  const CHINESE_RE = /[\u4e00-\u9fff]/g;
  let total = 0;
  let max = 0;
  const uniqueSet = new Set();

  for (const p of pagesArr) {
    const text = p.text || "";
    const chars = text.match(CHINESE_RE) || [];
    const count = chars.length;
    total += count;
    if (count > max) max = count;
    for (const c of chars) uniqueSet.add(c);
  }

  return {
    total_chars: total,
    unique_chars: uniqueSet.size,
    max_page_chars: max,
  };
}

// ── 3. SQL literal helpers ─────────────────────────────────────
function sqlString(val) {
  if (val === null || val === undefined) return "NULL";
  // Escape single quotes for SQL
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function sqlNumber(val) {
  if (val === null || val === undefined) return "NULL";
  return String(val);
}

function sqlJSON(obj) {
  if (obj === null || obj === undefined) return "NULL";
  // stringify, then escape for SQL string literal
  const str = JSON.stringify(obj);
  return "'" + str.replace(/'/g, "''") + "'";
}

// ── 4. Build INSERT SQL literal ────────────────────────────────
function buildInsertSQL(row) {
  const pagesArr = row.pages_json;
  const stats = deriveStats(pagesArr);
  const ts = (iso) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null);

  const fields = [
    ["id",                  sqlNumber(row.id)],
    ["episode_id",          sqlNumber(row.episode_id)],
    ["target_level",        sqlString(row.target_level)],
    ["pages_json",          sqlJSON(pagesArr)],
    ["frontier_targets_json", sqlJSON(row.frontier_targets || [])],
    ["status",              sqlString(row.status)],
    ["version",             sqlNumber(row.version)],
    ["generation_params_json", sqlJSON(row.generation_params || null)],
    ["validation_result_json", sqlJSON(row.validation_result || null)],
    ["retry_count",         sqlNumber(row.retry_count ?? 0)],
    ["failure_reason",      sqlString(row.failure_reason ?? null)],
    ["child_id",            sqlString(row.child_id ?? null)],
    ["created_at",          sqlNumber(ts(row.created_at))],
    ["finalized_at",        sqlNumber(ts(row.finalized_at))],
    ["finalized_by",        sqlString(row.finalized_by ?? null)],
    ["total_chars",         sqlNumber(stats.total_chars)],
    ["unique_chars",        sqlNumber(stats.unique_chars)],
    ["max_page_chars",      sqlNumber(stats.max_page_chars)],
    ["audit_result_json",   "NULL"],
    ["audit_passed",        "0"],
    ["generator_version",   "NULL"],
  ];

  const cols = fields.map(f => f[0]).join(", ");
  const vals = fields.map(f => f[1]).join(", ");

  return {
    sql: `INSERT INTO book_rewrite_versions (${cols}) VALUES (${vals});`,
    stats,
    fieldCount: fields.length,
  };
}

// ── 5. Execute via wrangler d1 --file ─────────────────────────
function execD1File(sqlFile) {
  const cmd = `npx wrangler d1 execute ${D1_DATABASE} --remote --file '${sqlFile}'`;
  return execSync(cmd, { encoding: "utf-8", env: { ...process.env } });
}

// ── 6. Post-verify row via SELECT ──────────────────────────────
function verifyRow() {
  const cmd = `npx wrangler d1 execute ${D1_DATABASE} --remote --command "SELECT id, status, target_level, version, child_id, episode_id, json_array_length(pages_json) as pages, total_chars, unique_chars, max_page_chars, finalized_by, created_at, finalized_at FROM book_rewrite_versions WHERE id = ${REWRITE_ID}" --json`;
  return execSync(cmd, { encoding: "utf-8" });
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(64));
  console.log("  Legacy PG → D1 book_rewrite_versions  Migration");
  console.log(`  rewrite_id = ${REWRITE_ID}`);
  console.log(`  DRY_RUN    = ${DRY_RUN ? "YES (no write)" : "NO (will INSERT)"}`);
  console.log("=".repeat(64));

  // Step 1: read legacy
  console.log("\n[1/5] Reading Legacy PG rewrite…");
  const legacyRow = await readLegacyRewrite();
  console.log(`  ✓ Found: id=${legacyRow.id}, status=${legacyRow.status}, target_level=${legacyRow.target_level}`);

  // Step 2: build insert SQL literal
  console.log("\n[2/5] Building INSERT SQL…");
  const { sql, stats, fieldCount } = buildInsertSQL(legacyRow);
  console.log(`  ✓ ${fieldCount} fields`);
  console.log(`  ✓ total_chars = ${stats.total_chars}`);
  console.log(`  ✓ unique_chars = ${stats.unique_chars}`);
  console.log(`  ✓ max_page_chars = ${stats.max_page_chars}`);

  // Step 3: write to file + preview
  console.log("\n[3/5] Writing SQL to file…");
  fs.writeFileSync(SQL_OUT, sql + "\n", "utf-8");
  console.log(`  ✓ ${SQL_OUT} (${(fs.statSync(SQL_OUT).size / 1024).toFixed(1)} KB)`);

  if (DRY_RUN) {
    console.log("\n[4/5] DRY-RUN — SQL preview (first 1500 chars):");
    console.log("-" + " SQL ".padEnd(60, "-"));
    const preview = sql.length > 1500 ? sql.slice(0, 1500) + "\n…(truncated, full SQL in file)" : sql;
    console.log(preview);
    console.log("-".repeat(62));

    // Also validate SQL syntax by running with --table or EXPLAIN? No — SQLite EXPLAIN works
    // But we can't EXPLAIN without executing. Let's just verify the file exists.
    console.log("\n[5/5] DRY-RUN complete — no data written.");
    console.log(`  SQL file: ${SQL_OUT}`);
    console.log("\nTo execute for real, run:");
    console.log("  DRY_RUN=0 node scripts/migrate-rewrite24.mjs");
    console.log("");
    return;
  }

  // Step 4: actual insert
  console.log("\n[4/5] Executing INSERT on Production D1…");
  const insertResult = execD1File(SQL_OUT);
  console.log("  ✓ INSERT executed");
  if (insertResult) console.log(insertResult.slice(0, 300));

  // Step 5: verify
  console.log("\n[5/5] Verifying row in D1…");
  const verify = verifyRow();
  console.log(verify.slice(0, 600));
  console.log("\n✓ Migration complete.");
}

main().catch((err) => {
  console.error("\n✗ FAILED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
