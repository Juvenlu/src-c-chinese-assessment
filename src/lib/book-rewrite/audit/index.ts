/**
 * Audit Engine 公共入口
 *
 * 主要导出：
 * - runAudit:          执行完整审计
 * - auditRewriteById:  对指定 rewrite_id 执行审计（可选持久化）
 * - saveAuditResult:   将审计结果写入数据库
 */

export {
  runAudit,
  pagesFromTexts,
  AUDIT_ENGINE_VERSION,
  SRC_CHAR_LIBRARY_VERSION,
  SRC_VOCAB_LIBRARY_VERSION,
  auditCharacters,
  auditPages,
  buildCandidateUnits,
  longestMatch,
  classifyLevel,
  countExternalChars,
  inferAttributes,
  isCJK,
} from './audit-engine';

export type {
  AuditInput,
  AuditResult,
  CharacterAuditResult,
  LanguageUnitAuditResult,
  RepetitionAuditResult,
  PageAuditResult,
  FrontierAuditResult,
  ChildAuditResult,
  AuditSummary,
  UnitInfo,
  TargetLevel,
  Level,
  LUAttribute,
} from './types';

import { getRewriteById } from '../rewrite-store';
import { runAudit, AUDIT_ENGINE_VERSION, SRC_CHAR_LIBRARY_VERSION, SRC_VOCAB_LIBRARY_VERSION } from './audit-engine';
import type { AuditInput, AuditResult, TargetLevel } from './types';

import { query } from '../../../storage/database/pg-client';

/**
 * 对指定 rewrite_id 执行 Audit。
 *
 * 自动从数据库读取 pages_json、target_level、frontier_targets 等。
 */
export async function auditRewriteById(
  rewriteId: number,
  options: {
    persist?: boolean;
    knownCharacters?: Set<string>;
    knownWords?: Set<string>;
    childId?: string;
  } = {},
): Promise<AuditResult> {
  const rewrite = await getRewriteById(rewriteId);
  if (!rewrite) {
    throw new Error(`Rewrite #${rewriteId} not found`);
  }

  const pages = rewrite.pages_json;
  const targetLevel = (rewrite.target_level as TargetLevel) ?? 'SRC300';
  const frontiers = rewrite.frontier_targets ?? undefined;

  const input: AuditInput = {
    pages,
    targetLevel,
    frontiers,
    knownCharacters: options.knownCharacters,
    knownWords: options.knownWords,
    childId: options.childId,
  };

  const result = runAudit(input);

  if (options.persist) {
    await saveAuditResult(rewriteId, result);
  }

  return result;
}

/**
 * 将审计结果保存到 book_rewrite_audits 表。
 */
export async function saveAuditResult(
  rewriteId: number,
  result: AuditResult,
): Promise<number> {
  const client = await getPgClient();
  try {
    const res = await client.query(
      `
      INSERT INTO book_rewrite_audits
        (rewrite_id, child_id, target_level, audit_engine_version,
         src_char_library_version, src_vocab_library_version, audit_result)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING id
      `,
      [
        rewriteId,
        result.child_id,
        result.target_level,
        result.engine_version,
        result.src_char_library_version,
        result.src_vocab_library_version,
        JSON.stringify(result),
      ],
    );
    return res.rows[0].id;
  } finally {
    client.release();
  }
}

/**
 * 查询某个 rewrite 的所有审计记录。
 */
export async function listAuditsByRewriteId(rewriteId: number) {
  const client = await getPgClient();
  try {
    const res = await client.query(
      `
      SELECT id, rewrite_id, child_id, target_level,
             audit_engine_version, src_char_library_version,
             src_vocab_library_version, audit_result, created_at
      FROM book_rewrite_audits
      WHERE rewrite_id = $1
      ORDER BY created_at DESC
      `,
      [rewriteId],
    );
    return res.rows;
  } finally {
    client.release();
  }
}


