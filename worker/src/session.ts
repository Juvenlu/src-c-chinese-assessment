/**
 * HMAC-SHA256 Secure Session
 *
 * 设计原则：
 * - 纯 Web Crypto API，零外部依赖，可在 Cloudflare Worker 中直接运行
 * - 签名格式：base64url(payload).base64url(signature)
 * - payload: { parent_id, iat, exp }
 * - 过期时间：30 天
 * - Cookie: src_auth_session / HttpOnly / Secure / SameSite=Lax / Path=/
 */

export const SESSION_COOKIE_NAME = "src_auth_session";
export const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60; // 30 天

export interface SessionPayload {
	parent_id: string;
	iat: number; // issued at, unix seconds
	exp: number; // expires at, unix seconds
}

// ===== 内部工具：Web Crypto =====

function stringToBytes(str: string): Uint8Array {
	return new TextEncoder().encode(str);
}

function bytesToString(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
	if (!secret) {
		throw new Error("SESSION_SECRET is not configured");
	}
	const keyData = stringToBytes(secret);
	return crypto.subtle.importKey(
		"raw",
		keyData,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"]
	);
}

// ===== base64url 编码 / 解码 =====

function base64urlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	const base64 = btoa(binary);
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array | null {
	try {
		const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
		const pad = (4 - (base64.length % 4)) % 4;
		const padded = base64 + "=".repeat(pad);
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	} catch {
		return null;
	}
}

// ===== 签名 / 验证 =====

/**
 * 生成签名后的 session token
 * 格式：base64url(payload_json).base64url(hmac_signature)
 */
export async function signSession(
	payload: Omit<SessionPayload, "iat" | "exp"> & { iat?: number; exp?: number },
	secret: string
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const fullPayload: SessionPayload = {
		parent_id: payload.parent_id,
		iat: payload.iat ?? now,
		exp: payload.exp ?? now + SESSION_DURATION_SECONDS,
	};

	const payloadJson = JSON.stringify(fullPayload);
	const payloadBytes = stringToBytes(payloadJson);
	const payloadB64u = base64urlEncode(payloadBytes);

	let key: CryptoKey;
	try {
		key = await getHmacKey(secret);
	} catch (e) {
		throw new Error("Failed to sign session: " + (e instanceof Error ? e.message : "invalid secret"));
	}
	const signature = await crypto.subtle.sign("HMAC", key, payloadBytes);
	const signatureB64u = base64urlEncode(new Uint8Array(signature));

	return `${payloadB64u}.${signatureB64u}`;
}

/**
 * 验证 session token，返回 payload 或 null
 * - 签名错误 → null
 * - 格式错误 → null
 * - 已过期 → null
 */
export async function verifySession(
	token: string,
	secret: string
): Promise<SessionPayload | null> {
	if (!token || !token.includes(".")) return null;

	const parts = token.split(".");
	if (parts.length !== 2) return null;

	const [payloadB64u, signatureB64u] = parts;

	const payloadBytes = base64urlDecode(payloadB64u);
	if (!payloadBytes) return null;

	const signatureBytes = base64urlDecode(signatureB64u);
	if (!signatureBytes) return null;

	// 验证签名
	let key: CryptoKey;
	try {
		key = await getHmacKey(secret);
	} catch {
		return null; // secret 无效，视为验证失败
	}
	const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, payloadBytes);
	if (!valid) return null;

	// 解析 payload
	try {
		const payload = JSON.parse(bytesToString(payloadBytes)) as SessionPayload;

		// 必须字段校验
		if (!payload.parent_id || typeof payload.parent_id !== "string") return null;
		if (typeof payload.iat !== "number" || typeof payload.exp !== "number") return null;

		// 过期检查
		const now = Math.floor(Date.now() / 1000);
		if (payload.exp <= now) return null;

		return payload;
	} catch {
		return null;
	}
}

// ===== Cookie 工具 =====

/**
 * 生成 Set-Cookie header 值
 * HttpOnly + Secure + SameSite=Lax + Path=/ + Max-Age=30天
 */
export function createSessionCookie(token: string): string {
	return (
		`${SESSION_COOKIE_NAME}=${token}; ` +
		`HttpOnly; ` +
		`Secure; ` +
		`SameSite=Lax; ` +
		`Path=/; ` +
		`Max-Age=${SESSION_DURATION_SECONDS}`
	);
}

/**
 * 生成清除 Cookie 的 Set-Cookie header 值
 */
export function createClearSessionCookie(): string {
	return (
		`${SESSION_COOKIE_NAME}=; ` +
		`HttpOnly; ` +
		`Secure; ` +
		`SameSite=Lax; ` +
		`Path=/; ` +
		`Max-Age=0`
	);
}

/**
 * 从 Request Cookie header 中提取 session token
 */
export function extractSessionToken(request: Request): string | null {
	const cookieHeader = request.headers.get("Cookie");
	if (!cookieHeader) return null;

	const cookies = cookieHeader.split(";");
	for (const c of cookies) {
		const trimmed = c.trim();
		if (trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) {
			return trimmed.slice(SESSION_COOKIE_NAME.length + 1);
		}
	}
	return null;
}

/**
 * 从 Request 中读取并验证 session
 * 失败返回 null
 */
export async function getSessionFromRequest(
	request: Request,
	secret: string
): Promise<SessionPayload | null> {
	const token = extractSessionToken(request);
	if (!token) return null;
	return verifySession(token, secret);
}
