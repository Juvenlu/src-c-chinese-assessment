import { NextResponse } from 'next/server'
import { getRewriteById, updateRewriteStatus } from '@/lib/book-rewrite/rewrite-store'

/**
 * 管理员口令校验（服务端 env-only，fail-closed）
 * - 环境变量 ADMIN_PASSWORD 未配置：503（服务配置错误，拒绝服务而非放行）
 * - 请求头 x-admin-password 缺失或不匹配：401
 * 校验通过返回 null，否则返回对应错误响应。
 */
export function checkAdminPassword(request: Request): NextResponse | null {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) {
    return NextResponse.json({ error: '服务配置错误' }, { status: 503 })
  }
  const provided = request.headers.get('x-admin-password')
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = checkAdminPassword(request)
    if (authError) {
      return authError
    }

    const { id } = await params

    // 公开读取走 /rewrite/[id]/public

    const record = await getRewriteById(id)
    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(record)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ADMIN_PASSWORD = 'srcc2026'
    const adminPwd = request.headers.get('x-admin-password')
    if (adminPwd !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { pages } = body

    const record = await updateRewriteStatus(id, 'review', {
      pages: pages || undefined,
    })

    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(record)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
