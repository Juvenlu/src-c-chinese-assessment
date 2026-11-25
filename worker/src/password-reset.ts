/**
 * Password Reset — 家长忘记密码 → 管理员审核 → 一次性重置（P5-R1B）
 *
 * 业务流：
 *   家长 POST /v1/auth/password-reset/request（防枚举 + 双维限流）
 *   → 管理员 GET /v1/admin/password-resets（预览 pending）
 *   → 管理员 POST /v1/admin/password-resets/:id/approve（核实身份后批准，签发一次性链接）
 *   → 管理员 POST /v1/admin/password-resets/:id/reject（拒绝并记录原因）
 *   → 家长 GET /reset-password?token=...（前端页面）
 *   → 家长 POST /v1/auth/password-reset/commit（原子消费：改密 + session_version+1）
 *
 * 安全设计（P5-R1A-FIX）：
 * - 32 字节（256-bit）crypto.getRandomValues 随机 Token，DB 仅存 sha256 摘要
 * - 30 分钟有效、一次性；消费由 D1 batch() 整体原子化，两条同守卫 UPDATE
 * - 申请响应三态统一 {success:true}（防邮箱枚举）；限流响应亦无差别
 * - 双维限流：email 60s/1次、1h/5次；IP 1h/10次（未知邮箱同样计数）
 * - approve 必须提供 verification_method（身份核实方式）；不含则拒绝批准
 * - 明文 Token 仅在 approve 响应中出现一次；不落日志、不落 DB、不落普通列表
 * - 同一邮箱新申请会将旧 pending/approved 作废（expired），保证单邮箱单活跃申请
 *
 * 另含：POST /v1/auth/change-password（正确修改密码，同样使旧 Session 失效）
 */

import type { Env } from "./types";
import { verifyPassword, hashPassword } from "./password";
import { verifyAdminPassword } from "./admin-auth";
import {
	getAuthedSession,
	signSession,
	createSessionCookie,
} from "./session";

// ===== 常量 =====

const RESET_TOKEN_BYTES = 32; // 256-bit 高熵
const RESET_TOKEN_TTL_SECONDS = 30 * 60; // 30 分钟
const PASSWORD_MIN_LENGTH = 8;

// 防刷响应：三态统一
const SUCCESS_RESPONSE = { success: true };

// ===== 双维限流（D1 持久化滑动窗口，跨 Worker 实例一致，原子占用）=====
//
// 方案说明（P5-R1B-FIX + P5-R1B-FIX2）：
// 进程内 Map 限流仅对单个 isolate 有效；多 Worker 实例部署时各持有独立 Map，
// 可被横向绕过。改为以 password_reset_requests 表历史行做计数：
//   - 每次申请（含未知邮箱）都会 INSERT 一条记录（parent_id 可为 null）
//   - 记录含 email / request_ip / created_at 三要素，天然支撑 email 与 IP 双维窗口
//   - D1 为共享持久化状态 → 跨实例计数全局一致，无横向绕过面
//   - 未知邮箱同样插入记录 → 同样受计数约束，杜绝枚举探测（响应仍三态统一）
//
// 并发原子性（P5-R1B-FIX2 关键修复）：
// 早期实现为「SELECT COUNT 限流判定 → INSERT 占用」两步独立操作，多实例并发时
// 各请求可在对方 INSERT 前都读到未超限计数，从而同时绕过限额（额度占用竞态）。
// 现改为单条 `INSERT ... SELECT ... WHERE 窗口计数守卫`：
//   - 限额判定与额度占用在同一条写语句（隐式事务 + 写锁）内执行
//   - SQLite/D1 写语句自持写锁，跨实例并发时串行化：任一请求插入后，其余请求
//     的 COUNT 子查询必然看到该行 → 守卫不满足 → 0 行插入（未占用额度）
//   - meta.changes===1 = 通过并占用；0 = 超限（调用方仍返回统一 success）
// 不再存在「先查后写」窗口，限流判断与额度占用不可被并发同时绕过。
// 沿用 Cloudflare 平台级 RateLimit binding（JOIN_RATE_LIMITER）作最外层兜底不变。

/** 单条原子 SQL：窗口计数守卫 + 额度占用（email 60s/1、1h/5；IP 1h/10） */
const ATOMIC_RESET_INSERT_SQL = `
	INSERT INTO password_reset_requests
	 (id, parent_id, email, status, token_hash, expires_at,
	  verified_by, verification_method, rejected_by, reject_reason,
	  request_ip, created_at, consumed_at)
	 SELECT ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL
	 WHERE
	   (SELECT COUNT(*) FROM password_reset_requests WHERE email = ? AND created_at >= ?) < 1
	   AND (SELECT COUNT(*) FROM password_reset_requests WHERE email = ? AND created_at >= ?) < 5
	   AND (SELECT COUNT(*) FROM password_reset_requests WHERE request_ip = ? AND created_at >= ?) < 10
`;

// ===== Token 工具 =====

/** base64url 安全随机 Token（默认 32 字节 = 256-bit 熵） */
export function generateResetToken(byteLen: number = RESET_TOKEN_BYTES): string {
	const buf = new Uint8Array(byteLen);
	crypto.getRandomValues(buf);
	let bin = "";
	for (const b of buf) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** sha256 摘要（hex）——DB 仅存摘要，不存明文 Token */
export async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// ===== 类型 =====

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			...extraHeaders,
		},
	});
}

function nowUnix(): number {
	return Math.floor(Date.now() / 1000);
}

function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clientIp(request: Request): string {
	return (
		request.headers.get("CF-Connecting-IP") ||
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		"unknown"
	);
}

// ===== 1. 家长提交申请 =====

export async function handlePasswordResetRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	const ip = clientIp(request);

	let body: { email?: unknown };
	try {
		body = await request.json();
	} catch {
		// 防枚举：非法请求体也返回统一成功（不泄露语义差异）
		return jsonResponse(SUCCESS_RESPONSE);
	}

	const email = String(body.email ?? "").trim().toLowerCase();
	if (!email || !isValidEmail(email)) {
		// 统一响应，不区分“邮箱格式错误/不存在”
		return jsonResponse(SUCCESS_RESPONSE);
	}

	// 原子插入申请：限流判定与额度占用同一条写语句（P5-R1B-FIX2）。
	// email: 60s/1次、1h/5次；IP: 1h/10次；未知邮箱同样计数，杜绝枚举探测。
	// 并发/多实例下由 SQLite 写锁串行化，不存在「先查后写」可绕过的窗口。
	try {
		const nowTs = nowUnix();
		const requestId = crypto.randomUUID();

		// 查家长（active 才挂 parent_id；不存在/禁用不区分）
		const parent = await env.DB.prepare(
			"SELECT id, status FROM parents WHERE email = ?",
		)
			.bind(email)
			.first<{ id: string; status: string }>();

		const parentId = parent && parent.status === "active" ? parent.id : null;

		// 原子插入申请：限流判定与额度占用同语句（写锁内 COUNT 守卫 + INSERT）。
		// changes===1 → 本次申请占用一个额度；changes===0 → 窗口超限（调用方统一 success）。
		// 并发/多实例下不会出现“双双通过判定”的插入。
		const ins = await env.DB.prepare(ATOMIC_RESET_INSERT_SQL)
			.bind(
				requestId,
				parentId,
				email,
				ip,
				nowTs,
				email,
				nowTs - 60,
				email,
				nowTs - 3600,
				ip,
				nowTs - 3600,
			)
			.run();

		if (!ins.meta || ins.meta.changes !== 1) {
			// 未占用额度 = 命中任一窗口限额（含并发竞争失败方），统一成功返回
			return jsonResponse(SUCCESS_RESPONSE);
		}

		// 插入成功后才作废旧 pending/approved 申请：保证单邮箱同时最多一条活跃申请
		// （新申请到来后旧的未消费链接立即失效，防止旧链接悬挂；未知邮箱记录同样作废）
		await env.DB.prepare(
			`UPDATE password_reset_requests SET status = 'expired'
			 WHERE email = ? AND status IN ('pending', 'approved')
			   AND id != ?`,
		)
			.bind(email, requestId)
			.run();

		return jsonResponse(SUCCESS_RESPONSE);
	} catch (error) {
		console.error("[password-reset] request error:", error);
		// 内部错误也统一成功（防枚举；家长端无感知差异）
		return jsonResponse(SUCCESS_RESPONSE);
	}
}

// ===== 2. 管理员查看申请列表 =====

export async function handlePasswordResetsList(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	try {
		const { results } = await env.DB.prepare(
			`SELECT id, email, status, verified_by, verification_method,
			        reject_reason, request_ip, created_at, consumed_at, expires_at
			 FROM password_reset_requests
			 ORDER BY created_at DESC
			 LIMIT 200`,
		)
			.bind()
			.all<{
				id: string;
				email: string;
				status: string;
				verified_by: string | null;
				verification_method: string | null;
				reject_reason: string | null;
				request_ip: string | null;
				created_at: number;
				consumed_at: number | null;
				expires_at: number | null;
			}>();

		// 注意：绝不返回 token_hash（摘要不暴露给普通管理员列表）
		return jsonResponse({ success: true, requests: results ?? [] });
	} catch (error) {
		console.error("[password-reset] list error:", error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}

// ===== 3. 管理员批准（核实身份后）=====

export async function handlePasswordResetApprove(
	request: Request,
	env: Env,
	requestId: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	let body: { verification_method?: unknown };
	try {
		body = await request.json();
	} catch {
		return jsonResponse({ error: "Invalid request body" }, 400);
	}

	// 身份核实是批准的必要前提（P5-R0：邮箱及孩子昵称不能单独作为身份证明）
	const verificationMethod = String(body.verification_method ?? "").trim();
	if (!verificationMethod) {
		return jsonResponse(
			{ error: "必须填写身份核实方式（如微信/电话核实记录），未核实不得批准" },
			400,
		);
	}

	try {
		const row = await env.DB.prepare(
			"SELECT id, parent_id, email, status FROM password_reset_requests WHERE id = ?",
		)
			.bind(requestId)
			.first<{ id: string; parent_id: string | null; email: string; status: string }>();

		if (!row || row.status !== "pending") {
			return jsonResponse({ error: "申请不存在或已处理" }, 404);
		}
		if (!row.parent_id) {
			return jsonResponse({ error: "该申请未关联有效账户，无法批准" }, 400);
		}

		// 确认家长仍存在且 active（防止孤儿申请）
		const parent = await env.DB.prepare(
			"SELECT id FROM parents WHERE id = ? AND status = 'active'",
		)
			.bind(row.parent_id)
			.first<{ id: string }>();
		if (!parent) {
			return jsonResponse({ error: "关联账户已失效，无法批准" }, 400);
		}

		// 生成一次性 Token（256-bit），仅 sha256 摘要入库
		const token = generateResetToken();
		const tokenHash = await sha256Hex(token);
		const expiresAt = nowUnix() + RESET_TOKEN_TTL_SECONDS;

		// 原子批准：pending → approved（状态守卫防并发重复批准/越权）
		const upd = await env.DB.prepare(
			`UPDATE password_reset_requests
			 SET status = 'approved', token_hash = ?, expires_at = ?,
			     verified_by = 'admin', verification_method = ?
			 WHERE id = ? AND status = 'pending'`,
		)
			.bind(tokenHash, expiresAt, verificationMethod, requestId)
			.run();

		if (!upd.meta || upd.meta.changes !== 1) {
			return jsonResponse({ error: "申请状态已变化，请刷新" }, 409);
		}

		// 明文 Token 仅在本次响应中出现一次；链接须经可信渠道交付已核实家长
		const base = env.RESET_LINK_BASE || "";
		const resetLink = `${base}/reset-password?token=${token}`;

		return jsonResponse({
			success: true,
			reset_link: resetLink,
			email: row.email,
			expires_at: expiresAt,
			expires_in_seconds: RESET_TOKEN_TTL_SECONDS,
		});
	} catch (error) {
		console.error("[password-reset] approve error:", error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}

// ===== 4. 管理员拒绝 =====

export async function handlePasswordResetReject(
	request: Request,
	env: Env,
	requestId: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	let body: { reject_reason?: unknown };
	try {
		body = await request.json();
	} catch {
		return jsonResponse({ error: "Invalid request body" }, 400);
	}
	const reason = String(body.reject_reason ?? "").trim();

	try {
		const upd = await env.DB.prepare(
			`UPDATE password_reset_requests
			 SET status = 'rejected', rejected_by = 'admin', reject_reason = ?
			 WHERE id = ? AND status = 'pending'`,
		)
			.bind(reason || null, requestId)
			.run();

		if (!upd.meta || upd.meta.changes !== 1) {
			return jsonResponse({ error: "申请不存在或已处理" }, 404);
		}
		return jsonResponse(SUCCESS_RESPONSE);
	} catch (error) {
		console.error("[password-reset] reject error:", error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}

// ===== 5. 家长消费 Token 设置新密码（原子）=====

export async function handlePasswordResetCommit(
	request: Request,
	env: Env,
): Promise<Response> {
	let body: { token?: unknown; new_password?: unknown };
	try {
		body = await request.json();
	} catch {
		return jsonResponse({ error: "链接无效或已过期" }, 400);
	}

	const token = String(body.token ?? "");
	const newPassword = String(body.new_password ?? "");
	if (!token || newPassword.length < PASSWORD_MIN_LENGTH) {
		return jsonResponse({ error: "链接无效或已过期" }, 400);
	}

	try {
		const tokenHash = await sha256Hex(token);
		const nowTs = nowUnix();
		const newHash = await hashPassword(newPassword);

		// === 原子消费（P5-R1A-FIX）===
		// 两条 UPDATE 同守卫（token_hash 匹配 + status='approved' + 未过期）：
		//  ① 更新父密码并 session_version+1（使全部旧 Session 立即失效）
		//  ② 将申请置为 used（一次性）
		// D1 batch() 单事务：任一失败整体回滚，杜绝“密码已改但 Token 未消费”等部分成功。
		const results = await env.DB.batch([
			env.DB.prepare(
				`UPDATE parents
				 SET password_hash = ?, session_version = session_version + 1
				 WHERE id = (
				   SELECT parent_id FROM password_reset_requests
				   WHERE token_hash = ? AND status = 'approved' AND expires_at > ?
				 )`,
			).bind(newHash, tokenHash, nowTs),
			env.DB.prepare(
				`UPDATE password_reset_requests
				 SET status = 'used', consumed_at = ?
				 WHERE token_hash = ? AND status = 'approved' AND expires_at > ?`,
			).bind(nowTs, tokenHash, nowTs),
		]);

		if (
			!results ||
			results.length !== 2 ||
			results[0]?.meta?.changes !== 1 ||
			results[1]?.meta?.changes !== 1
		) {
			// Token 无效 / 已过期 / 重复使用 / 并发竞争 —— 一律同响应
			return jsonResponse({ error: "链接无效或已过期" }, 400);
		}

		// 成功：不自动登录，家长携带新密码重新登录（与新 session_version 一致）
		return jsonResponse({ success: true });
	} catch (error) {
		console.error("[password-reset] commit error:", error);
		// 密码哈希失败等内部错误：不泄露 Token 语义
		return jsonResponse({ error: "链接无效或已过期" }, 400);
	}
}

// ===== 6. 正常修改密码（chage-password 修复，P5-R1B）=====
// 统一走 Worker → D1：Argon2id + session_version+1（旧 Session 全部失效）+ 签发新 Session

export async function handleChangePassword(
	request: Request,
	env: Env,
): Promise<Response> {
	const session = await getAuthedSession(request, env);
	if (!session || !session.parent_id) {
		return jsonResponse({ error: "未登录" }, 401);
	}

	let body: { old_password?: unknown; new_password?: unknown };
	try {
		body = await request.json();
	} catch {
		return jsonResponse({ error: "Invalid request body" }, 400);
	}

	const oldPassword = String(body.old_password ?? "");
	const newPassword = String(body.new_password ?? "");
	if (!oldPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
		return jsonResponse({ error: "密码至少需要8位" }, 400);
	}

	try {
		const parent = await env.DB.prepare(
			"SELECT id, password_hash, session_version FROM parents WHERE id = ?",
		)
			.bind(session.parent_id)
			.first<{ id: string; password_hash: string | null; session_version: number | null }>();

		if (!parent) return jsonResponse({ error: "账户不存在" }, 404);
		if (!parent.password_hash) {
			return jsonResponse({ error: "账户未设置密码，请使用忘记密码功能" }, 400);
		}

		// 旧密码校验（Argon2id / legacy PBKDF2 只读兼容）
		const ok = await verifyPassword(oldPassword, parent.password_hash);
		if (!ok) {
			return jsonResponse({ error: "原密码不正确" }, 401);
		}

		const newHash = await hashPassword(newPassword);
		const oldSv = parent.session_version ?? 0;

		// 原子：密码更新 + session_version+1（同守卫，旧 Session 立即失效）
		const upd = await env.DB.prepare(
			"UPDATE parents SET password_hash = ?, session_version = session_version + 1 WHERE id = ?",
		)
			.bind(newHash, session.parent_id)
			.run();

		if (!upd.meta || upd.meta.changes !== 1) {
			return jsonResponse({ error: "修改失败，请稍后重试" }, 500);
		}

		// 签发新 Session（sv = 更新后的版本号，与 DB 一致）
		const newSv = oldSv + 1;
		const sessionToken = await signSession(
			{ parent_id: session.parent_id, sv: newSv },
			env.SESSION_SECRET,
		);
		const cookie = createSessionCookie(sessionToken);

		return jsonResponse(
			{ success: true, session: sessionToken },
			200,
			{ "Set-Cookie": cookie },
		);
	} catch (error) {
		console.error("[password-reset] change-password error:", error);
		return jsonResponse({ error: "修改失败，请稍后重试" }, 500);
	}
}