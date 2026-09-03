import { NextResponse } from 'next/server'
import { getRewriteById } from '@/lib/book-rewrite/rewrite-store'
import { getSupabaseClient } from '@/storage/database/supabase-client'

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

    // 查询 episode 信息（用于显示标题）
    let episode: any = null
    if (record.episode_id) {
      const client = getSupabaseClient()
      const { data: ep } = await client
        .from('book_episodes')
        .select('id, series_name, episode_number, episode_title')
        .eq('id', record.episode_id)
        .single()
      episode = ep || null
    }

    return NextResponse.json({
      id: record.id,
      target_level: record.target_level,
      pages: record.pages_json,
      frontier_targets: record.frontier_targets,
      finalized_at: record.finalized_at,
      episode,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
