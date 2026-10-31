/**
 * 测试环境 Web Crypto 兼容层（仅供本地 tsx 测试使用，不进入生产构建）。
 *
 * password.ts 使用 crypto.subtle.timingSafeEqual —— Cloudflare Workers 特有扩展，
 * Node.js 标准 Web Crypto 不提供。此处用 Node 原生 crypto.timingSafeEqual
 * 补齐同等常量时间比较语义，使认证 handler 可在本地测试环境运行。
 * 生产环境（workerd）自带该 API，此 polyfill 不生效。
 */
import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

type BufferLike = ArrayBuffer | ArrayBufferView;

function toUint8Array(input: BufferLike): Uint8Array {
	if (input instanceof ArrayBuffer) {
		return new Uint8Array(input);
	}
	return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

const subtle = crypto.subtle as unknown as Record<string, unknown>;

if (typeof subtle.timingSafeEqual !== "function") {
	subtle.timingSafeEqual = (a: BufferLike, b: BufferLike): boolean => {
		const ua = toUint8Array(a);
		const ub = toUint8Array(b);
		if (ua.byteLength !== ub.byteLength) {
			return false;
		}
		return nodeTimingSafeEqual(ua, ub);
	};
}
