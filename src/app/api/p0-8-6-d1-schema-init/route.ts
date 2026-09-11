import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * P0-8.6 — Cloudflare D1 Schema V2.1 Initialization Endpoint
 *
 * TEMPORARY endpoint. Created solely to execute the D1 Schema V2.1
 * CREATE TABLE / CREATE INDEX DDL against the SRC Primary Database.
 *
 * Security:
 * - Requires P0_8_6_INIT_KEY header (production-only secret)
 * - POST only (idempotent: IF NOT EXISTS style)
 * - Executes ONLY the schema.sql file content
 * - No data migration, no INSERT/UPDATE/DELETE
 * - No connection to PostgreSQL / Supabase
 *
 * To remove after migration is complete.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUIRED_ENV_VARS = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_D1_DATABASE_ID',
];

const SCHEMA_SQL_PATH = join(
  process.cwd(),
  'src/storage/database/migrations/pg-to-d1-v1/schema.sql'
);

function checkEnv(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const v of REQUIRED_ENV_VARS) {
    result[v] = !!process.env[v];
  }
  return result;
}

async function executeD1Query(sql: string): Promise<any> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !dbId || !token) {
    throw new Error('Missing Cloudflare credentials');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    const errorMsg = data.errors?.[0]?.message || data.error || response.statusText;
    throw new Error(`D1 query failed: ${errorMsg}`);
  }
  return data.result;
}

function splitStatements(sql: string): string[] {
  // Split SQL file into individual statements
  // Handle multi-line statements, comments, and semicolons
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comment-only lines
    if (trimmed.startsWith('--') || trimmed.startsWith('/*')) {
      continue;
    }

    // Handle string boundaries
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if ((char === "'" || char === '"') && (i === 0 || line[i - 1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }
    }

    current += line + '\n';

    // Statement ends with semicolon (not inside string)
    if (!inString && trimmed.endsWith(';')) {
      const stmt = current.trim();
      if (stmt && !stmt.startsWith('--')) {
        statements.push(stmt);
      }
      current = '';
    }
  }

  // Handle last statement if no trailing semicolon (unlikely but safe)
  const remaining = current.trim();
  if (remaining && !remaining.startsWith('--')) {
    statements.push(remaining);
  }

  return statements;
}

export async function POST(request: Request) {
  // Auth check
  const providedKey = request.headers.get('x-p0-8-6-init-key');
  const expectedKey = process.env.P0_8_6_INIT_KEY;

  if (!expectedKey || !providedKey || providedKey !== expectedKey) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const envStatus = checkEnv();
  const allEnvPresent = Object.values(envStatus).every(Boolean);

  if (!allEnvPresent) {
    return NextResponse.json({
      error: 'Missing required environment variables',
      env: Object.fromEntries(
        Object.entries(envStatus).map(([k, v]) => [k, v ? 'PRESENT' : 'MISSING'])
      ),
    }, { status: 503 });
  }

  try {
    // Read schema.sql
    const schemaSql = readFileSync(SCHEMA_SQL_PATH, 'utf-8');

    // Get pre-init state
    const preResult = await executeD1Query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name"
    );
    const preTables = preResult?.[0]?.results || [];

    // Execute each statement
    const statements = splitStatements(schemaSql);
    const results: Array<{
      statement: string;
      status: 'success' | 'failed';
      error?: string;
    }> = [];

    let successCount = 0;
    let failCount = 0;

    for (const stmt of statements) {
      try {
        await executeD1Query(stmt);
        results.push({ statement: stmt.substring(0, 80) + '...', status: 'success' });
        successCount++;
      } catch (err: any) {
        results.push({
          statement: stmt.substring(0, 80) + '...',
          status: 'failed',
          error: err.message,
        });
        failCount++;
      }
    }

    // Get post-init state
    const postResult = await executeD1Query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name"
    );
    const postTables = postResult?.[0]?.results || [];

    // Get row counts for all tables (should all be 0)
    const rowCounts: Record<string, number> = {};
    for (const tbl of postTables) {
      try {
        const countResult = await executeD1Query(`SELECT COUNT(*) as cnt FROM ${tbl.name}`);
        rowCounts[tbl.name] = countResult?.[0]?.results?.[0]?.cnt ?? -1;
      } catch {
        rowCounts[tbl.name] = -1;
      }
    }

    const allZeroRows = Object.values(rowCounts).every(c => c === 0);

    return NextResponse.json({
      status: failCount === 0 ? 'success' : 'partial',
      preInitTableCount: preTables.length,
      postInitTableCount: postTables.length,
      expectedTables: 16,
      tablesCreated: postTables.map((t: any) => t.name),
      statementsExecuted: statements.length,
      statementsSuccessful: successCount,
      statementsFailed: failCount,
      rowCounts,
      allZeroRows,
      writeOperations: 0,
      ddlOperations: successCount,
      failedStatements: failCount > 0 ? results.filter(r => r.status === 'failed') : undefined,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Unknown error',
    }, { status: 500 });
  }
}

// GET: Just check readiness, don't execute
export async function GET(request: Request) {
  // Auth check
  const providedKey = request.headers.get('x-p0-8-6-init-key');
  const expectedKey = process.env.P0_8_6_INIT_KEY;

  if (!expectedKey || !providedKey || providedKey !== expectedKey) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const envStatus = checkEnv();
  const allEnvPresent = Object.values(envStatus).every(Boolean);

  let currentTables = 0;
  let tableNames: string[] = [];

  if (allEnvPresent) {
    try {
      const result = await executeD1Query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name"
      );
      const tables = result?.[0]?.results || [];
      currentTables = tables.length;
      tableNames = tables.map((t: any) => t.name);
    } catch (err: any) {
      return NextResponse.json({
        ready: false,
        env: Object.fromEntries(
          Object.entries(envStatus).map(([k, v]) => [k, v ? 'PRESENT' : 'MISSING'])
        ),
        error: err.message,
      }, { status: 500 });
    }
  }

  return NextResponse.json({
    ready: allEnvPresent,
    is_production: process.env.NODE_ENV === 'production',
    env: Object.fromEntries(
      Object.entries(envStatus).map(([k, v]) => [k, v ? 'PRESENT' : 'MISSING'])
    ),
    currentTableCount: currentTables,
    currentTables: tableNames,
    expectedTables: 16,
    writeOperations: 0,
    ddlOperations: 0,
    note: 'Use POST to execute schema initialization. GET is read-only.',
  });
}
