import { NextResponse } from 'next/server'
import { getRewriteById, updateRewriteStatus } from '@/lib/book-rewrite/rewrite-store'

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 简易 admin 鉴权
    // （公开读取走 /rewrite/[id]/public）

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
