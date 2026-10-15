/**
 * 归档正式版 — Worker Proxy
 * POST /api/books/versioning/custom-books/[id]/archive → POST /v1/admin/custom-books/:id/archive
 */
import { proxyToWorker } from "@/app/api/lib/worker-proxy";

export const runtime = "nodejs";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await params;
	return proxyToWorker(request, `/v1/admin/custom-books/${encodeURIComponent(id)}/archive`);
}
