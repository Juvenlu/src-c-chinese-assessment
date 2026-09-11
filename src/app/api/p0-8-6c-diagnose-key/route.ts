import { NextResponse } from 'next/server';

/**
 * P0-8.6C-2 — Production Environment Variable Read-Only Diagnosis
 *
 * TEMPORARY diagnostic endpoint. Sole purpose is to verify that
 * the P0_8_6_INIT_KEY environment variable is properly injected
 * into the Production Runtime.
 *
 * SAFETY: This endpoint returns ONLY presence and length of the key.
 * It NEVER returns the actual key value, any characters, hashes, or
 * partial contents.
 *
 * To remove after P0-8.6 authentication issue is resolved.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const key = process.env.P0_8_6_INIT_KEY;

  const envPresent = typeof key === 'string' && key.length > 0;
  const envLength = envPresent ? key.length : 0;

  // Also check the Cloudflare vars for completeness
  const cfTokenPresent = !!process.env.CLOUDFLARE_API_TOKEN;
  const cfAccountPresent = !!process.env.CLOUDFLARE_ACCOUNT_ID;
  const cfDbIdPresent = !!process.env.CLOUDFLARE_D1_DATABASE_ID;

  return NextResponse.json({
    // Key diagnosis
    env_present: envPresent,
    env_length: envLength,
    env_typeof: typeof key,

    // Runtime info (no secrets)
    runtime: process.env.NODE_ENV || 'unknown',
    deployment_env: process.env.COE_PROJECT_ENV || process.env.VERCEL_ENV || 'unknown',

    // Other relevant env vars presence
    cloudflare_vars: {
      api_token_present: cfTokenPresent,
      account_id_present: cfAccountPresent,
      database_id_present: cfDbIdPresent,
    },

    // Note
    note: 'Diagnostic only. No secrets exposed. Remove after P0-8.6 auth issue resolved.',
  });
}
