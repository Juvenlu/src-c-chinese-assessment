/**
 * Tests for PBKDF2 password utility.
 * Uses Web Crypto API available in Node.js 19+.
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Polyfill Web Crypto on Node (same API as Workers)
// @ts-ignore
if (typeof globalThis.crypto === 'undefined') {
  // @ts-ignore
  globalThis.crypto = webcrypto;
}

import { hashPassword, verifyPassword } from '../src/password.js';

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void | Promise<void>) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passCount++;
    })
    .catch((err) => {
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
      failCount++;
    });
}

async function runAll() {
  console.log('\nPassword Utility Tests\n');

  // 1. hash format
  test('hash format: 4 parts separated by $', async () => {
    const hash = await hashPassword('testpass123');
    const parts = hash.split('$');
    assert.equal(parts.length, 4);
    assert.equal(parts[0], 'pbkdf2_sha256');
  });

  test('hash format: iterations = 200000', async () => {
    const hash = await hashPassword('testpass123');
    const parts = hash.split('$');
    assert.equal(parts[1], '200000');
  });

  test('hash format: salt is 16 bytes (32 hex chars)', async () => {
    const hash = await hashPassword('testpass123');
    const parts = hash.split('$');
    assert.equal(parts[2].length, 32); // 16 bytes = 32 hex
    assert.ok(/^[0-9a-f]+$/.test(parts[2]));
  });

  test('hash format: key is 32 bytes (64 hex chars)', async () => {
    const hash = await hashPassword('testpass123');
    const parts = hash.split('$');
    assert.equal(parts[3].length, 64); // 32 bytes = 64 hex
    assert.ok(/^[0-9a-f]+$/.test(parts[3]));
  });

  // 2. same password verifies
  test('same password verifies true', async () => {
    const password = 'mySecurePassword!2024';
    const hash = await hashPassword(password);
    const result = await verifyPassword(password, hash);
    assert.equal(result, true);
  });

  test('same password with unicode characters', async () => {
    const password = '中文密码测试 🔑';
    const hash = await hashPassword(password);
    const result = await verifyPassword(password, hash);
    assert.equal(result, true);
  });

  // 3. wrong password fails
  test('wrong password verifies false', async () => {
    const hash = await hashPassword('correctPassword');
    const result = await verifyPassword('wrongPassword', hash);
    assert.equal(result, false);
  });

  test('empty string password fails', async () => {
    const hash = await hashPassword('something');
    const result = await verifyPassword('', hash);
    assert.equal(result, false);
  });

  // 4. different salt → different hash
  test('different calls produce different hashes (random salt)', async () => {
    const password = 'samePassword123';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    assert.notEqual(hash1, hash2);
    // Both should still verify
    assert.equal(await verifyPassword(password, hash1), true);
    assert.equal(await verifyPassword(password, hash2), true);
  });

  test('different salt → different hash value', async () => {
    const password = 'test1234';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    const salt1 = hash1.split('$')[2];
    const salt2 = hash2.split('$')[2];
    assert.notEqual(salt1, salt2);
    const hashVal1 = hash1.split('$')[3];
    const hashVal2 = hash2.split('$')[3];
    assert.notEqual(hashVal1, hashVal2);
  });

  // 5. determinism: same password + same salt + same params → same result
  test('determinism: manual rebuild with same salt gives same hash', async () => {
    const password = 'deterministic123';
    const hash1 = await hashPassword(password);
    const [, iters, saltHex] = hash1.split('$');

    // Manually derive with same parameters to verify determinism
    const encoder = new TextEncoder();
    const salt = new Uint8Array(saltHex.length / 2);
    for (let i = 0; i < salt.length; i++) {
      salt[i] = parseInt(saltHex.substring(i * 2, i * 2 + 2), 16);
    }

    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: Number(iters), hash: 'SHA-256' },
      key, 256
    );
    const hashVal2 = Array.from(new Uint8Array(derived))
      .map((b) => b.toString(16).padStart(2, '0')).join('');

    assert.equal(hash1.split('$')[3], hashVal2);
  });

  // 6. malformed/illegal hash → safe failure
  test('empty stored hash → false', async () => {
    const result = await verifyPassword('test', '');
    assert.equal(result, false);
  });

  test('malformed hash (no $) → false', async () => {
    const result = await verifyPassword('test', 'notahashatall');
    assert.equal(result, false);
  });

  test('malformed hash (wrong identifier) → false', async () => {
    const result = await verifyPassword('test', 'bcrypt$...$...$...');
    assert.equal(result, false);
  });

  test('malformed hash (too few parts) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2_sha256$200000$abc123');
    assert.equal(result, false);
  });

  test('malformed hash (too many parts) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2_sha256$200000$a$b$c');
    assert.equal(result, false);
  });

  test('malformed hash (invalid iterations) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2_sha256$abc$aabb$ccdd');
    assert.equal(result, false);
  });

  test('malformed hash (zero iterations) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2_sha256$0$aabb$ccdd');
    assert.equal(result, false);
  });

  test('malformed hash (negative iterations) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2_sha256$-1$aabb$ccdd');
    assert.equal(result, false);
  });

  test('malformed hash (invalid hex salt) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2_sha256$200000$zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz$1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    assert.equal(result, false);
  });

  test('malformed hash (wrong salt length) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2_sha256$200000$aabbccdd$1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    assert.equal(result, false);
  });

  test('malformed hash (wrong hash length) → false', async () => {
    const result = await verifyPassword('test', 'pbkdf2_sha256$200000$00112233445566778899aabbccddeeff$aabbccdd');
    assert.equal(result, false);
  });

  test('null/undefined stored hash → false', async () => {
    const r1 = await verifyPassword('test', null as unknown as string);
    const r2 = await verifyPassword('test', undefined as unknown as string);
    assert.equal(r1, false);
    assert.equal(r2, false);
  });

  test('empty password + valid hash → false', async () => {
    const hash = await hashPassword('test123');
    const result = await verifyPassword('', hash);
    assert.equal(result, false);
  });

  // 7. iteration count check
  test('iteration count = 200000', async () => {
    const hash = await hashPassword('test');
    const parts = hash.split('$');
    assert.equal(Number(parts[1]), 200_000);
  });

  // 8. timingSafeEqual behavior (tamper detection)
  test('single bit difference → verify false', async () => {
    const hash = await hashPassword('testpassword');
    const parts = hash.split('$');
    // Flip one bit in the hash portion
    const hashHex = parts[3];
    const firstChar = hashHex[0];
    const flipped = firstChar === '0' ? '1' : '0';
    const tampered = `pbkdf2_sha256$${parts[1]}$${parts[2]}$${flipped}${hashHex.substring(1)}`;
    const result = await verifyPassword('testpassword', tampered);
    assert.equal(result, false);
  });

  // Wait for all async tests
  setTimeout(() => {
    console.log(`\n${passCount} passed, ${failCount} failed`);
    if (failCount > 0) {
      process.exit(1);
    }
  }, 100);
}

runAll().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
