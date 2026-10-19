/**
 * 推送正式版（置“新”）— Worker Proxy
 * POST /api/books/versioning/custom-books/[id]/push → POST /v1/admin/custom-books/:id/push
 */
import { proxyToWorker } from "@/app/api/lib/worker-proxy";

export const runtime = "nodejs";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await params;
	return proxyToWorker(request, `/v1/admin/custom-books/${encodeURIComponent(id)}/push`);
}
