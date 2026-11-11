/**
 * Admin 课堂推送队列 — HTTP Handlers（Worker 侧，P4-T9-1C-S4）
 *
 * 端点（均为 /v1/admin 前缀，外层 Service Key + x-admin-password 双鉴权）：
 *
 *   GET  /v1/admin/push-requests
 *        待办队列（pending/processing），含班级、教师、系列名与逐状态进度计数
 *   POST /v1/admin/push-requests/:id/claim
 *        领取申请（pending → processing，幂等重入）；
 *        领取时为班级全部 active 成员预建 class_push_results(processing) 断点行
 *   GET  /v1/admin/push-requests/:id
 *        申请详情：班级成员 + confirmed_level（权威链路）+ 课堂未完成额度
 *        + 逐孩子处理结果 + 可选 Master 列表（published 且系列匹配申请快照）
 *   POST /v1/admin/push-requests/:id/children/:childId/activate
 *        孩子级课堂上架 + 推送 + 结果记录（activate → push → 服务端核实 → ok/failed）
 *   POST /v1/admin/push-requests/:id/complete
 *        汇总关闭申请（processing → done/failed；未处理成员必须显式 skip 并给原因）
 *
 * 安全与幂等设计：
 *   - 不信任 URL/前端传入的 request_id / channel 作为授权依据：孩子归属（本班成员）、
 *     rewrite 归属（final + 属于该孩子）、Master 状态（published）与系列匹配（申请快照）
 *     全部在服务端校验。
 *   - class_push_results 按 UNIQUE(request_id, child_id) 单条记录：claim 预建、
 *     activate UPSERT 推进；result=ok 后重入直接幂等返回，不重复发布。
 *   - 中断恢复：activate 成功但 push 失败 / 进程中断后，重试时按 custom_books 实际
 *     持久化状态跳过已完成步骤（已 active 不重复上架、已 pushed 不重复推送）。
 *   - 历史 NULL 系列快照申请：阻止直接发布（409 blocked），返回可审计建议；
 *     本阶段不自动回填。可 complete 关闭（skip 全员）。
 *   - 课堂渠道：孩子级上架固定 channel='class'，经 version-store 原子守卫，
 *     与家庭额度（各 2 本未完成）互不影响。
 */

import { verifyAdminPassword, isClassPushAdminEnabled } from "./admin-auth";
import { createD1DBAdapter } from "./d1-adapter";
import { getConfirmedLevel } from "./level-service";
import { activateVersion, pushVersion } from "./version-store";
import type { Env } from "./types";
import type { Level } from "./types";

// ==================== 工具 ====================

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function nowUnix(): number {
	return Math.floor(Date.now() / 1000);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const b = (await request.json()) as Record<string, unknown>;
		return b && typeof b === "object" ? b : {};
	} catch {
		return {};
	}
}

function asPositiveInt(v: unknown): number | null {
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : null;
}

// ==================== 类型 ====================

interface PushRequestRow {
	id: string;
	class_id: string;
	teacher_id: string;
	episode_id: number | null;
	status: string;
	story_series_id: number | null;
	failure_reason: string | null;
	created_at: number;
	updated_at: number | null;
}

interface ResultRow {
	id: number;
	request_id: string;
	child_id: string;
	rewrite_id: number | null;
	custom_book_id: number | null;
	status: string;
	failure_reason: string | null;
	created_at: number;
	updated_at: number | null;
}

const RESULT_UPSERT_SQL = `INSERT INTO class_push_results
	  (request_id, child_id, rewrite_id, custom_book_id, status, failure_reason, created_at, updated_at)
	VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
	ON CONFLICT(request_id, child_id) DO UPDATE SET
	  status = excluded.status,
	  failure_reason = excluded.failure_reason,
	  rewrite_id = excluded.rewrite_id,
	  custom_book_id = excluded.custom_book_id,
	  updated_at = excluded.updated_at`;

/** 历史 NULL 系列快照的可审计处理建议（阻止直接发布时返回） */
const NULL_SERIES_ADVICE =
	"该申请创建于班级系列功能上线前，无系列快照，已阻止直接发布。" +
	"建议：请教师在班级设置故事系列后重新提交申请（本申请可 complete 关闭并作 skip 备注）；" +
	"或由管理员与教师线下确认系列后，按既有流程为孩子单独制作家庭绘本。系统不回填历史快照。";

// ==================== 1. GET /v1/admin/push-requests — 待办队列 ====================

export async function handleAdminListPushRequests(request: Request, env: Env): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	const { results } = await env.DB.prepare(
		`SELECT r.id, r.class_id, r.status, r.story_series_id, r.created_at, r.updated_at,
		        c.name AS class_name,
		        (SELECT series_name FROM book_episodes e WHERE e.series_id = r.story_series_id LIMIT 1) AS series_name,
		        (SELECT COUNT(*) FROM class_memberships m WHERE m.class_id = r.class_id AND m.status = 'active') AS member_count,
		        (SELECT COUNT(*) FROM class_push_results pr WHERE pr.request_id = r.id AND pr.status = 'ok') AS ok_count,
		        (SELECT COUNT(*) FROM class_push_results pr WHERE pr.request_id = r.id AND pr.status = 'failed') AS failed_count,
		        (SELECT COUNT(*) FROM class_push_results pr WHERE pr.request_id = r.id AND pr.status = 'skipped') AS skipped_count,
		        (SELECT COUNT(*) FROM class_push_results pr WHERE pr.request_id = r.id AND pr.status = 'processing') AS processing_count
		 FROM class_push_requests r
		 JOIN classes c ON c.id = r.class_id
		 WHERE r.status IN ('pending', 'processing')
		 ORDER BY r.created_at ASC`
	).bind().all();

	return jsonResponse({ requests: results });
}

// ==================== 2. POST /v1/admin/push-requests/:id/claim — 领取（幂等） ====================

export async function handleAdminClaimPushRequest(request: Request, env: Env, requestId: string): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	// S5F 总开关：关闭时零写入（不领取、不预建断点行）
	if (!isClassPushAdminEnabled(env)) {
		return jsonResponse({ error: "课堂推送管理操作已关闭" }, 403);
	}

	const req = await env.DB.prepare(
		`SELECT id, class_id, teacher_id, episode_id, status, story_series_id, failure_reason, created_at, updated_at
		 FROM class_push_requests WHERE id = ?1`
	).bind(requestId).first<PushRequestRow>();
	if (!req) return jsonResponse({ error: "Push request not found" }, 404);

	const now = nowUnix();

	if (req.status === "pending") {
		// 条件更新：并发 claim 只有一个生效（D1 写串行；changes=0 表示已被领取）
		const r = await env.DB.prepare(
			`UPDATE class_push_requests SET status = 'processing', updated_at = ?1
			 WHERE id = ?2 AND status = 'pending'`
		).bind(now, requestId).run();
		if (r.meta.changes > 0) {
			// 为班级全部 active 成员预建断点行；UNIQUE(request_id, child_id) + OR IGNORE 保证幂等
			await env.DB.prepare(
				`INSERT OR IGNORE INTO class_push_results (request_id, child_id, status, created_at)
				 SELECT ?1, m.child_id, 'processing', ?2
				   FROM class_memberships m
				  WHERE m.class_id = ?3 AND m.status = 'active'`
			).bind(requestId, now, req.class_id).run();
		}
	} else if (req.status !== "processing") {
		return jsonResponse({ error: `Request already ${req.status}, cannot claim` }, 409);
	}
	// processing → 幂等重入（重复点击/网络重试安全）

	const after = await env.DB.prepare(
		`SELECT id, class_id, status, story_series_id, created_at, updated_at
		 FROM class_push_requests WHERE id = ?1`
	).bind(requestId).first<Record<string, unknown>>();

	return jsonResponse({ request: after, claimed: true });
}

// ==================== 3. GET /v1/admin/push-requests/:id — 详情 ====================

export async function handleAdminGetPushRequest(request: Request, env: Env, requestId: string): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	const req = await env.DB.prepare(
		`SELECT id, class_id, teacher_id, episode_id, status, story_series_id, failure_reason, created_at, updated_at
		 FROM class_push_requests WHERE id = ?1`
	).bind(requestId).first<PushRequestRow>();
	if (!req) return jsonResponse({ error: "Push request not found" }, 404);

	const cls = await env.DB.prepare(
		`SELECT c.id, c.name, c.status, c.story_series_id
		 FROM classes c WHERE c.id = ?1`
	).bind(req.class_id).first<Record<string, unknown>>();
	if (!cls) return jsonResponse({ error: "Class not found" }, 404);

	// 班级 active 成员（最小字段投影）
	const { results: memberRows } = await env.DB.prepare(
		`SELECT m.child_id, m.authorized_at, ch.nickname, ch.grade
		 FROM class_memberships m
		 JOIN children ch ON ch.id = m.child_id
		 WHERE m.class_id = ?1 AND m.status = 'active'
		 ORDER BY m.authorized_at ASC`
	).bind(req.class_id).all<{ child_id: string; authorized_at: number; nickname: string; grade: string }>();

	// 权威等级（与成长地图同一链路；窗口函数每孩 1 行，固定 SQL 无 N+1）
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
		).bind(req.class_id).all<{ child_id: string; stable_char_count: number | null; level: Level | null }>();
		for (const r of latestFormals) {
			levelByChild.set(r.child_id, getConfirmedLevel({ stable_char_count: r.stable_char_count, level: r.level }));
		}
	}

	// 课堂未完成额度（channel='class' 独立池；与 version-store 计数语义一致）
	const classUnfinishedByChild = new Map<string, number>();
	if (memberRows.length > 0) {
		const { results: counts } = await env.DB.prepare(
			`SELECT cb.child_id, COUNT(*) AS n FROM custom_books cb
			 WHERE cb.status = 'active' AND COALESCE(cb.channel, 'home') = 'class'
			   AND NOT EXISTS (SELECT 1 FROM reading_records rr WHERE rr.custom_book_id = cb.id AND rr.completed = 1)
			   AND cb.child_id IN (SELECT child_id FROM class_memberships WHERE class_id = ?1 AND status = 'active')
			 GROUP BY cb.child_id`
		).bind(req.class_id).all<{ child_id: string; n: number }>();
		for (const r of counts) classUnfinishedByChild.set(r.child_id, Number(r.n));
	}

	// 逐孩子处理结果
	const { results: resultRows } = await env.DB.prepare(
		`SELECT id, request_id, child_id, rewrite_id, custom_book_id, status, failure_reason, created_at, updated_at
		 FROM class_push_results WHERE request_id = ?1`
	).bind(requestId).all<ResultRow>();
	const resultByChild = new Map<string, ResultRow>();
	for (const r of resultRows) resultByChild.set(r.child_id, r);

	const students = memberRows.map((m) => {
		const res = resultByChild.get(m.child_id);
		return {
			child_id: m.child_id,
			nickname: m.nickname,
			grade: m.grade,
			authorized_at: m.authorized_at,
			confirmed_level: levelByChild.get(m.child_id) ?? null,
			class_unfinished_count: classUnfinishedByChild.get(m.child_id) ?? 0,
			result: res
				? {
						status: res.status,
						rewrite_id: res.rewrite_id,
						custom_book_id: res.custom_book_id,
						failure_reason: res.failure_reason,
						updated_at: res.updated_at,
					}
				: null,
		};
	});

	// 可选 Master：published 且系列匹配申请快照；NULL 快照 → 空列表 + 阻止原因
	let availableMasters: Record<string, unknown>[] = [];
	let seriesBlockReason: string | null = null;
	if (req.story_series_id === null) {
		seriesBlockReason = NULL_SERIES_ADVICE;
	} else {
		const r = await env.DB.prepare(
			`SELECT id, series_id, series_name, episode_number, episode_title,
			        page_count, level_tier, cover_image_url
			 FROM book_episodes
			 WHERE status = 'published' AND series_id = ?1
			 ORDER BY episode_number ASC`
		).bind(req.story_series_id).all();
		availableMasters = r.results;
	}

	return jsonResponse({
		request: req,
		class: cls,
		students,
		available_masters: availableMasters,
		series_block_reason: seriesBlockReason,
	});
}

// ==================== 4. POST /v1/admin/push-requests/:id/children/:childId/activate ====================
// 孩子级课堂上架 + 推送 + 结果记录（全服务端校验，幂等，可中断恢复）

export async function handleAdminActivateForChild(
	request: Request,
	env: Env,
	requestId: string,
	childId: string,
): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	// S5F 总开关：关闭时零写入（不激活课堂书、不推送、不写结果行）
	if (!isClassPushAdminEnabled(env)) {
		return jsonResponse({ error: "课堂推送管理操作已关闭" }, 403);
	}

	const body = await readJson(request);
	const rewriteId = asPositiveInt(body.rewrite_id);
	if (!rewriteId) return jsonResponse({ error: "rewrite_id required" }, 400);

	// 1) 申请存在且处于 processing（pending 需先 claim；done/failed 拒绝）
	const req = await env.DB.prepare(
		`SELECT id, class_id, teacher_id, episode_id, status, story_series_id, failure_reason, created_at, updated_at
		 FROM class_push_requests WHERE id = ?1`
	).bind(requestId).first<PushRequestRow>();
	if (!req) return jsonResponse({ error: "Push request not found" }, 404);
	if (req.status === "pending") {
		return jsonResponse({ error: "Request not claimed yet; claim it first" }, 409);
	}
	if (req.status !== "processing") {
		return jsonResponse({ error: `Request already ${req.status}` }, 409);
	}

	// 2) 系列快照必须存在（历史 NULL 申请阻止直接发布）
	if (req.story_series_id === null) {
		return jsonResponse({ error: "Request has no series snapshot", advice: NULL_SERIES_ADVICE }, 409);
	}

	// 3) 孩子必须是本班 active 成员（不信任 URL 传入的 childId 作为归属依据）
	const membership = await env.DB.prepare(
		`SELECT id FROM class_memberships
		 WHERE class_id = ?1 AND child_id = ?2 AND status = 'active'`
	).bind(req.class_id, childId).first<{ id: string }>();
	if (!membership) {
		return jsonResponse({ error: "Child is not an active member of this class" }, 403);
	}

	// 4) 既有结果：ok → 幂等返回（成功不重复发布）
	const existingResult = await env.DB.prepare(
		`SELECT id, request_id, child_id, rewrite_id, custom_book_id, status, failure_reason, created_at, updated_at
		 FROM class_push_results WHERE request_id = ?1 AND child_id = ?2`
	).bind(requestId, childId).first<ResultRow>();
	if (existingResult && existingResult.status === "ok") {
		return jsonResponse({
			data: {
				request_id: requestId,
				child_id: childId,
				custom_book_id: existingResult.custom_book_id,
				status: "ok",
				already_done: true,
			},
		});
	}

	const now = nowUnix();
	const writeResult = async (
		status: "ok" | "failed",
		failureReason: string | null,
		rwId: number | null,
		bookId: number | null,
	): Promise<void> => {
		await env.DB.prepare(RESULT_UPSERT_SQL)
			.bind(requestId, childId, rwId, bookId, status, failureReason, now)
			.run();
	};

	// 5) rewrite 校验：存在、final、属于该孩子
	const rewrite = await env.DB.prepare(
		`SELECT id, episode_id, child_id, target_level, status
		 FROM book_rewrite_versions WHERE id = ?1`
	).bind(rewriteId).first<{ id: number; episode_id: number; child_id: string | null; target_level: string; status: string }>();
	if (!rewrite) {
		await writeResult("failed", "rewrite_not_found", rewriteId, null);
		return jsonResponse({ error: "Rewrite not found" }, 404);
	}
	if (rewrite.status !== "final") {
		await writeResult("failed", `rewrite_not_final:${rewrite.status}`, rewriteId, null);
		return jsonResponse({ error: "Rewrite is not finalized", extra: { rewrite_status: rewrite.status } }, 409);
	}
	if (!rewrite.child_id || rewrite.child_id !== childId) {
		await writeResult("failed", "rewrite_child_mismatch", rewriteId, null);
		return jsonResponse({ error: "Rewrite does not belong to this child" }, 403);
	}

	// 6) Master 校验：published 且系列匹配申请快照
	const master = await env.DB.prepare(
		`SELECT id, series_id, status FROM book_episodes WHERE id = ?1`
	).bind(rewrite.episode_id).first<{ id: number; series_id: number; status: string }>();
	if (!master) {
		await writeResult("failed", "master_not_found", rewriteId, null);
		return jsonResponse({ error: "Master episode not found" }, 409);
	}
	if (master.status !== "published") {
		await writeResult("failed", `master_not_published:${master.status}`, rewriteId, null);
		return jsonResponse({ error: "Master episode is not published", extra: { master_status: master.status } }, 409);
	}
	if (master.series_id !== req.story_series_id) {
		await writeResult("failed", "series_mismatch", rewriteId, null);
		return jsonResponse({
			error: "Master series does not match request snapshot",
			extra: { master_series_id: master.series_id, snapshot_series_id: req.story_series_id },
		}, 409);
	}

	const adapter = createD1DBAdapter(env.DB);

	// 7) 中断恢复点：按持久化状态判断 activate 是否已完成。
	//    已 active 但落在错误渠道（如家庭书）时不跳过 —— 交给 activateVersion 的渠道冲突
	//    前置校验返回业务 409，而不是误判为恢复完成。
	let book = await env.DB.prepare(
		`SELECT id, status, channel, pushed_at FROM custom_books
		 WHERE child_id = ?1 AND rewrite_id = ?2`
	).bind(childId, rewriteId).first<{ id: number; status: string; channel: string | null; pushed_at: number | null }>();

	if (!book || book.status !== "active" || (book.channel ?? "home") !== "class") {
		// 未上架（或首次执行）：经 version-store 原子守卫上架（课堂渠道独立额度）
		const act = await activateVersion(adapter, now, {
			childId,
			episodeId: rewrite.episode_id,
			rewriteId,
			channel: "class",
		});
		if (!act.ok) {
			await writeResult("failed", `activate_failed:${act.error}`, rewriteId, null);
			return jsonResponse({ error: act.error, extra: act.extra }, act.status);
		}
		book = await env.DB.prepare(
			`SELECT id, status, channel, pushed_at FROM custom_books
			 WHERE child_id = ?1 AND rewrite_id = ?2`
		).bind(childId, rewriteId).first<{ id: number; status: string; channel: string | null; pushed_at: number | null }>();
	}
	if (!book || book.status !== "active" || (book.channel ?? "home") !== "class") {
		await writeResult("failed", "activate_state_inconsistent", rewriteId, book?.id ?? null);
		return jsonResponse({ error: "Activation did not reach expected state" }, 500);
	}

	// 8) 推送（已推送则跳过 —— 中断恢复不重复置“新”）
	if (book.pushed_at === null) {
		const push = await pushVersion(adapter, now, book.id);
		if (!push.ok) {
			await writeResult("failed", `push_failed:${push.error}`, rewriteId, book.id);
			return jsonResponse({ error: push.error }, push.status);
		}
	}

	// 9) 服务端核实持久化结果后才记录 ok
	const verified = await env.DB.prepare(
		`SELECT id, status, channel, pushed_at FROM custom_books WHERE id = ?1`
	).bind(book.id).first<{ id: number; status: string; channel: string | null; pushed_at: number | null }>();
	if (!verified || verified.status !== "active" || (verified.channel ?? "home") !== "class" || verified.pushed_at === null) {
		await writeResult("failed", "verify_failed", rewriteId, book.id);
		return jsonResponse({ error: "Post-activation verification failed" }, 500);
	}

	await writeResult("ok", null, rewriteId, book.id);
	return jsonResponse({
		data: {
			request_id: requestId,
			child_id: childId,
			rewrite_id: rewriteId,
			custom_book_id: book.id,
			status: "ok",
			already_done: false,
		},
	});
}

// ==================== 5. POST /v1/admin/push-requests/:id/complete — 汇总关闭 ====================

export async function handleAdminCompletePushRequest(request: Request, env: Env, requestId: string): Promise<Response> {
	if (!verifyAdminPassword(request, env)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}
	// S5F 总开关：关闭时零写入（不关闭申请、不写跳过/汇总结果）
	if (!isClassPushAdminEnabled(env)) {
		return jsonResponse({ error: "课堂推送管理操作已关闭" }, 403);
	}

	const req = await env.DB.prepare(
		`SELECT id, class_id, teacher_id, episode_id, status, story_series_id, failure_reason, created_at, updated_at
		 FROM class_push_requests WHERE id = ?1`
	).bind(requestId).first<PushRequestRow>();
	if (!req) return jsonResponse({ error: "Push request not found" }, 404);
	if (req.status !== "processing") {
		// pending 申请不得直接关闭（防止绕过 claim/处理链路）；done/failed 幂等返回
		if (req.status === "pending") {
			return jsonResponse({ error: "Request is pending; claim and process it first" }, 409);
		}
		return jsonResponse({ request: req, already_completed: true });
	}

	const body = await readJson(request);
	const skipsRaw = Array.isArray(body.skips) ? body.skips : [];
	const skipReasonByChild = new Map<string, string>();
	for (const s of skipsRaw) {
		if (!s || typeof s !== "object") continue;
		const rec = s as Record<string, unknown>;
		const cid = typeof rec.child_id === "string" ? rec.child_id.trim() : "";
		const reason = typeof rec.reason === "string" ? rec.reason.trim() : "";
		if (cid) skipReasonByChild.set(cid, reason);
	}

	const { results: resultRows } = await env.DB.prepare(
		`SELECT id, request_id, child_id, rewrite_id, custom_book_id, status, failure_reason, created_at, updated_at
		 FROM class_push_results WHERE request_id = ?1`
	).bind(requestId).all<ResultRow>();

	// 未处理（processing）成员必须全部显式 skip 且给出原因 —— skipped 不显示为全班成功
	const pendingRows = resultRows.filter((r) => r.status === "processing");
	const missing = pendingRows.filter((r) => !skipReasonByChild.has(r.child_id));
	if (missing.length > 0) {
		return jsonResponse({
			error: "Unprocessed students require explicit skip with reason",
			unprocessed_child_ids: missing.map((r) => r.child_id),
		}, 409);
	}
	const noReason = pendingRows.filter((r) => (skipReasonByChild.get(r.child_id) ?? "").length === 0);
	if (noReason.length > 0) {
		return jsonResponse({
			error: "Skip reason must be non-empty",
			child_ids: noReason.map((r) => r.child_id),
		}, 400);
	}

	const now = nowUnix();
	for (const r of pendingRows) {
		await env.DB.prepare(
			`UPDATE class_push_results
			 SET status = 'skipped', failure_reason = ?1, updated_at = ?2
			 WHERE id = ?3 AND status = 'processing'`
		).bind(skipReasonByChild.get(r.child_id) as string, now, r.id).run();
	}

	// 汇总（skipped 保留原因，不算成功；有 failed → 申请 failed 并写摘要）
	const okCount = resultRows.filter((r) => r.status === "ok").length;
	const failedRows = resultRows.filter((r) => r.status === "failed");
	const skippedCount = pendingRows.length + resultRows.filter((r) => r.status === "skipped").length;
	const summary = `${okCount} ok, ${failedRows.length} failed, ${skippedCount} skipped`;

	const finalStatus = failedRows.length > 0 ? "failed" : "done";
	const failureSummary =
		failedRows.length > 0
			? `${summary}; ` + failedRows.map((r) => `${r.child_id}: ${r.failure_reason ?? "unknown"}`).join("; ")
			: summary;

	await env.DB.prepare(
		`UPDATE class_push_requests SET status = ?1, failure_reason = ?2, updated_at = ?3
		 WHERE id = ?4 AND status = 'processing'`
	).bind(finalStatus, failureSummary, now, requestId).run();

	return jsonResponse({
		data: {
			request_id: requestId,
			status: finalStatus,
			ok_count: okCount,
			failed_count: failedRows.length,
			skipped_count: skippedCount,
			summary: failureSummary,
		},
	});
}
