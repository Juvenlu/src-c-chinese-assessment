// Type declarations for WASM module imports in Cloudflare Workers
// When importing a .wasm file in an ES Module Worker, you get a WebAssembly.Module
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
