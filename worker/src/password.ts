/**
 * Password hashing utility — Argon2id (primary) + legacy PBKDF2-SHA256 verify.
 *
 * Primary (new passwords):
 *   Argon2id
 *   m = 19456 KiB (19 MiB)
 *   t = 2
 *   p = 1
 *   salt = 16 random bytes
 *   output = 32 bytes
 *   version = 19 (0x13)
 *
 * Storage format (PHC / Modular Crypt Format):
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt_b64>$<hash_b64>
 *
 * Legacy verify (read-only):
 *   pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
 *   - iterations must be ≤ 100,000 (Cloudflare Workers Production limit)
 *   - iterations > 100,000 is rejected without attempting compute
 *
 * Uses:
 *   - argon2-wasm-edge (pre-compiled .wasm, setWASMModules)
 *   - Web Crypto PBKDF2 for legacy verify
 *   - crypto.subtle.timingSafeEqual for constant-time comparison
 */

import argon2WasmModule from "argon2-wasm-edge/wasm/argon2.wasm";
import blake2bWasmModule from "argon2-wasm-edge/wasm/blake2b.wasm";
import { argon2id as argon2idHash } from "argon2-wasm-edge";

// ————————————————————————————————————
// Constants — Argon2id (primary)
// ————————————————————————————————————
const ARGON2_TYPE = "argon2id";
const ARGON2_VERSION = 0x13; // 19
const ARGON2_MEMORY_KIB = 19456; // 19 MiB
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_SALT_BYTES = 16;
const ARGON2_HASH_BYTES = 32;

// ————————————————————————————————————
// Constants — PBKDF2 legacy
// ————————————————————————————————————
const PBKDF2_ALG_IDENTIFIER = "pbkdf2_sha256";
const PBKDF2_FORMAT_PARTS = 4;
const PBKDF2_MAX_ITERATIONS = 100000; // Cloudflare Workers Production hard limit
const PBKDF2_MIN_ITERATIONS = 1;

// ————————————————————————————————————
// WASM Initialization (lazy singleton)
// ————————————————————————————————————
let wasmInitPromise: Promise<void> | null = null;
let wasmInitFailed = false;

async function ensureWASM(): Promise<void> {
  if (wasmInitFailed) {
    // Reset after failure so next request can retry
    wasmInitPromise = null;
    wasmInitFailed = false;
  }

  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      try {
        // Dynamic import to avoid top-level side effects in edge cases
        const { setWASMModules } = await import("argon2-wasm-edge");
        await setWASMModules({
          argon2WASM: argon2WasmModule,
          blake2bWASM: blake2bWasmModule,
        });
      } catch (e) {
        wasmInitFailed = true;
        throw e;
      }
    })();
  }

  await wasmInitPromise;
}

// ————————————————————————————————————
// Constant-time comparison
// ————————————————————————————————————

/**
 * Constant-time byte array comparison using Web Crypto timingSafeEqual.
 *
 * If lengths differ, we still perform one valid timingSafeEqual call
 * (comparing a with itself) then return false.
 * This prevents leaking information about the expected hash length
 * through timing differences.
 *
 * Cloudflare Workers officially supports crypto.subtle.timingSafeEqual.
 * Reference: https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/
 */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength === b.byteLength) {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  // Length mismatch: consume time with a valid comparison, then return false.
  crypto.subtle.timingSafeEqual(a, a);
  return false;
}

// ————————————————————————————————————
// Encoding helpers
// ————————————————————————————————————

function hexToBytes(hex: string): Uint8Array | null {
  if (typeof hex !== "string" || hex.length % 2 !== 0) {
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
 * Decode a standard base64 string (used in PHC format) to Uint8Array.
 * Returns null on invalid input.
 */
function base64Decode(str: string): Uint8Array | null {
  try {
    // PHC uses standard base64 without padding sometimes; add padding if needed
    const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Encode Uint8Array to standard base64 string (no padding, PHC style).
 */
function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/=+$/, "");
}

// ————————————————————————————————————
// PBKDF2 (legacy verify only)
// ————————————————————————————————————

async function pbkdf2DeriveBytes(
  password: string,
  salt: Uint8Array,
  iterations: number,
  hashBytes: number,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  const key = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const derivedBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    key,
    hashBytes * 8,
  );

  return new Uint8Array(derivedBuffer);
}

// ————————————————————————————————————
// Argon2id core
// ————————————————————————————————————

interface Argon2Params {
  memorySize: number; // KiB
  iterations: number;
  parallelism: number;
  hashLength: number;
  version: number;
}

const ARGON2_OFFICIAL_PARAMS: Argon2Params = {
  memorySize: ARGON2_MEMORY_KIB,
  iterations: ARGON2_ITERATIONS,
  parallelism: ARGON2_PARALLELISM,
  hashLength: ARGON2_HASH_BYTES,
  version: ARGON2_VERSION,
};

async function computeArgon2idRaw(
  password: string,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  await ensureWASM();

  const result = await argon2idHash({
    password,
    salt,
    hashLength: params.hashLength,
    outputType: "binary",
    memorySize: params.memorySize,
    iterations: params.iterations,
    parallelism: params.parallelism,
    version: params.version,
  });

  if (result instanceof Uint8Array) {
    return result;
  }
  // Should not happen with outputType: "binary"
  throw new Error("Unexpected argon2id output type");
}

// ————————————————————————————————————
// PHC Format Parsing
// ————————————————————————————————————

interface ParsedArgon2Hash {
  algorithm: string;
  version: number;
  memory: number; // KiB
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

/**
 * Parse an Argon2 PHC string.
 * Returns null if the format is invalid.
 * Does NOT validate parameter ranges — call validateArgon2Params for that.
 */
function parseArgon2Hash(hash: string): ParsedArgon2Hash | null {
  if (typeof hash !== "string") return null;

  // Expected format: $argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>
  const parts = hash.split("$");
  // parts[0] = "" (leading $), parts[1] = "argon2id", parts[2] = "v=19",
  // parts[3] = "m=...,t=...,p=...", parts[4] = salt, parts[5] = hash
  if (parts.length !== 6) return null;
  if (parts[0] !== "") return null;
  if (parts[1] !== ARGON2_TYPE) return null;

  // Parse version
  const versionMatch = parts[2].match(/^v=(\d+)$/);
  if (!versionMatch) return null;
  const version = parseInt(versionMatch[1], 10);
  if (!Number.isInteger(version) || version <= 0) return null;

  // Parse params: m=...,t=...,p=...
  const paramStr = parts[3];
  const params: Record<string, string> = {};
  for (const pair of paramStr.split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 0) return null;
    const key = pair.slice(0, eqIdx);
    const value = pair.slice(eqIdx + 1);
    params[key] = value;
  }

  const memory = parseInt(params.m, 10);
  const iterations = parseInt(params.t, 10);
  const parallelism = parseInt(params.p, 10);

  if (!Number.isInteger(memory) || memory <= 0) return null;
  if (!Number.isInteger(iterations) || iterations <= 0) return null;
  if (!Number.isInteger(parallelism) || parallelism <= 0) return null;

  const salt = base64Decode(parts[4]);
  const hashBytes = base64Decode(parts[5]);

  if (!salt || salt.length === 0) return null;
  if (!hashBytes || hashBytes.length === 0) return null;

  return {
    algorithm: parts[1],
    version,
    memory,
    iterations,
    parallelism,
    salt,
    hash: hashBytes,
  };
}

/**
 * Strictly validate that parsed Argon2 params match the ONLY allowed configuration.
 * Prevents database hash tampering from causing DoS via high memory/CPU.
 *
 * In V1, we only accept the exact official params:
 *   version=19, memory=19456, iterations=2, parallelism=1
 */
function isOfficialArgon2Params(parsed: ParsedArgon2Hash): boolean {
  return (
    parsed.version === ARGON2_OFFICIAL_PARAMS.version &&
    parsed.memory === ARGON2_OFFICIAL_PARAMS.memorySize &&
    parsed.iterations === ARGON2_OFFICIAL_PARAMS.iterations &&
    parsed.parallelism === ARGON2_OFFICIAL_PARAMS.parallelism &&
    parsed.hash.length === ARGON2_OFFICIAL_PARAMS.hashLength
  );
}

// ————————————————————————————————————
// PBKDF2 Format Parsing
// ————————————————————————————————————

interface ParsedPbkdf2Hash {
  identifier: string;
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function parsePbkdf2Hash(hash: string): ParsedPbkdf2Hash | null {
  if (typeof hash !== "string") return null;

  const parts = hash.split("$");
  if (parts.length !== PBKDF2_FORMAT_PARTS) return null;

  const [identifier, iterationsStr, saltHex, hashHex] = parts;
  if (identifier !== PBKDF2_ALG_IDENTIFIER) return null;

  const iterations = parseInt(iterationsStr, 10);
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS) {
    return null;
  }

  // Reject iterations > 100k at parse time — never attempt compute
  if (iterations > PBKDF2_MAX_ITERATIONS) {
    return null;
  }

  const salt = hexToBytes(saltHex);
  const hashBytes = hexToBytes(hashHex);

  if (!salt || salt.length === 0) return null;
  if (!hashBytes || hashBytes.length === 0) return null;

  return { identifier, iterations, salt, hash: hashBytes };
}

// ————————————————————————————————————
// Dummy hash (for timing-equality on reject paths)
// ————————————————————————————————————

/**
 * Perform a dummy Argon2id hash to ensure reject paths take similar time
 * to valid verify paths. This prevents attackers from distinguishing:
 *   - empty hash / malformed hash / wrong algorithm
 *   - wrong password
 *   - invalid parameters
 *
 * Uses the official Argon2id params (slowest path) for maximum protection.
 */
async function dummyArgon2Hash(password: string): Promise<void> {
  try {
    const dummySalt = new Uint8Array(ARGON2_SALT_BYTES);
    // All zeros — we don't care about the output, only the computation time
    await computeArgon2idRaw(password, dummySalt, ARGON2_OFFICIAL_PARAMS);
  } catch {
    // Swallow errors — dummy hash must never throw to the caller
  }
}

// ————————————————————————————————————
// Public API: hashPassword
// ————————————————————————————————————

/**
 * Hash a password using Argon2id with the official parameters.
 *
 * Returns a PHC-format string:
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt_b64>$<hash_b64>
 *
 * @param password Plain-text password string
 * @param onSubstep Optional diagnostic callback (kept for backward compat)
 */
export async function hashPassword(
  password: string,
  onSubstep?: (substep: string) => void,
): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }

  onSubstep?.("pre_random_bytes");
  const salt = new Uint8Array(ARGON2_SALT_BYTES);
  crypto.getRandomValues(salt);
  onSubstep?.("post_random_bytes");

  onSubstep?.("pre_wasm_init");
  await ensureWASM();
  onSubstep?.("post_wasm_init");

  onSubstep?.("pre_argon2_hash");
  const hashBytes = await computeArgon2idRaw(password, salt, ARGON2_OFFICIAL_PARAMS);
  onSubstep?.("post_argon2_hash");

  const saltB64 = base64Encode(salt);
  const hashB64 = base64Encode(hashBytes);

  return `$${ARGON2_TYPE}$v=${ARGON2_VERSION}$m=${ARGON2_MEMORY_KIB},t=${ARGON2_ITERATIONS},p=${ARGON2_PARALLELISM}$${saltB64}$${hashB64}`;
}

// ————————————————————————————————————
// Public API: verifyPassword
// ————————————————————————————————————

/**
 * Verify a password against a stored hash.
 *
 * Supports:
 *   - $argon2id$...  → Argon2id (only official params accepted)
 *   - pbkdf2_sha256$... → Legacy PBKDF2 (iterations ≤ 100k)
 *
 * Always returns false for:
 *   - empty / null hash
 *   - malformed hash
 *   - unsupported algorithm / version
 *   - out-of-range parameters (rejected without computation)
 *
 * Uses crypto.subtle.timingSafeEqual for constant-time byte comparison.
 * All reject paths perform a dummy Argon2id hash to minimize timing leaks.
 */
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  // ——— Guard: password must be a non-empty string ———
  if (typeof password !== "string" || password.length === 0) {
    await dummyArgon2Hash("dummy");
    return false;
  }

  // ——— Guard: storedHash must be a non-empty string ———
  if (!storedHash || typeof storedHash !== "string" || storedHash.length === 0) {
    await dummyArgon2Hash(password);
    return false;
  }

  try {
    // ——— Determine algorithm ———
    if (storedHash.startsWith("$argon2id$")) {
      const parsed = parseArgon2Hash(storedHash);
      if (!parsed) {
        await dummyArgon2Hash(password);
        return false;
      }

      // Strict: only accept the exact official params
      // (Prevent DoS via database hash tampering with high m/t)
      if (!isOfficialArgon2Params(parsed)) {
        await dummyArgon2Hash(password);
        return false;
      }

      const computed = await computeArgon2idRaw(password, parsed.salt, {
        memorySize: parsed.memory,
        iterations: parsed.iterations,
        parallelism: parsed.parallelism,
        hashLength: parsed.hash.length,
        version: parsed.version,
      });

      return timingSafeEqualBytes(computed, parsed.hash);
    }

    if (storedHash.startsWith(PBKDF2_ALG_IDENTIFIER + "$")) {
      const parsed = parsePbkdf2Hash(storedHash);
      // parsePbkdf2Hash already rejects iterations > 100k
      if (!parsed) {
        await dummyArgon2Hash(password);
        return false;
      }

      const computed = await pbkdf2DeriveBytes(
        password,
        parsed.salt,
        parsed.iterations,
        parsed.hash.length,
      );

      return timingSafeEqualBytes(computed, parsed.hash);
    }

    // Unknown algorithm
    await dummyArgon2Hash(password);
    return false;
  } catch {
    // Any unexpected error → safe failure
    return false;
  }
}
