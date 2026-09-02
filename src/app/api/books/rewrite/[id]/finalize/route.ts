import { NextResponse } from 'next/server'
import { updateRewriteStatus } from '@/lib/book-rewrite/rewrite-store'

export async function POST(
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

    const record = await updateRewriteStatus(id, 'final', {
      pages: pages || undefined,
      finalizedBy: 'admin',
    })

    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(record)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
