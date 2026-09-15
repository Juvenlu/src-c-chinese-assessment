/**
 * P0-13F-2 Session 模块验证测试
 *
 * 使用 Node.js 原生 Web Crypto API（与 Cloudflare Worker 一致）
 * 运行：npx tsx test/session.test.ts
 *
 * 覆盖场景：
 * 1. 正常 Session 可以生成并验证通过
 * 2. 修改 payload 后验证失败
 * 3. 修改签名后验证失败
 * 4. 已过期 Session 验证失败
 * 5. 空/无效 token 验证失败
 * 6. 不同 Secret 之间无法互通
 * 7. Cookie 属性正确
 * 8. 从 Request Cookie 提取 token
 * 9. 空 secret 时验证失败
 */

import {
	signSession,
	verifySession,
	createSessionCookie,
	createClearSessionCookie,
	extractSessionToken,
	SESSION_COOKIE_NAME,
	SESSION_DURATION_SECONDS,
} from "../src/session";

const TEST_SECRET = "test-secret-please-change-this-is-not-production";
const OTHER_SECRET = "different-secret-for-interop-test";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
	if (condition) {
		passed++;
		console.log(`  ✓ ${name}`);
	} else {
		failed++;
		console.error(`  ✗ ${name}`);
	}
}

async function test1_normalSignVerify() {
	console.log("\nTest 1: 正常 Session 生成与验证");
	const token = await signSession({ parent_id: "parent-123" }, TEST_SECRET);
	const payload = await verifySession(token, TEST_SECRET);

	assert(payload !== null, "验证返回非 null");
	assert(payload?.parent_id === "parent-123", "parent_id 正确");
	assert(typeof payload?.iat === "number", "iat 存在");
	assert(typeof payload?.exp === "number", "exp 存在");
	assert(payload && payload.exp > payload.iat, "exp > iat");
	assert(
		payload && payload.exp - payload.iat === SESSION_DURATION_SECONDS,
		"过期时长 = 30天"
	);
}

async function test2_tamperedPayload() {
	console.log("\nTest 2: 修改 payload 后验证失败");
	const token = await signSession({ parent_id: "parent-123" }, TEST_SECRET);
	const parts = token.split(".");

	// 解码 payload，修改后重新编码
	const binary = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const payload = JSON.parse(new TextDecoder().decode(bytes));
	payload.parent_id = "hacked-parent";
	const newPayloadBytes = new TextEncoder().encode(JSON.stringify(payload));
	let b64 = btoa(String.fromCharCode(...newPayloadBytes));
	b64 = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

	const tamperedToken = `${b64}.${parts[1]}`;
	const result = await verifySession(tamperedToken, TEST_SECRET);

	assert(result === null, "payload 被篡改后验证返回 null");
}

async function test3_tamperedSignature() {
	console.log("\nTest 3: 修改签名后验证失败");
	const token = await signSession({ parent_id: "parent-123" }, TEST_SECRET);
	const parts = token.split(".");

	// 把签名改成全 A（长度相同）
	const fakeSig = "A".repeat(parts[1].length);
	const tamperedToken = `${parts[0]}.${fakeSig}`;

	const result = await verifySession(tamperedToken, TEST_SECRET);
	assert(result === null, "签名被篡改后验证返回 null");
}

async function test4_expiredSession() {
	console.log("\nTest 4: 已过期 Session 验证失败");
	const pastIat = Math.floor(Date.now() / 1000) - SESSION_DURATION_SECONDS - 100;
	const pastExp = pastIat + SESSION_DURATION_SECONDS;

	const token = await signSession(
		{ parent_id: "parent-old", iat: pastIat, exp: pastExp },
		TEST_SECRET
	);

	const result = await verifySession(token, TEST_SECRET);
	assert(result === null, "过期 Session 验证返回 null");
}

async function test5_emptyOrInvalidToken() {
	console.log("\nTest 5: 空 / 无效 token 验证失败");
	const r1 = await verifySession("", TEST_SECRET);
	const r2 = await verifySession("not-a-token", TEST_SECRET);
	const r3 = await verifySession("a.b.c", TEST_SECRET);
	const r5 = await verifySession("!!!invalid!!!", TEST_SECRET);

	assert(r1 === null, "空字符串 → null");
	assert(r2 === null, "无点号 → null");
	assert(r3 === null, "两点三段 → null");
	assert(r5 === null, "非法字符 → null");
}

async function test6_differentSecretInterop() {
	console.log("\nTest 6: 不同 Secret 无法互通");
	const token = await signSession({ parent_id: "parent-123" }, TEST_SECRET);
	const result = await verifySession(token, OTHER_SECRET);

	assert(result === null, "用另一个 secret 验证失败");
}

async function test7_cookieFormat() {
	console.log("\nTest 7: Cookie 格式正确");
	const token = "test-token-value";
	const cookie = createSessionCookie(token);
	const clearCookie = createClearSessionCookie();

	assert(cookie.includes(`${SESSION_COOKIE_NAME}=${token}`), "包含 cookie name 和 token");
	assert(cookie.includes("HttpOnly"), "包含 HttpOnly");
	assert(cookie.includes("Secure"), "包含 Secure");
	assert(cookie.includes("SameSite=Lax"), "包含 SameSite=Lax");
	assert(cookie.includes("Path=/"), "包含 Path=/");
	assert(cookie.includes(`Max-Age=${SESSION_DURATION_SECONDS}`), "Max-Age = 30天");

	assert(clearCookie.includes(`${SESSION_COOKIE_NAME}=`), "清除 cookie 有 name=");
	assert(clearCookie.includes("Max-Age=0"), "清除 cookie Max-Age=0");
	assert(clearCookie.includes("HttpOnly"), "清除 cookie 也有 HttpOnly");
}

async function test8_extractFromRequest() {
	console.log("\nTest 8: 从 Request Cookie header 提取 token");
	const token = "fake-session-token";

	const req = new Request("https://example.com/api", {
		headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}; other=bar` },
	});
	const extracted = extractSessionToken(req);
	assert(extracted === token, "正确提取 session token");

	const req2 = new Request("https://example.com/api");
	const extracted2 = extractSessionToken(req2);
	assert(extracted2 === null, "无 Cookie 时返回 null");

	const req3 = new Request("https://example.com/api", {
		headers: { Cookie: "other=bar; foo=baz" },
	});
	const extracted3 = extractSessionToken(req3);
	assert(extracted3 === null, "没有 session cookie 时返回 null");
}

async function test9_emptySecretFails() {
	console.log("\nTest 9: Secret 为空时验证必失败");
	const token = await signSession({ parent_id: "p1" }, TEST_SECRET);
	const result = await verifySession(token, "");
	assert(result === null, "空 secret 无法验证任何 token");
}

async function runAll() {
	console.log("=".repeat(60));
	console.log("P0-13F-2 Session Module Validation Tests");
	console.log("=".repeat(60));

	await test1_normalSignVerify();
	await test2_tamperedPayload();
	await test3_tamperedSignature();
	await test4_expiredSession();
	await test5_emptyOrInvalidToken();
	await test6_differentSecretInterop();
	await test7_cookieFormat();
	await test8_extractFromRequest();
	await test9_emptySecretFails();

	console.log("\n" + "=".repeat(60));
	console.log(`Result: ${passed} passed, ${failed} failed`);
	console.log("=".repeat(60));

	if (failed > 0) {
		process.exit(1);
	}
}

runAll();
