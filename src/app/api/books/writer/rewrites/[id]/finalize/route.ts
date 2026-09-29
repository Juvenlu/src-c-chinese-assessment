import { proxyToWorker } from '@/app/api/lib/worker-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/books/writer/rewrites/:id/finalize
 *
 * 绘本写手：Finalize + 自动发布到 custom_books（Worker/D1 数据源）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return proxyToWorker(request, `/v1/admin/rewrite/${id}/finalize`, { method: 'POST' })
}
