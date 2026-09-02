import { query } from '@/storage/database/pg-client'
import type { RewriteStatus, RewritePage, BookRewriteVersion } from './types'

const TABLE = 'book_rewrite_versions'

interface RewriteRecord {
  id: number
  episode_id: number
  target_level: string
  pages_json: any
  frontier_targets: string[] | null
  status: string
  generation_params: any
  validation_result: any
  version: number
  retry_count: number
  failure_reason: string | null
  child_id: string | null
  created_at: Date
  finalized_at: Date | null
  finalized_by: string | null
}

function mapRecord(r: RewriteRecord): BookRewriteVersion {
  return {
    id: r.id,
    episode_id: r.episode_id,
    target_level: r.target_level as any,
    pages_json: r.pages_json as RewritePage[],
    frontier_targets: r.frontier_targets || [],
    status: r.status as RewriteStatus,
    generation_params: r.generation_params,
    validation_result: r.validation_result,
    version: r.version,
    retry_count: r.retry_count,
    failure_reason: r.failure_reason,
    child_id: r.child_id,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
    finalized_at: r.finalized_at ? new Date(r.finalized_at).toISOString() : null,
    finalized_by: r.finalized_by,
  } as BookRewriteVersion
}

export async function insertRewrite(params: {
  episodeId: string | number
  targetLevel: string
  pages: RewritePage[]
  frontierTargets: string[]
  generationParams?: any
  validationResult?: any
  status?: RewriteStatus
  childId?: string
  failureReason?: string
}): Promise<BookRewriteVersion> {
  const rows = await query<RewriteRecord>(
    `INSERT INTO ${TABLE} (episode_id, target_level, pages_json, frontier_targets, generation_params, validation_result, status, child_id, failure_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      String(params.episodeId),
      params.targetLevel,
      JSON.stringify(params.pages),
      params.frontierTargets,
      params.generationParams ? JSON.stringify(params.generationParams) : null,
      params.validationResult ? JSON.stringify(params.validationResult) : null,
      params.status || 'ai_draft',
      params.childId || null,
      params.failureReason || null,
    ]
  )
  return mapRecord(rows[0])
}

export async function getRewriteById(id: string | number): Promise<BookRewriteVersion | null> {
  const rows = await query<RewriteRecord>(
    `SELECT * FROM ${TABLE} WHERE id = $1`,
    [Number(id)]
  )
  return rows.length ? mapRecord(rows[0]) : null
}

export async function listRewritesByEpisode(episodeId: string | number): Promise<BookRewriteVersion[]> {
  const rows = await query<RewriteRecord>(
    `SELECT * FROM ${TABLE} WHERE episode_id = $1 ORDER BY created_at DESC`,
    [String(episodeId)]
  )
  return rows.map(mapRecord)
}

export async function listFinalRewritesByEpisode(episodeId: string | number): Promise<BookRewriteVersion[]> {
  const rows = await query<RewriteRecord>(
    `SELECT * FROM ${TABLE} WHERE episode_id = $1 AND status = 'final' ORDER BY created_at DESC`,
    [String(episodeId)]
  )
  return rows.map(mapRecord)
}

export async function updateRewriteStatus(
  id: string | number,
  status: RewriteStatus,
  options?: { pages?: RewritePage[]; finalizedBy?: string }
): Promise<BookRewriteVersion | null> {
  let sql = `UPDATE ${TABLE} SET status = $1`
  const params: any[] = [status]

  if (options?.pages) {
    params.push(JSON.stringify(options.pages))
    sql += `, pages_json = $${params.length}`
  }

  if (status === 'final') {
    sql += `, finalized_at = NOW()`
    if (options?.finalizedBy) {
      params.push(options.finalizedBy)
      sql += `, finalized_by = $${params.length}`
    }
  }

  params.push(Number(id))
  sql += ` WHERE id = $${params.length} RETURNING *`

  const rows = await query<RewriteRecord>(sql, params)
  return rows.length ? mapRecord(rows[0]) : null
}
