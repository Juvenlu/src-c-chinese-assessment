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
 * Uses Web Crypto API (crypto.subtle.importKey + deriveBits),
 * which is natively supported in Cloudflare Workers.
 * Constant-time comparison via crypto.subtle.timingSafeEqual.
 */

const ALG_IDENTIFIER = 'pbkdf2_sha256';
const ITERATIONS = 200_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const FORMAT_PARTS = 4; // identifier$iterations$salt$hash

/**
 * Internal PBKDF2 derived key computation using Web Crypto.
 * Returns raw derived key bytes.
 */
async function pbkdf2DeriveBytes(
	password: string,
	salt: Uint8Array,
	iterations: number,
	hashBytes: number,
	onSubstep?: (substep: string) => void,
): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const passwordBytes = encoder.encode(password);

	onSubstep?.('pre_import_key');
	const key = await crypto.subtle.importKey(
		"raw",
		passwordBytes,
		{ name: "PBKDF2" },
		false,
		["deriveBits"],
	);
	onSubstep?.('post_import_key');

	onSubstep?.('pre_derive_bits');
	const derivedBuffer = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations,
			hash: "SHA-256",
		},
		key,
		hashBytes * 8, // bits
	);
	onSubstep?.('post_derive_bits');

	return new Uint8Array(derivedBuffer);
}

/**
 * Convert a Uint8Array to a hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Convert a hex string to a Uint8Array.
 * Returns null for invalid input.
 */
function hexToBytes(hex: string): Uint8Array | null {
	if (typeof hex !== 'string' || hex.length % 2 !== 0) {
		return null;
	}
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		if (Number.isNaN(byte)) {
			return null;
		}
		bytes[i] = byte;
	}
	return bytes;
}

/**
 * Hash a password using PBKDF2-SHA256.
 * Returns a string in the format: pbkdf2_sha256$200000$<salt_hex>$<hash_hex>
 *
 * TEMPORARY DIAGNOSTIC (P0-13F-5-AB):
 * Wraps internal calls with sub-step tracking so callers can pinpoint
 * exactly which operation throws.  Remove once Production NotSupportedError
 * root cause is confirmed.
 */
export async function hashPassword(
	password: string,
	onSubstep?: (substep: string) => void,
): Promise<string> {
	if (typeof password !== 'string' || password.length === 0) {
		throw new Error('Password must be a non-empty string');
	}

	onSubstep?.('pre_random_bytes');
	const salt = new Uint8Array(SALT_BYTES);
	crypto.getRandomValues(salt);
	onSubstep?.('post_random_bytes');

	const derived = await pbkdf2DeriveBytes(password, salt, ITERATIONS, HASH_BYTES, onSubstep);

	const saltHex = bytesToHex(salt);
	const hashHex = bytesToHex(derived);

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

		if (!salt || !expectedHash) {
			return false;
		}
		if (salt.length !== SALT_BYTES || expectedHash.length !== HASH_BYTES) {
			return false;
		}

		const actualHash = await pbkdf2DeriveBytes(password, salt, iterations, HASH_BYTES);

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
