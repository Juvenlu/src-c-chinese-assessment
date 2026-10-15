/**
 * Admin 鉴权共享工具
 *
 * 统一的 x-admin-password 常量时间比较，供绘本版本管理等新增模块复用。
 * 既有 admin-rewrites.ts / admin-book-writer.ts 各自保留本地实现，避免回归风险；
 * 新代码统一从此处导入。
 */

import type { Env } from "./types";

/**
 * 校验管理员密码（x-admin-password）。
 * 使用常量时间异或比较，避免长度提前返回之外的时序差异。
 */
export function verifyAdminPassword(request: Request, env: Env): boolean {
	const pwd = request.headers.get("x-admin-password");
	if (!pwd || !env.ADMIN_PASSWORD) return false;
	if (pwd.length !== env.ADMIN_PASSWORD.length) return false;
	let result = 0;
	for (let i = 0; i < pwd.length; i++) {
		result |= pwd.charCodeAt(i) ^ env.ADMIN_PASSWORD.charCodeAt(i);
	}
	return result === 0;
}
