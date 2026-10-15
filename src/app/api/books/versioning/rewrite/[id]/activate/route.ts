/**
 * 显式设为正式版 — Worker Proxy
 * POST /api/books/versioning/rewrite/[id]/activate
 *   body: { child_id, episode_id }
 *   → POST /v1/admin/rewrite/:id/activate
 */
import { proxyToWorker } from "@/app/api/lib/worker-proxy";

export const runtime = "nodejs";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await params;
	return proxyToWorker(request, `/v1/admin/rewrite/${encodeURIComponent(id)}/activate`);
}
