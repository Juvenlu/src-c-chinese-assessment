/**
 * 测试环境 .wasm 加载支持（仅供本地 tsx 测试使用，不进入生产构建）。
 *
 * 背景：Worker 生产代码（password.ts、argon2-wasm-diag.ts）使用
 *   `import argon2WasmModule from "*.wasm"`
 * 该导入语义由 workerd 运行时提供（default export = WebAssembly.Module）。
 *
 * 本地 tsx 测试环境无此语义，且：
 *   - tsconfig paths 无法拦截相对路径 import（如 ./wasm/argon2.wasm）
 *   - tsx 对未知扩展 fallback 到 CJS require
 *
 * 因此在此注册 Node 内部模块扩展 handler：任何 .wasm 文件被 require 时，
 * 读取真实二进制并同步编译为 WebAssembly.Module 作为 module.exports。
 * esbuild 的 __toESM interop 会将其包装为 { default: Module }，
 * 与 workerd 的 default export 语义一致。
 *
 * 必须在 import 任何 src/* 模块之前加载本文件（import 声明顺序保证）。
 */
import { readFileSync } from "node:fs";
import Module from "node:module";

interface NodeModuleInternals {
	_extensions: Record<string, ((mod: { exports: unknown }, filename: string) => void) | undefined>;
}

const internals = Module as unknown as NodeModuleInternals;

// @cloudflare/workers-types 将 WebAssembly.Module 声明为抽象类（生产环境由 workerd 实例化），
// 测试环境 Node 运行时的 WebAssembly.Module 是可构造的，此处显式断言构造签名。
const WasmModuleCtor = WebAssembly.Module as unknown as new (bytes: Uint8Array) => WebAssembly.Module;

if (!internals._extensions[".wasm"]) {
	internals._extensions[".wasm"] = (mod: { exports: unknown }, filename: string): void => {
		const bytes = readFileSync(filename);
		mod.exports = new WasmModuleCtor(bytes);
	};
}
