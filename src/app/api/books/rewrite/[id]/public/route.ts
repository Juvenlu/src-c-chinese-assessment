import { NextResponse } from 'next/server'
import { getRewriteById } from '@/lib/book-rewrite/rewrite-store'

/**
 * 公开读取 Final 版本的改写绘本
 * 不需要 admin 密码，但只返回 final 状态
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const record = await getRewriteById(id)
    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (record.status !== 'final') {
      return NextResponse.json({ error: 'This book is not published yet' }, { status: 403 })
    }

    return NextResponse.json({
      id: record.id,
      target_level: record.target_level,
      pages: record.pages_json,
      frontier_targets: record.frontier_targets,
      finalized_at: record.finalized_at,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
