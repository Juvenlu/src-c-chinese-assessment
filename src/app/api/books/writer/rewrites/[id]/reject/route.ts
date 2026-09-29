import { proxyToWorker } from '@/app/api/lib/worker-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/books/writer/rewrites/:id/reject
 *
 * 绘本写手：驳回 rewrite（Worker/D1 数据源）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return proxyToWorker(request, `/v1/admin/rewrite/${id}/reject`, { method: 'POST' })
}
