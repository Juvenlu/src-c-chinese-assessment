// ============================================================================
// 仅用于 Production 诊断实验
// 与正式 password.ts 完全隔离
// 用途：测试 Cloudflare Workers Production 中
//       预编译 .wasm + WebAssembly.instantiate 的 Argon2id 可行性
// 方案：argon2-browser .wasm (Emscripten) + ES Module 直接导入
// ============================================================================

// ES Module Worker: 直接 import .wasm 文件
// Wrangler 会将其作为 WebAssembly.Module 打包
// @ts-ignore - .wasm module import
import argon2WasmModule from "./wasm/argon2.wasm";

// Argon2 常量 (argon2.h)
const Argon2Type = {
  Argon2d: 0,
  Argon2i: 1,
  Argon2id: 2,
} as const;

const Argon2Version = {
  ARGON2_VERSION_10: 0x10,
  ARGON2_VERSION_13: 0x13,
} as const;

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

export interface Argon2WasmDiagnosticResult {
  algorithm: "argon2id";
  wasmSource: "precompiled-wasm-modules";
  memoryKiB: number;
  timeCost: number;
  parallelism: number;
  outputBytes: number;
  success: boolean;
  elapsedMs: number;
  errorName?: string;
  errorMessage?: string;
  hashLength?: number;
  hashPrefix?: string; // 只显示前 12 个字符
  saltLength?: number;
  initElapsedMs?: number;
}

interface Argon2WasmExports {
  memory: WebAssembly.Memory;
  _argon2_hash: (
    t_cost: number,
    m_cost: number,
    parallelism: number,
    pwd: number,
    pwdlen: number,
    salt: number,
    saltlen: number,
    hash: number,
    hashlen: number,
    encoded: number,
    encodedlen: number,
    type: number,
    version: number,
  ) => number;
  _argon2_error_message: (error_code: number) => number;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  _argon2_encodedlen: (
    t_cost: number,
    m_cost: number,
    parallelism: number,
    type: number,
  ) => number;
}

let wasmInstance: Argon2WasmExports | null = null;
let initPromise: Promise<void> | null = null;

/**
 * 初始化 WASM 模块。使用 WebAssembly.instantiate + 预编译 Module
 * 不使用 WebAssembly.compile（动态编译）
 * 不使用 fetch（网络加载）
 */
function initWasm(): Promise<void> {
  if (wasmInstance) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // 初始内存：足够容纳 19 MiB argon2 工作内存 + 开销
    // argon2 需要 m_cost KiB + 栈 + 堆 + Emscripten 开销
    const initialPages = 64; // 64 * 64 KiB = 4 MiB 起步
    const memory = new WebAssembly.Memory({
      initial: initialPages,
      maximum: 512, // 512 * 64 KiB = 32 MiB (足够 19 MiB + 开销)
    });

    const imports = {
      env: {
        memory,
        // Emscripten 需要的导入
        abort: (msg: number) => {
          throw new Error(`WASM abort: ${msg}`);
        },
        __stack_pointer: new WebAssembly.Global(
          { value: "i32", mutable: true },
          0,
        ),
        __indirect_function_table: new WebAssembly.Table({
          initial: 1,
          element: "anyfunc",
        }),
        memoryBase: 0,
        tableBase: 0,
      },
    };

    try {
      const instance = await WebAssembly.instantiate(
        argon2WasmModule,
        imports as WebAssembly.Imports,
      );
      wasmInstance = instance.exports as unknown as Argon2WasmExports;
    } catch (e) {
      // 如果默认 imports 不完整，尝试更完整的 Emscripten imports
      // 退而求其次：用更大的 initial memory
      throw e;
    }
  })();

  return initPromise;
}

function generateSalt(length: number): Uint8Array {
  const salt = new Uint8Array(length);
  crypto.getRandomValues(salt);
  return salt;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 运行 Argon2id 诊断（预编译 WASM 版本）
 *
 * 注意：Emscripten 生成的 argon2.wasm 依赖完整的 runtime，
 * 如果最小 imports 不够，会报错。本函数仅用于验证
 * 「预编译 .wasm + WebAssembly.instantiate」在 Workers 中是否可运行。
 */
export async function runArgon2WasmDiagnostic(
  params: {
    memoryKiB?: number;
    timeCost?: number;
    parallelism?: number;
    outputBytes?: number;
  } = {},
): Promise<Argon2WasmDiagnosticResult> {
  const memoryKiB = params.memoryKiB ?? OWASP_MIN.memoryKiB;
  const timeCost = params.timeCost ?? OWASP_MIN.timeCost;
  const parallelism = params.parallelism ?? OWASP_MIN.parallelism;
  const outputBytes = params.outputBytes ?? OWASP_MIN.outputBytes;

  const testPassword = "test-password-for-diagnostic-only";
  const salt = generateSalt(16);

  const totalStart = Date.now();
  let initElapsedMs: number | undefined;

  try {
    const initStart = Date.now();
    await initWasm();
    initElapsedMs = Date.now() - initStart;

    if (!wasmInstance) {
      throw new Error("WASM instance not initialized");
    }

    const wasm = wasmInstance;
    const heap = new Uint8Array(wasm.memory.buffer);

    // 在 WASM 堆中分配内存
    const pwdLen = testPassword.length;
    const pwdPtr = wasm._malloc(pwdLen);
    const saltPtr = wasm._malloc(salt.length);
    const hashPtr = wasm._malloc(outputBytes);

    try {
      // 写入 password 和 salt
      const pwdBytes = new TextEncoder().encode(testPassword);
      heap.set(pwdBytes, pwdPtr);
      heap.set(salt, saltPtr);

      const result = wasm._argon2_hash(
        timeCost, // t_cost
        memoryKiB, // m_cost (KiB)
        parallelism, // parallelism
        pwdPtr, // pwd
        pwdLen, // pwdlen
        saltPtr, // salt
        salt.length, // saltlen
        hashPtr, // hash
        outputBytes, // hashlen
        0, // encoded (null)
        0, // encodedlen
        Argon2Type.Argon2id, // type
        Argon2Version.ARGON2_VERSION_13, // version
      );

      if (result !== 0) {
        const errMsgPtr = wasm._argon2_error_message(result);
        let errMsg = `argon2 error code: ${result}`;
        if (errMsgPtr) {
          // 从 WASM 内存中读取错误消息
          const view = new Uint8Array(wasm.memory.buffer);
          let end = errMsgPtr;
          while (view[end] !== 0 && end < errMsgPtr + 256) end++;
          errMsg = new TextDecoder().decode(
            view.subarray(errMsgPtr, end),
          );
        }
        throw new Error(errMsg);
      }

      // 读取 hash 结果
      const hashBytes = new Uint8Array(
        wasm.memory.buffer,
        hashPtr,
        outputBytes,
      );
      const hashHex = bytesToHex(hashBytes);
      const elapsedMs = Date.now() - totalStart;

      return {
        algorithm: "argon2id",
        wasmSource: "precompiled-wasm-modules",
        memoryKiB,
        timeCost,
        parallelism,
        outputBytes,
        success: true,
        elapsedMs,
        initElapsedMs,
        hashLength: hashHex.length,
        hashPrefix: hashHex.slice(0, 12),
        saltLength: salt.length,
      };
    } finally {
      wasm._free(pwdPtr);
      wasm._free(saltPtr);
      wasm._free(hashPtr);
    }
  } catch (e: any) {
    const elapsedMs = Date.now() - totalStart;
    return {
      algorithm: "argon2id",
      wasmSource: "precompiled-wasm-modules",
      memoryKiB,
      timeCost,
      parallelism,
      outputBytes,
      success: false,
      elapsedMs,
      initElapsedMs,
      errorName: e?.name || "Unknown",
      errorMessage: e?.message || "Unknown error",
    };
  }
}

export async function runArgon2WasmBatchDiagnostic(): Promise<{
  owaspMin: Argon2WasmDiagnosticResult;
  lowParams: Argon2WasmDiagnosticResult;
}> {
  const owaspMin = await runArgon2WasmDiagnostic(OWASP_MIN);

  let lowParams: Argon2WasmDiagnosticResult;
  if (!owaspMin.success) {
    lowParams = await runArgon2WasmDiagnostic(LOW_PARAMS);
  } else {
    lowParams = {
      ...owaspMin,
      success: false,
      errorName: "Skipped",
      errorMessage: "OWASP params succeeded, low params test not needed",
    };
  }

  return { owaspMin, lowParams };
}
