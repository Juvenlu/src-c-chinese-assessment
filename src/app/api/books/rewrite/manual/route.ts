import { proxyToWorker } from '@/app/api/lib/worker-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/books/rewrite/manual
 *
 * 绘本写手：人工创建初稿
 * - 从 Master Pages 读取原文
 * - 创建新的 rewrite version（status = review）
 * - 代理到 Worker → D1
 *
 * Body: { episode_id, child_id?, target_level? }
 */
export async function POST(request: Request) {
  return proxyToWorker(request, '/v1/admin/rewrite/manual')
}
