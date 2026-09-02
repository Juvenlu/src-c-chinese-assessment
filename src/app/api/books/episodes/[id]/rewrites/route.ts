import { NextResponse } from 'next/server'
import { listRewritesByEpisode } from '@/lib/book-rewrite/rewrite-store'

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ADMIN_PASSWORD = 'srcc2026'
    const adminPwd = _.headers.get('x-admin-password')
    if (adminPwd !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rewrites = await listRewritesByEpisode(id)
    return NextResponse.json(rewrites)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
