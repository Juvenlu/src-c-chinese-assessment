import { proxyToWorker } from '@/app/api/lib/worker-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/rewrite/generated
 *
 * AI 生成稿受控写入（status 硬编码 review，幂等）。
 * 仅应由 /api/admin/rewrite/generate 编排层在 LLM 生成 + 验证通过后调用；
 * 代理到 Worker → D1。不经过 Supabase。
 *
 * Body: { episode_id, child_id, target_level, pages, frontier_targets?,
 *         generation_params?, validation_result? }
 */
export async function POST(request: Request) {
  return proxyToWorker(request, '/v1/admin/rewrite/generated')
}
