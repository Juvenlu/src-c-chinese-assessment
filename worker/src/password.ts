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
 * Uses Web Crypto API (native to Workers Runtime).
 * Constant-time comparison via crypto.subtle.timingSafeEqual.
 */

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

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derivedKey = await deriveKey(password, salt, ITERATIONS);

  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(new Uint8Array(derivedKey));

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

    const salt = hexToBytes(saltHex);
    const expectedHash = hexToBytes(hashHex);

    if (salt.length !== SALT_BYTES || expectedHash.length !== HASH_BYTES) {
      return false;
    }

    const derivedKey = await deriveKey(password, salt, iterations);
    const actualHash = new Uint8Array(derivedKey);

    if (actualHash.length !== expectedHash.length) {
      return false;
    }

    return timingSafeEqual(actualHash, expectedHash);
  } catch {
    // Any error (invalid hex, crypto failure, etc.) → safe failure
    return false;
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: { name: 'SHA-256' },
    },
    passwordKey,
    { name: 'HMAC', hash: 'SHA-256', length: HASH_BYTES * 8 },
    true, // extractable — needed to export raw bytes
    ['sign']
  );

  const raw = await crypto.subtle.exportKey('raw', derivedKey);
  return raw as ArrayBuffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('Invalid hex character');
    }
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * Constant-time comparison of two Uint8Arrays.
 * Uses crypto.subtle.timingSafeEqual if available (Workers Runtime),
 * otherwise falls back to a manual constant-time XOR implementation.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // Try native timingSafeEqual first (available in Workers Runtime)
  const subtle = (crypto as any).subtle;
  if (subtle && typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(a, b);
  }

  // Manual constant-time comparison fallback
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
