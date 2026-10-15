/**
 * 管理员版本列表 — Worker Proxy
 * GET /api/books/versioning/children/[childId]/episodes/[episodeId]/versions
 *   → GET /v1/admin/children/:childId/episodes/:episodeId/versions
 */
import { proxyToWorker } from "@/app/api/lib/worker-proxy";

export const runtime = "nodejs";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ childId: string; episodeId: string }> },
): Promise<Response> {
	const { childId, episodeId } = await params;
	return proxyToWorker(
		request,
		`/v1/admin/children/${encodeURIComponent(childId)}/episodes/${encodeURIComponent(episodeId)}/versions`,
		{ passBody: false },
	);
}
