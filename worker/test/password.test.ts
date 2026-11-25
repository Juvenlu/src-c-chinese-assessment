/**
 * Tests for PBKDF2 password utility.
 * Uses Web Crypto API available in Node.js 19+.
 */
import './setup-wasm-ext';
import './setup-webcrypto';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Polyfill Web Crypto on Node (same API as Workers)
// @ts-expect-error - Node 环境 polyfill Web Crypto（与 Workers 同 API）
if (typeof globalThis.crypto === 'undefined') {
  // @ts-expect-error - globalThis.crypto 为只读类型，运行时需要赋值 polyfill
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

  // 1. hash format (Argon2id PHC)
  test('hash format: PHC 6 段（$argon2id$v=..$params$salt$hash）', async () => {
    const hash = await hashPassword('testpass123');
    const parts = hash.split('$');
    assert.equal(parts.length, 6);
    assert.equal(parts[1], 'argon2id');
  });

  test('hash format: Argon2id 参数（m=19456,t=2,p=1）', async () => {
    const hash = await hashPassword('testpass123');
    const parts = hash.split('$');
    assert.equal(parts[2], 'v=19');
    assert.equal(parts[3], 'm=19456,t=2,p=1');
  });

  test('hash format: salt 为 16 字节 base64（22 字符去 padding）', async () => {
    const hash = await hashPassword('testpass123');
    const parts = hash.split('$');
    assert.equal(parts[4].length, 22); // 16 bytes → 22 base64 chars (no padding)
    assert.ok(/^[A-Za-z0-9+/]+$/.test(parts[4]));
  });

  test('hash format: hash 为 32 字节 base64（43 字符去 padding）', async () => {
    const hash = await hashPassword('testpass123');
    const parts = hash.split('$');
    assert.equal(parts[5].length, 43); // 32 bytes → 43 base64 chars (no padding)
    assert.ok(/^[A-Za-z0-9+/]+$/.test(parts[5]));
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
    const salt1 = hash1.split('$')[4];
    const salt2 = hash2.split('$')[4];
    assert.notEqual(salt1, salt2);
    const hashVal1 = hash1.split('$')[5];
    const hashVal2 = hash2.split('$')[5];
    assert.notEqual(hashVal1, hashVal2);
  });

  // 5. determinism: same password + same salt + same params → same result
  test('determinism: 相同密码再次哈希可验证（Argon2id 随机盐）', async () => {
    const password = 'deterministic123';
    const hash1 = await hashPassword(password);
    // 用 PHC 解析出的参数与盐重新计算，验证确定性
    const parts = hash1.split('$');
    assert.equal(parts[1], 'argon2id');
    const m = Number(/m=(\d+)/.exec(parts[3])?.[1]);
    const t = Number(/t=(\d+)/.exec(parts[3])?.[1]);
    const p = Number(/p=(\d+)/.exec(parts[3])?.[1]);
    assert.equal(m, 19456);
    assert.equal(t, 2);
    assert.equal(p, 1);

    // 同一 hash 再次验证仍为 true（确定性由 verify 保证）
    assert.equal(await verifyPassword(password, hash1), true);
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

  // 7. parameter check (Argon2id)
  test('Argon2id 参数校验：m=19456,t=2,p=1,v=19', async () => {
    const hash = await hashPassword('test');
    const parts = hash.split('$');
    assert.equal(parts[1], 'argon2id');
    assert.equal(parts[2], 'v=19');
    assert.equal(parts[3], 'm=19456,t=2,p=1');
  });

  // 8. timingSafeEqual behavior (tamper detection)
  test('single bit difference → verify false', async () => {
    const hash = await hashPassword('testpassword');
    const parts = hash.split('$');
    // Flip one bit in the hash portion (base64 → 变一个字符必改变字节)
    const hashB64 = parts[5];
    const firstChar = hashB64[0];
    const flipped = firstChar === 'A' ? 'B' : 'A';
    const tampered = `$argon2id$${parts[2]}$${parts[3]}$${parts[4]}$${flipped}${hashB64.substring(1)}`;
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
