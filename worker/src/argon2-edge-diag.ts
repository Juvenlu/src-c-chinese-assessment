// ============================================================================
// 仅用于 Production 诊断实验
// 与正式 password.ts 完全隔离
// 用途：测试 argon2-wasm-edge 在 Cloudflare Workers Production 的可行性
// 实现：argon2-wasm-edge (hash-wasm-edge) + 静态 .wasm import
// ============================================================================

// @ts-ignore - .wasm module import (CF Workers ES Module style)
import argon2Wasm from "argon2-wasm-edge/wasm/argon2.wasm";
// @ts-ignore - .wasm module import
import blake2bWasm from "argon2-wasm-edge/wasm/blake2b.wasm";

import {
  argon2id,
  argon2Verify,
  setWASMModules,
} from "argon2-wasm-edge";

// OWASP 推荐最低配置：19 MiB, 2 iterations, 1 parallelism
const OWASP_MIN = {
  memorySize: 19456, // 19 MiB = 19456 KiB
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
};

// 低参数配置（用于定位失败原因）
const LOW_PARAMS = {
  memorySize: 1024, // 1 MiB
  iterations: 1,
  parallelism: 1,
  hashLength: 32,
};

let wasmInitialized = false;
let initError: string | null = null;

async function ensureWasm(): Promise<void> {
  if (wasmInitialized) return;
  if (initError) throw new Error(initError);

  try {
    await setWASMModules({
      argon2WASM: argon2Wasm,
      blake2bWASM: blake2bWasm,
    });
    wasmInitialized = true;
  } catch (e: any) {
    initError = e?.message || "Unknown WASM init error";
    throw e;
  }
}

export interface Argon2EdgeDiagnosticResult {
  algorithm: "argon2id";
  library: "argon2-wasm-edge";
  wasmSource: "static-import-npm";
  memorySizeKiB: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
  wasmInit: boolean;
  hashSuccess: boolean;
  verifySuccess: boolean;
  match: boolean;
  totalElapsedMs: number;
  hashElapsedMs?: number;
  verifyElapsedMs?: number;
  initElapsedMs?: number;
  errorName?: string;
  errorMessage?: string;
  hashPrefix?: string;
}

const TEST_PASSWORD = "test-password-for-diagnostic-only";

export async function runArgon2EdgeDiagnostic(params: {
  memorySize?: number;
  iterations?: number;
  parallelism?: number;
  hashLength?: number;
} = {}): Promise<Argon2EdgeDiagnosticResult> {
  const memorySize = params.memorySize ?? OWASP_MIN.memorySize;
  const iterations = params.iterations ?? OWASP_MIN.iterations;
  const parallelism = params.parallelism ?? OWASP_MIN.parallelism;
  const hashLength = params.hashLength ?? OWASP_MIN.hashLength;

  const totalStart = Date.now();
  let initElapsedMs: number | undefined;
  let hashElapsedMs: number | undefined;
  let verifyElapsedMs: number | undefined;

  try {
    const initStart = Date.now();
    await ensureWasm();
    initElapsedMs = Date.now() - initStart;

    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);

    // Hash
    const hashStart = Date.now();
    const hash = await argon2id({
      password: TEST_PASSWORD,
      salt,
      iterations,
      parallelism,
      memorySize,
      hashLength,
      outputType: "encoded",
    });
    hashElapsedMs = Date.now() - hashStart;

    const hashPrefix = typeof hash === "string" ? hash.slice(0, 40) : "";

    // Verify
    const verifyStart = Date.now();
    const match = await argon2Verify({
      password: TEST_PASSWORD,
      hash: typeof hash === "string" ? hash : "",
    });
    verifyElapsedMs = Date.now() - verifyStart;

    const totalElapsedMs = Date.now() - totalStart;

    return {
      algorithm: "argon2id",
      library: "argon2-wasm-edge",
      wasmSource: "static-import-npm",
      memorySizeKiB: memorySize,
      iterations,
      parallelism,
      hashLength,
      wasmInit: true,
      hashSuccess: true,
      verifySuccess: true,
      match,
      totalElapsedMs,
      initElapsedMs,
      hashElapsedMs,
      verifyElapsedMs,
      hashPrefix,
    };
  } catch (e: any) {
    const totalElapsedMs = Date.now() - totalStart;
    return {
      algorithm: "argon2id",
      library: "argon2-wasm-edge",
      wasmSource: "static-import-npm",
      memorySizeKiB: memorySize,
      iterations,
      parallelism,
      hashLength,
      wasmInit: wasmInitialized,
      hashSuccess: false,
      verifySuccess: false,
      match: false,
      totalElapsedMs,
      initElapsedMs,
      hashElapsedMs,
      verifyElapsedMs,
      errorName: e?.name || "Unknown",
      errorMessage: e?.message || "Unknown error",
    };
  }
}

export async function runArgon2EdgeBatchDiagnostic(): Promise<{
  owaspMin: Argon2EdgeDiagnosticResult;
  lowParams: Argon2EdgeDiagnosticResult;
}> {
  const owaspMin = await runArgon2EdgeDiagnostic(OWASP_MIN);

  let lowParams: Argon2EdgeDiagnosticResult;
  if (!owaspMin.hashSuccess) {
    lowParams = await runArgon2EdgeDiagnostic(LOW_PARAMS);
  } else {
    lowParams = {
      ...owaspMin,
      memorySizeKiB: LOW_PARAMS.memorySize,
      iterations: LOW_PARAMS.iterations,
      hashSuccess: false,
      verifySuccess: false,
      match: false,
      errorName: "Skipped",
      errorMessage: "OWASP params succeeded, low params test not needed",
    };
  }

  return { owaspMin, lowParams };
}
