import { NextRequest } from 'next/server';
import { proxySessionToWorker } from '../lib/session-proxy';

/**
 * GET  /api/classes — 教师查看自己的班级列表（Worker 端校验 teacher 角色）
 * POST /api/classes — 教师创建班级，body: { name: 1-50 字符 }
 *
 * Production: Vercel → Worker → D1（fail-fast）
 */
export async function GET(req: NextRequest) {
  return proxySessionToWorker(req, '/v1/classes', 'classes GET');
}

export async function POST(req: NextRequest) {
  return proxySessionToWorker(req, '/v1/classes', 'classes POST');
}
