/**
 * PBKDF2 Production Runtime Diagnostic — 独立最小模块
 *
 * 用途：只读测试 Cloudflare Workers Production 中
 * crypto.subtle.deriveBits() 对不同 iterations 的 PBKDF2 表现。
 *
 * 严格约束：
 * - 不修改 D1
 * - 不修改正式 password.ts
 * - 不修改 Signup / Login / Session
 * - 不处理真实用户数据
 * - 仅使用固定测试字符串 "test-password"
 *
 * 通过 X-SRC-Service-Key 鉴权访问。
 */

export interface Pbkdf2DiagResult {
  iterations: number;
  getRandomValues: "PASS" | "FAIL";
  importKey: "PASS" | "FAIL";
  deriveBits: "PASS" | "FAIL";
  result: "PASS" | "FAIL";
  substep?: string;
  errorName?: string;
  errorMessage?: string;
  elapsedMs: number;
  hashLen?: number;
  hashHexPrefix?: string;
}

export async function runPbkdf2Diagnostic(
  iterations: number,
): Promise<Pbkdf2DiagResult> {
  const start = Date.now();
  const result: Pbkdf2DiagResult = {
    iterations,
    getRandomValues: "FAIL",
    importKey: "FAIL",
    deriveBits: "FAIL",
    result: "FAIL",
    elapsedMs: 0,
  };

  try {
    // Step 1: getRandomValues
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    result.getRandomValues = "PASS";

    // Step 2: importKey
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode("test-password");

    result.substep = "pre_import_key";
    const key = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );
    result.importKey = "PASS";
    result.substep = "post_import_key";

    // Step 3: deriveBits
    result.substep = "pre_derive_bits";
    const derivedBuffer = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      key,
      256, // bits
    );
    result.deriveBits = "PASS";
    result.substep = "post_derive_bits";
    result.result = "PASS";

    const derived = new Uint8Array(derivedBuffer);
    result.hashLen = derived.length;
    result.hashHexPrefix = Array.from(derived.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (e: any) {
    result.errorName = e?.name || "Unknown";
    result.errorMessage = e?.message || "Unknown error";
  }

  result.elapsedMs = Date.now() - start;
  return result;
}
