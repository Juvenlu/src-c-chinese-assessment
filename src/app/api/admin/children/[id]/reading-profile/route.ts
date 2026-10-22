import { proxyToWorker } from '@/app/api/lib/worker-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/children/:id/reading-profile
 *
 * 孩子阅读档案明细（AI 个性化改写的档案数据源）。
 * 代理到 Worker → D1（test_results formal 记录 + known/weak 字表）。
 * 不经过 Supabase。
 *
 * 鉴权：
 *   1. x-admin-password
 *   2. X-SRC-Service-Key
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  return proxyToWorker(request, `/v1/admin/children/${encodeURIComponent(id)}/reading-profile`, {
    passBody: false,
  })
}
