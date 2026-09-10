import { NextResponse } from 'next/server';

/**
 * P0-8.4 — Cloudflare D1 Production READ-ONLY Verification Endpoint
 *
 * TEMPORARY endpoint. Created solely to verify that Production Runtime
 * can safely read Cloudflare production environment variables and
 * access the SRC Primary Database in read-only mode.
 *
 * Security:
 * - Requires P0_8_4_VERIFY_KEY header (production-only secret)
 * - GET only
 * - Returns only presence/status, never actual token values
 * - Cloudflare API: only GET (list/get database)
 * - D1: only SELECT on sqlite_master for table names
 * - No INSERT / UPDATE / DELETE / DDL
 * - No connection to PostgreSQL / Supabase
 *
 * To remove after migration is complete.
 */

const VERIFY_KEY = process.env.P0_8_4_VERIFY_KEY;

export async function GET(request: Request) {
  // --- Protection: require verification key ---
  if (!VERIFY_KEY) {
    return NextResponse.json(
      { error: 'Verification key not configured on server.' },
      { status: 503 }
    );
  }

  const providedKey = request.headers.get('x-p0-8-4-verify-key');
  if (!providedKey || providedKey !== VERIFY_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized.' },
      { status: 401 }
    );
  }

  // --- 1. Runtime info ---
  const runtime = process.env.COE_PROJECT_ENV || process.env.NODE_ENV || 'unknown';
  const isProduction = process.env.NODE_ENV === 'production';

  // --- 2. Env var presence (never return values) ---
  const tokenPresent = !!process.env.CLOUDFLARE_API_TOKEN;
  const accountIdPresent = !!process.env.CLOUDFLARE_ACCOUNT_ID;
  const dbIdPresent = !!process.env.CLOUDFLARE_D1_DATABASE_ID;

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || '';

  const allPresent = tokenPresent && accountIdPresent && dbIdPresent;

  // --- 3. Cloudflare API: database details (read-only GET) ---
  let databaseName = null;
  let tableCount = null;
  let tableNames: string[] = [];
  let d1Access = 'NOT TESTED';
  let d1Error = null;
  let d1RowsRead = null;
  let d1RowsWritten = null;

  if (allPresent) {
    try {
      const dbDetailUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}`;
      const dbRes = await fetch(dbDetailUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });
      const dbJson = (await dbRes.json()) as {
        success: boolean;
        errors?: Array<{ message: string }>;
        result?: { name: string; rows_read?: number; rows_written?: number };
      };

      if (!dbJson.success) {
        d1Access = 'FAIL';
        d1Error = dbJson.errors?.[0]?.message || 'Unknown Cloudflare API error';
      } else {
        d1Access = 'PASS';
        databaseName = dbJson.result?.name || null;
        d1RowsRead = dbJson.result?.rows_read ?? null;
        d1RowsWritten = dbJson.result?.rows_written ?? null;
      }
    } catch (e: any) {
      d1Access = 'FAIL';
      d1Error = e.message || 'Network error connecting to Cloudflare';
    }
  }

  // --- 4. D1 query: list tables (read-only SELECT) ---
  if (d1Access === 'PASS') {
    try {
      const queryUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
      const qRes = await fetch(queryUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        // Strictly SELECT — no side effects
        body: JSON.stringify({
          sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
          params: [],
        }),
      });
      const qJson = (await qRes.json()) as {
        success: boolean;
        errors?: Array<{ message: string }>;
        result?: Array<{ results: Array<{ name: string }> }>;
      };

      if (!qJson.success) {
        d1Access = 'FAIL';
        d1Error = qJson.errors?.[0]?.message || 'D1 query failed';
      } else {
        const rows = qJson.result?.[0]?.results || [];
        tableNames = rows.map((r) => r.name).filter(Boolean);
        tableCount = tableNames.length;
      }
    } catch (e: any) {
      d1Access = 'FAIL';
      d1Error = e.message || 'Network error during D1 query';
    }
  }

  // --- Response: NEVER include any secrets ---
  return NextResponse.json({
    runtime,
    is_production: isProduction,
    environment_variables: {
      CLOUDFLARE_API_TOKEN: tokenPresent ? 'PRESENT' : 'MISSING',
      CLOUDFLARE_ACCOUNT_ID: accountIdPresent ? 'PRESENT' : 'MISSING',
      CLOUDFLARE_D1_DATABASE_ID: dbIdPresent ? 'PRESENT' : 'MISSING',
      P0_8_4_VERIFY_KEY: VERIFY_KEY ? 'PRESENT' : 'MISSING',
    },
    d1: {
      access: d1Access,
      database_id: databaseId,
      database_name: databaseName,
      table_count: tableCount,
      table_names: tableNames,
      rows_read: d1RowsRead,
      rows_written: d1RowsWritten,
      error: d1Error,
    },
    operations: {
      write: 0,
      ddl: 0,
    },
  });
}
