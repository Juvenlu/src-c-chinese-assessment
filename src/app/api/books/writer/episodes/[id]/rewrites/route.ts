import { proxyToWorker } from '@/app/api/lib/worker-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/books/writer/episodes/:id/rewrites
 *
 * 绘本写手：列出某 episode 的所有 rewrite 版本（Worker/D1 数据源）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return proxyToWorker(request, `/v1/admin/episodes/${id}/rewrites`, { method: 'GET', passBody: false })
}
