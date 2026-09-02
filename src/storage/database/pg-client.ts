import { Pool } from 'pg'

/**
 * 直接 pg 连接池，用于绕过 Supabase PostgREST schema cache 限制
 * 操作 book_rewrite_versions 等新增表时使用
 */
let pool: Pool | null = null

export function getPgPool(): Pool {
  if (!pool) {
    const url = process.env.PGDATABASE_URL
    if (!url) {
      throw new Error('Missing PGDATABASE_URL')
    }
    pool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  }
  return pool
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const client = await getPgPool().connect()
  try {
    const res = await client.query(sql, params)
    return res.rows as T[]
  } finally {
    client.release()
  }
}
