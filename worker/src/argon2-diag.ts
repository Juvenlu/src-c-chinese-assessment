// ============================================================================
// 仅用于 Production 诊断实验
// 与正式 password.ts 完全隔离
// 用途：测试 Cloudflare Workers Production 中 Argon2id (WASM) 的可行性
// ============================================================================

import { argon2id, argon2Verify } from "hash-wasm";

export interface Argon2DiagnosticResult {
  algorithm: "argon2id";
  memoryKiB: number; // memory cost in KiB
  timeCost: number; // iterations
  parallelism: number;
  outputBytes: number;
  success: boolean;
  elapsedMs: number;
  errorName?: string;
  errorMessage?: string;
  hashLength?: number;
  hashPrefix?: string; // 只显示前 12 个字符，不记录完整 hash
  saltLength?: number;
}

// OWASP 推荐最低配置：19 MiB, 2 iterations, 1 parallelism
const OWASP_MIN = {
  memoryKiB: 19456, // 19 MiB = 19456 KiB
  timeCost: 2,
  parallelism: 1,
  outputBytes: 32,
};

// 低参数配置（用于定位失败原因）
const LOW_PARAMS = {
  memoryKiB: 1024, // 1 MiB
  timeCost: 1,
  parallelism: 1,
  outputBytes: 32,
};

function generateSalt(length: number): Uint8Array {
  const salt = new Uint8Array(length);
  crypto.getRandomValues(salt);
  return salt;
}

export async function runArgon2Diagnostic(
  params: {
    memoryKiB?: number;
    timeCost?: number;
    parallelism?: number;
    outputBytes?: number;
  } = {}
): Promise<Argon2DiagnosticResult> {
  const memoryKiB = params.memoryKiB ?? OWASP_MIN.memoryKiB;
  const timeCost = params.timeCost ?? OWASP_MIN.timeCost;
  const parallelism = params.parallelism ?? OWASP_MIN.parallelism;
  const outputBytes = params.outputBytes ?? OWASP_MIN.outputBytes;

  const testPassword = "test-password-for-diagnostic-only";
  const salt = generateSalt(16);

  const startTime = Date.now();

  try {
    const hash = await argon2id({
      password: testPassword,
      salt,
      parallelism,
      iterations: timeCost,
      memorySize: memoryKiB, // KiB
      hashLength: outputBytes,
      outputType: "hex",
    });

    const elapsedMs = Date.now() - startTime;

    return {
      algorithm: "argon2id",
      memoryKiB,
      timeCost,
      parallelism,
      outputBytes,
      success: true,
      elapsedMs,
      hashLength: hash.length, // hex string length
      hashPrefix: hash.slice(0, 12),
      saltLength: salt.length,
    };
  } catch (e: any) {
    const elapsedMs = Date.now() - startTime;
    return {
      algorithm: "argon2id",
      memoryKiB,
      timeCost,
      parallelism,
      outputBytes,
      success: false,
      elapsedMs,
      errorName: e?.name || "Unknown",
      errorMessage: e?.message || "Unknown error",
    };
  }
}

export async function runArgon2BatchDiagnostic(): Promise<{
  owaspMin: Argon2DiagnosticResult;
  lowParams: Argon2DiagnosticResult;
}> {
  const owaspMin = await runArgon2Diagnostic(OWASP_MIN);

  // 如果 OWASP 参数失败，用低参数再测一次
  let lowParams: Argon2DiagnosticResult;
  if (!owaspMin.success) {
    lowParams = await runArgon2Diagnostic(LOW_PARAMS);
  } else {
    lowParams = { ...owaspMin, success: false, errorName: "Skipped", errorMessage: "OWASP params succeeded, low params test not needed" };
  }

  return { owaspMin, lowParams };
}

// 验证功能（确保 hash-wasm 的 verify 也能跑）
export async function runArgon2VerifyDiagnostic(): Promise<{
  hashSuccess: boolean;
  verifySuccess: boolean;
  match: boolean;
  elapsedMs: number;
  errorName?: string;
  errorMessage?: string;
}> {
  const startTime = Date.now();
  try {
    const password = "verify-test-password";
    const salt = generateSalt(16);

    const hash = await argon2id({
      password,
      salt,
      parallelism: 1,
      iterations: 1,
      memorySize: 2048,
      hashLength: 32,
      outputType: "encoded",
    });

    const hashSuccess = true;

    const match = await argon2Verify({ password, hash });

    const elapsedMs = Date.now() - startTime;
    return {
      hashSuccess,
      verifySuccess: true,
      match,
      elapsedMs,
    };
  } catch (e: any) {
    const elapsedMs = Date.now() - startTime;
    return {
      hashSuccess: false,
      verifySuccess: false,
      match: false,
      elapsedMs,
      errorName: e?.name || "Unknown",
      errorMessage: e?.message || "Unknown error",
    };
  }
}
