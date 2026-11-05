/**
 * classes.ts — 教师班级 MVP（P4-T2）
 *
 * 数据表（迁移 007）：
 *   classes(id, teacher_id→parents, name, invite_code UNIQUE, status active|archived, created_at, updated_at)
 *   class_memberships(id, class_id→classes, child_id→children, parent_id→parents,
 *                     status active|revoked, authorized_at, revoked_at, created_at)
 *   部分唯一索引 idx_cm_active_unique(class_id, child_id) WHERE status='active'
 *
 * 权限模型：
 *   - 教师接口：Session + parents.status='active' + parseRoles 含 teacher
 *     + classes.teacher_id = session.parent_id（他班一律 404，不泄露存在性）
 *   - 家长加入：Session + children.parent_id = session.parent_id 强制归属
 *   - 撤销：本班教师 或 授权家长本人（membership.parent_id = session.parent_id）
 *   - 邀请码仅授予"加入"能力，任何接口不允许仅凭邀请码读取班级/成员信息
 *
 * 邀请码安全：
 *   - crypto.getRandomValues 生成 8 字符 Crockford Base32（去 I/L/O/U，40bit 熵）
 *   - 插入撞 UNIQUE 自动换码重试（最多 5 次）
 *   - 重新生成 = UPDATE 单码值，旧码立即失效
 *   - join 接口双层频率限制（含失败尝试计数，防枚举）：
 *     ① 平台级：Cloudflare Rate Limiting binding（跨 isolate 一致，权威防线）
 *     ② 内存级：模块内滑动窗口（单实例快拒辅助，减少 binding 调用）
 *     40bit 熵 + 频控 + 统一错误文案构成实际防线。
 */

import { getSessionFromRequest } from "./session";
import { parseRoles, hasRole } from "./roles";
import { getConfirmedLevel } from "./level-service";
import type { Level } from "./types";

interface Env {
	DB: D1Database;
	SESSION_SECRET: string;
	JOIN_RATE_LIMITER: RateLimit;
}

// ==================== 常量 ====================

/** Crockford Base32 字母表（去除易混淆 I/L/O/U） */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;
const CODE_MAX_RETRIES = 5;

/** join 频率限制：每账号每窗口最多尝试次数（成功失败都计数） */
const JOIN_RATE_WINDOW_MS = 60_000;
const JOIN_RATE_MAX = 10;

// ==================== 类型 ====================

interface SessionPayload {
	parent_id: string;
	[key: string]: unknown;
}

interface ClassRow {
	id: string;
	teacher_id: string;
	name: string;
	invite_code: string;
	status: string;
	created_at: number;
	updated_at: number;
}

// ==================== 工具 ====================

function jsonResponse(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/** 生成邀请码（Crockford Base32 × 8，crypto 安全随机） */
function generateInviteCode(): string {
	const buf = new Uint8Array(CODE_LENGTH);
	crypto.getRandomValues(buf);
	let code = "";
	for (let i = 0; i < CODE_LENGTH; i++) {
		code += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
	}
	return code;
}

// ==================== 频率限制（内存滑动窗口） ====================

const joinAttempts = new Map<string, number[]>();

/** 清理 + 计数。返回 true = 允许本次尝试；false = 超限 */
function joinRateAllow(key: string): boolean {
	const now = Date.now();
	const list = (joinAttempts.get(key) ?? []).filter((t) => now - t < JOIN_RATE_WINDOW_MS);
	if (list.length >= JOIN_RATE_MAX) {
		joinAttempts.set(key, list);
		return false;
	}
	list.push(now);
	joinAttempts.set(key, list);
	// 防止 Map 无限增长（极端多账号场景）：超过 1000 个 key 时清空过期项
	if (joinAttempts.size > 1000) {
		for (const [k, v] of joinAttempts) {
			const alive = v.filter((t) => now - t < JOIN_RATE_WINDOW_MS);
			if (alive.length === 0) joinAttempts.delete(k);
			else joinAttempts.set(k, alive);
		}
	}
	return true;
}

/** 测试专用：重置频控状态 */
export function __resetJoinRateForTest(): void {
	joinAttempts.clear();
}

// ==================== 鉴权辅助 ====================

/** Session + 账号 active 校验。返回 session 或 null（调用方返回 401） */
async function requireSession(request: Request, env: Env): Promise<SessionPayload | null> {
	const session = (await getSessionFromRequest(request, env.SESSION_SECRET)) as SessionPayload | null;
	if (!session || !session.parent_id) return null;
	const account = await env.DB.prepare(
		"SELECT status FROM parents WHERE id = ?1"
	).bind(session.parent_id).first<{ status: string }>();
	if (!account || account.status !== "active") return null;
	return session;
}

/** Session + teacher 角色校验。返回 session 或 Response（直接返回给客户端） */
async function requireTeacher(request: Request, env: Env): Promise<SessionPayload | Response> {
	const session = await requireSession(request, env);
	if (!session) return jsonResponse({ error: "未登录" }, 401);
	const row = await env.DB.prepare(
		"SELECT roles FROM parents WHERE id = ?1"
	).bind(session.parent_id).first<{ roles: string | null }>();
	const roles = parseRoles(row?.roles ?? null);
	if (!hasRole(roles, "teacher")) {
		return jsonResponse({ error: "该账号未开通教师身份" }, 403);
	}
	return session;
}

/** 校验班级存在且属于当前教师。返回班级行或 null（调用方返回 404） */
async function getOwnedClass(env: Env, classId: string, teacherId: string): Promise<ClassRow | null> {
	return env.DB.prepare(
		"SELECT * FROM classes WHERE id = ?1 AND teacher_id = ?2"
	).bind(classId, teacherId).first<ClassRow>();
}

/** 插入班级（邀请码碰撞自动换码重试） */
async function insertClassWithUniqueCode(
	env: Env, id: string, teacherId: string, name: string, now: number
): Promise<string> {
	for (let attempt = 0; attempt < CODE_MAX_RETRIES; attempt++) {
		const code = generateInviteCode();
		try {
			await env.DB.prepare(
				"INSERT INTO classes (id, teacher_id, name, invite_code, status, created_at, updated_at) VALUES (?1,?2,?3,?4,'active',?5,?5)"
			).bind(id, teacherId, name, code, now).run();
			return code;
		} catch (e) {
			if (isUniqueViolation(e)) continue; // 邀请码碰撞，换码重试
			throw e;
		}
	}
	throw new Error("invite code generation exhausted");
}

function isUniqueViolation(e: unknown): boolean {
	return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

// ==================== 1. POST /v1/classes — 教师创建班级 ====================

export async function handleCreateClass(request: Request, env: Env): Promise<Response> {
	const auth = await requireTeacher(request, env);
	if (auth instanceof Response) return auth;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return jsonResponse({ error: "请求格式错误" }, 400);
	}
	const name = typeof body.name === "string" ? body.name.trim() : "";
	if (name.length < 1 || name.length > 50) {
		return jsonResponse({ error: "班级名称需为 1-50 个字符" }, 400);
	}

	const id = crypto.randomUUID();
	const now = nowSeconds();
	const code = await insertClassWithUniqueCode(env, id, auth.parent_id, name, now);

	return jsonResponse({
		class: { id, name, invite_code: code, status: "active", created_at: now },
	}, 201);
}

// ==================== 2. GET /v1/classes — 教师查看自己的班级 ====================

export async function handleListClasses(request: Request, env: Env): Promise<Response> {
	const auth = await requireTeacher(request, env);
	if (auth instanceof Response) return auth;

	const { results } = await env.DB.prepare(
		`SELECT c.id, c.name, c.invite_code, c.status, c.created_at,
		        (SELECT COUNT(*) FROM class_memberships m
		          WHERE m.class_id = c.id AND m.status = 'active') AS member_count
		 FROM classes c
		 WHERE c.teacher_id = ?1 AND c.status = 'active'
		 ORDER BY c.created_at DESC`
	).bind(auth.parent_id).all();

	return jsonResponse({ classes: results });
}

// ==================== 3. GET /v1/classes/:id — 教师查看本班及学生 ====================

export async function handleGetClass(request: Request, env: Env, classId: string): Promise<Response> {
	const auth = await requireTeacher(request, env);
	if (auth instanceof Response) return auth;

	const cls = await getOwnedClass(env, classId, auth.parent_id);
	if (!cls) return jsonResponse({ error: "班级不存在" }, 404); // 他班同 404，不泄露存在性

	// 最小字段投影：仅 nickname / grade + 必要标识
	// confirmed_level 不读 children 静态字段（无写入路径），由下方权威计算统一注入
	const { results: memberRows } = await env.DB.prepare(
		`SELECT m.child_id, m.authorized_at,
		        ch.nickname, ch.grade
		 FROM class_memberships m
		 JOIN children ch ON ch.id = m.child_id
		 WHERE m.class_id = ?1 AND m.status = 'active'
		 ORDER BY m.authorized_at ASC`
	).bind(classId).all<{ child_id: string; authorized_at: number; nickname: string; grade: string }>();

	// 权威等级（与成长地图同一链路，P4-T6B-4）：
	// 批量取每位成员最新一条正式测评（窗口函数每孩仅 1 行，不加载全部测评历史），
	// 经 level-service.getConfirmedLevel 纯函数计算 —— 固定 2 条 SQL，无 N+1，零学习数据写入。
	const levelByChild = new Map<string, Level | null>();
	if (memberRows.length > 0) {
		const { results: latestFormals } = await env.DB.prepare(
			`SELECT child_id, stable_char_count, level FROM (
			   SELECT child_id, stable_char_count, level,
			          ROW_NUMBER() OVER (PARTITION BY child_id ORDER BY completed_at DESC) AS rn
			   FROM test_results
			   WHERE test_type = 'formal' AND status = 'completed'
			     AND child_id IN (SELECT child_id FROM class_memberships WHERE class_id = ?1 AND status = 'active')
			 ) WHERE rn = 1`
		).bind(classId).all<{ child_id: string; stable_char_count: number | null; level: Level | null }>();
		for (const r of latestFormals) {
			levelByChild.set(r.child_id, getConfirmedLevel({ stable_char_count: r.stable_char_count, level: r.level }));
		}
	}
	const members = memberRows.map((m) => ({
		...m,
		// 未测评（无正式测评记录）→ null → 前端显示「未测评」
		confirmed_level: levelByChild.get(m.child_id) ?? null,
	}));

	return jsonResponse({
		class: {
			id: cls.id, name: cls.name, invite_code: cls.invite_code,
			status: cls.status, created_at: cls.created_at,
		},
		members,
	});
}

// ==================== 4. POST /v1/classes/:id/invite-code — 重新生成邀请码 ====================

export async function handleRegenerateInviteCode(request: Request, env: Env, classId: string): Promise<Response> {
	const auth = await requireTeacher(request, env);
	if (auth instanceof Response) return auth;

	const cls = await getOwnedClass(env, classId, auth.parent_id);
	if (!cls) return jsonResponse({ error: "班级不存在" }, 404);
	if (cls.status !== "active") return jsonResponse({ error: "班级已归档" }, 403);

	for (let attempt = 0; attempt < CODE_MAX_RETRIES; attempt++) {
		const code = generateInviteCode();
		try {
			await env.DB.prepare(
				"UPDATE classes SET invite_code = ?1, updated_at = ?2 WHERE id = ?3"
			).bind(code, nowSeconds(), classId).run();
			// 旧码立即失效（单码制：值替换即失效）
			return jsonResponse({ invite_code: code });
		} catch (e) {
			if (isUniqueViolation(e)) continue;
			throw e;
		}
	}
	return jsonResponse({ error: "邀请码生成失败，请重试" }, 500);
}

// ==================== 5. POST /v1/classes/join — 家长授权孩子入班 ====================

export async function handleJoinClass(request: Request, env: Env): Promise<Response> {
	const session = await requireSession(request, env);
	if (!session) return jsonResponse({ error: "未登录" }, 401);

	// 服务端频率限制（含失败尝试，防邀请码枚举）
	// ① 内存级快拒（单实例辅助防线）
	if (!joinRateAllow(session.parent_id)) {
		return jsonResponse({ error: "操作过于频繁，请稍后再试" }, 429);
	}
	// ② 平台级兜底（跨 isolate 一致）；binding 异常 → 503 安全失败，不静默绕过限流
	try {
		const outcome = await env.JOIN_RATE_LIMITER.limit({ key: session.parent_id });
		if (!outcome.success) {
			return jsonResponse({ error: "操作过于频繁，请稍后再试" }, 429);
		}
	} catch {
		return jsonResponse({ error: "服务暂时不可用，请稍后再试" }, 503);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return jsonResponse({ error: "请求格式错误" }, 400);
	}
	const inviteCode = typeof body.invite_code === "string" ? body.invite_code.trim().toUpperCase() : "";
	const childId = typeof body.child_id === "string" ? body.child_id : "";
	if (!inviteCode || !childId) {
		return jsonResponse({ error: "缺少邀请码或孩子标识" }, 400);
	}

	// 统一错误文案：码不存在 / 班级已归档 不可区分（防枚举）
	const INVALID = { error: "邀请码无效或已失效" } as const;

	const cls = await env.DB.prepare(
		"SELECT id, status FROM classes WHERE invite_code = ?1"
	).bind(inviteCode).first<{ id: string; status: string }>();
	if (!cls || cls.status !== "active") {
		return jsonResponse(INVALID, 403);
	}

	// 孩子归属强制校验：只能授权自己名下的孩子
	const child = await env.DB.prepare(
		"SELECT id FROM children WHERE id = ?1 AND parent_id = ?2 AND status = 'active'"
	).bind(childId, session.parent_id).first<{ id: string }>();
	if (!child) {
		return jsonResponse({ error: "孩子不存在或不属于当前账号" }, 403);
	}

	// 幂等：已有 active 关联 → 直接返回成功（不重复写）
	const existing = await env.DB.prepare(
		"SELECT id FROM class_memberships WHERE class_id = ?1 AND child_id = ?2 AND status = 'active'"
	).bind(cls.id, childId).first<{ id: string }>();
	if (existing) {
		return jsonResponse({ success: true, already_member: true, class_id: cls.id });
	}

	// 插入新 active 行（revoked 历史行保留；并发重复由部分唯一索引兜底）
	const now = nowSeconds();
	try {
		await env.DB.prepare(
			`INSERT INTO class_memberships (id, class_id, child_id, parent_id, status, authorized_at, revoked_at, created_at)
			 VALUES (?1,?2,?3,?4,'active',?5,NULL,?5)`
		).bind(crypto.randomUUID(), cls.id, childId, session.parent_id, now).run();
	} catch (e) {
		if (isUniqueViolation(e)) {
			// 并发下另一请求已插入 active —— 幂等成功
			return jsonResponse({ success: true, already_member: true, class_id: cls.id });
		}
		throw e;
	}

	return jsonResponse({ success: true, already_member: false, class_id: cls.id }, 201);
}

// ==================== 6. POST /v1/classes/:id/members/:childId/revoke — 撤销授权 ====================

export async function handleRevokeMember(
	request: Request, env: Env, classId: string, childId: string
): Promise<Response> {
	const session = await requireSession(request, env);
	if (!session) return jsonResponse({ error: "未登录" }, 401);

	// 当前 active 授权记录
	const membership = await env.DB.prepare(
		"SELECT id, parent_id, status FROM class_memberships WHERE class_id = ?1 AND child_id = ?2 AND status = 'active'"
	).bind(classId, childId).first<{ id: string; parent_id: string; status: string }>();

	if (!membership) {
		// 幂等：无 active 记录（从未加入或已撤销）→ 不泄露班级存在性，统一 404
		return jsonResponse({ error: "授权记录不存在" }, 404);
	}

	// 权限：授权家长本人 或 本班教师
	let allowed = membership.parent_id === session.parent_id;
	if (!allowed) {
		const cls = await env.DB.prepare(
			"SELECT teacher_id FROM classes WHERE id = ?1"
		).bind(classId).first<{ teacher_id: string }>();
		if (cls && cls.teacher_id === session.parent_id) {
			// 教师身份二次确认（防家长角色账号持有他班 teacher_id 的边界情形——
			// teacher_id 相等即为本班创建者，无需角色判断；创建班级本身已要求 teacher 角色）
			allowed = true;
		}
	}
	if (!allowed) {
		return jsonResponse({ error: "无权撤销该授权" }, 403);
	}

	await env.DB.prepare(
		"UPDATE class_memberships SET status = 'revoked', revoked_at = ?1 WHERE id = ?2 AND status = 'active'"
	).bind(nowSeconds(), membership.id).run();
	// UPDATE 带 status 条件：并发重复撤销时后到的 changes=0，天然幂等

	return jsonResponse({ success: true });
}

// ==================== 7. GET /v1/classes/master-stories — 已发布 Master 故事（只读） ====================

export async function handleMasterStories(request: Request, env: Env): Promise<Response> {
	const auth = await requireTeacher(request, env);
	if (auth instanceof Response) return auth;

	// D1 权威数据源；仅 published；最小字段
	const { results } = await env.DB.prepare(
		`SELECT id, series_name, episode_number, episode_title,
		        page_count, level_tier, cover_image_url, description
		 FROM book_episodes
		 WHERE status = 'published'
		 ORDER BY series_name ASC, episode_number ASC`
	).bind().all();

	return jsonResponse({ stories: results });
}
