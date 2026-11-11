import { proxyToWorker } from '@/app/api/lib/worker-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/push-requests — 课堂推送待办队列（P4-T9-1C-S5）
 *
 * 代理到 Worker /v1/admin/push-requests（pending/processing，
 * 含班级、教师、系列名与逐状态进度计数）。
 * 鉴权：x-admin-password 经 worker-proxy 透传，Worker 端强制校验；
 * Service Key 仅服务端注入，不暴露给浏览器。
 */
export async function GET(request: Request) {
  return proxyToWorker(request, '/v1/admin/push-requests');
}
