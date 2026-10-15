/**
 * 安全软删除（含依赖预检查）— Worker Proxy
 * GET  /api/books/versioning/custom-books/[id]/delete → GET  预检查（只读，返回记录/反馈计数）
 * POST /api/books/versioning/custom-books/[id]/delete → POST 软删除（body: { confirm: true }）
 *   → /v1/admin/custom-books/:id/delete
 */
import { proxyToWorker } from "@/app/api/lib/worker-proxy";

export const runtime = "nodejs";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await params;
	return proxyToWorker(request, `/v1/admin/custom-books/${encodeURIComponent(id)}/delete`, {
		passBody: false,
	});
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await params;
	return proxyToWorker(request, `/v1/admin/custom-books/${encodeURIComponent(id)}/delete`);
}
