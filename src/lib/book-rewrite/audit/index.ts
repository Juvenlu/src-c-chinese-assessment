// ============================================================
// SRC Audit Engine V1 - Public API
// ============================================================

export {
  runAudit,
  pagesFromTexts,
  auditCharacters,
  auditPages,
  buildCandidateUnits,
  longestMatch,
  classifyLevel,
  isCJK,
  AUDIT_ENGINE_VERSION,
  SRC_CHAR_LIBRARY_VERSION,
  SRC_VOCAB_LIBRARY_VERSION,
} from "./audit-engine";

export { isProperNameFragment, getLevelData } from "./level-data";

export type {
  AuditInput,
  AuditResult,
  AuditSummary,
  LengthAudit,
  CharacterAudit,
  LanguageUnitItem,
  LanguageUnitAudit,
  RepetitionAudit,
  PageAuditItem,
  PageAuditResult,
  FrontierAuditItem,
  FrontierAuditResult,
  ChildAuditResult,
  UnitAttribute,
  LevelClass,
  TargetLevel,
} from "./types";

import { runAudit } from "./audit-engine";
import type { AuditResult } from "./types";
import type { RewritePage } from "../types";
import { query as pgQuery } from "@/storage/database/pg-client";

// ------------------------------------------------------------
// Database helpers
// ------------------------------------------------------------

// ------------------------------------------------------------
// Audit by rewrite_id
// ------------------------------------------------------------

/**
 * Load rewrite from database and run audit
 */
export async function auditRewriteById(
  rewriteId: number,
  options?: {
    known_characters?: Set<string>;
    weak_char_signals?: Set<string>;
    known_vocabulary?: Set<string>;
    child_id?: string;
  }
): Promise<AuditResult> {
  const result = await pgQuery(
    `SELECT id, episode_id, target_level, pages_json, frontier_targets, child_id, status
     FROM book_rewrite_versions WHERE id = $1`,
    [rewriteId]
  );

  if (result.length === 0) {
    throw new Error(`Rewrite ${rewriteId} not found`);
  }

  const row = result[0];
  const pages = (row.pages_json as RewritePage[]) || [];
  const frontiers = (row.frontier_targets as string[]) || undefined;

  const auditResult = runAudit({
    pages,
    target_level: row.target_level as AuditResult["target_level"],
    frontiers,
    known_characters: options?.known_characters,
    weak_char_signals: options?.weak_char_signals,
    known_vocabulary: options?.known_vocabulary,
    child_id: options?.child_id ?? row.child_id ?? undefined,
    rewrite_id: rewriteId,
  });

  return auditResult;
}

/**
 * Save audit result to book_rewrite_audits table
 */
export async function saveAuditResult(result: AuditResult): Promise<number> {
  const res = await pgQuery(
    `INSERT INTO book_rewrite_audits
     (rewrite_id, child_id, target_level, audit_engine_version,
      src_char_library_version, src_vocab_library_version, audit_result)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      result.rewrite_id ?? null,
      result.child_id ?? null,
      result.target_level,
      result.engine_version,
      result.src_char_library_version,
      result.src_vocab_library_version,
      JSON.stringify(result),
    ]
  );
  return (res as any).rows[0].id;
}

/**
 * List all audit records for a rewrite
 */
export async function listAuditsByRewriteId(
  rewriteId: number
): Promise<AuditResult[]> {
  const res = await pgQuery(
    `SELECT audit_result FROM book_rewrite_audits
     WHERE rewrite_id = $1 ORDER BY created_at DESC`,
    [rewriteId]
  );
  return (res as any).rows.map((r: { audit_result: unknown }) => r.audit_result as AuditResult);
}
