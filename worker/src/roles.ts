/**
 * roles.ts — 统一账号角色模型（P4-T1）
 *
 * parents.roles 列的规范解析与校验。
 *
 * 存储格式（DB 列，TEXT）：
 *   'parent'           家长（默认值，006 迁移后所有存量账号自动归属）
 *   'teacher'          教师
 *   'parent,teacher'   双角色（预留，本阶段不产生）
 *
 * 设计原则：
 *   - 解析函数是唯一事实来源，禁止在业务代码中用
 *     roles.includes('teacher') 之类的裸字符串包含判断
 *     （会把 'noteacher' 之类的脏数据误判为教师）。
 *   - 非法 / 空 / 未知值一律兜底为 ['parent']（最小权限原则）。
 *   - 输出顺序稳定：parent 在前，teacher 在后，去重。
 */

export type Role = "parent" | "teacher";

export const ALL_ROLES: readonly Role[] = ["parent", "teacher"];

/**
 * 解析 DB 中的 roles 原始字符串为规范化角色数组。
 * - null / undefined / 空串 / 全部未知 → ['parent']
 * - 忽略未知 token，去重，按 ALL_ROLES 顺序稳定输出
 */
export function parseRoles(raw: string | null | undefined): Role[] {
	if (typeof raw !== "string" || raw.trim() === "") {
		return ["parent"];
	}
	const tokens = raw.split(",").map((t) => t.trim()).filter((t) => t !== "");
	const found = new Set<Role>();
	for (const token of tokens) {
		if (token === "parent" || token === "teacher") {
			found.add(token);
		}
	}
	if (found.size === 0) {
		return ["parent"];
	}
	return ALL_ROLES.filter((r) => found.has(r));
}

/**
 * 判断角色数组是否包含指定角色。
 */
export function hasRole(roles: Role[], role: Role): boolean {
	return roles.includes(role);
}

/**
 * 把角色数组序列化为 DB 存储格式（稳定顺序）。
 */
export function formatRoles(roles: Role[]): string {
	const found = new Set(roles);
	const normalized = ALL_ROLES.filter((r) => found.has(r));
	return normalized.length > 0 ? normalized.join(",") : "parent";
}
