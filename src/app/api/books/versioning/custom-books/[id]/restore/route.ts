/**
 * 恢复正式版 — Worker Proxy
 * POST /api/books/versioning/custom-books/[id]/restore → POST /v1/admin/custom-books/:id/restore
 */
import { proxyToWorker } from "@/app/api/lib/worker-proxy";

export const runtime = "nodejs";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await params;
	return proxyToWorker(request, `/v1/admin/custom-books/${encodeURIComponent(id)}/restore`);
}
