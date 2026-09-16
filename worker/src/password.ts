/**
 * PBKDF2-SHA256 password hashing utility.
 *
 * Storage format:
 *   pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
 *
 * Parameters:
 *   - Algorithm: PBKDF2 + SHA-256
 *   - Iterations: 200,000
 *   - Salt: 16 random bytes
 *   - Derived key: 32 bytes
 *
 * Uses Node.js crypto.pbkdf2Sync (from node:crypto), which is fully
 * supported in Cloudflare Workers via the nodejs_compat flag.
 * This avoids the PBKDF2 NotSupportedError in Workers Web Crypto.
 * Constant-time comparison via crypto.subtle.timingSafeEqual.
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ALG_IDENTIFIER = 'pbkdf2_sha256';
const ITERATIONS = 200_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const FORMAT_PARTS = 4; // identifier$iterations$salt$hash

/**
 * Hash a password using PBKDF2-SHA256.
 * Returns a string in the format: pbkdf2_sha256$200000$<salt_hex>$<hash_hex>
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = pbkdf2Sync(password, salt, ITERATIONS, HASH_BYTES, 'sha256');

  const saltHex = salt.toString('hex');
  const hashHex = derived.toString('hex');

  return `${ALG_IDENTIFIER}$${ITERATIONS}$${saltHex}$${hashHex}`;
}

/**
 * Verify a password against a stored hash.
 * Returns true if the password matches, false otherwise.
 * Always returns false for malformed/empty hashes (safe failure).
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    if (typeof password !== 'string' || password.length === 0) {
      return false;
    }
    if (typeof storedHash !== 'string' || storedHash.length === 0) {
      return false;
    }

    const parts = storedHash.split('$');
    if (parts.length !== FORMAT_PARTS) {
      return false;
    }

    const [identifier, iterationsStr, saltHex, hashHex] = parts;

    if (identifier !== ALG_IDENTIFIER) {
      return false;
    }

    const iterations = Number(iterationsStr);
    if (!Number.isInteger(iterations) || iterations <= 0) {
      return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const expectedHash = Buffer.from(hashHex, 'hex');

    if (salt.length !== SALT_BYTES || expectedHash.length !== HASH_BYTES) {
      return false;
    }

    const actualHash = pbkdf2Sync(password, salt, iterations, HASH_BYTES, 'sha256');

    if (actualHash.length !== expectedHash.length) {
      return false;
    }

    return timingSafeEqual(actualHash, expectedHash);
  } catch {
    // Any error (invalid hex, crypto failure, etc.) → safe failure
    return false;
  }
}

/**
 * Constant-time buffer comparison using Web Crypto timingSafeEqual.
 * Falls back to a manual constant-time compare if not available.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // Prefer native timingSafeEqual when available
  if (typeof crypto !== 'undefined' && crypto.subtle?.timingSafeEqual) {
    return crypto.subtle.timingSafeEqual(a, b);
  }

  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
