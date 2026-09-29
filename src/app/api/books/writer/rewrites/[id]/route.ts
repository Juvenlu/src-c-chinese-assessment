import { proxyToWorker } from '@/app/api/lib/worker-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/books/writer/rewrites/:id
 *
 * 绘本写手：读取单条 rewrite 详情（Worker/D1 数据源）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return proxyToWorker(request, `/v1/admin/rewrite/${id}`, { method: 'GET', passBody: false })
}

/**
 * PATCH /api/books/writer/rewrites/:id
 *
 * 绘本写手：更新 rewrite pages / status
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return proxyToWorker(request, `/v1/admin/rewrite/${id}`, { method: 'PATCH' })
}
