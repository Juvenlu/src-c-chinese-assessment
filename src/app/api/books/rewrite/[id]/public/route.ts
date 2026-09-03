import { NextResponse } from 'next/server'
import { getRewriteById } from '@/lib/book-rewrite/rewrite-store'
import { getSupabaseClient } from '@/storage/database/supabase-client'
import { getCurrentUser } from '@/lib/auth-utils'

/**
 * 孩子端读取自己的 Final AI 定制绘本
 * 需要登录，且只能读取属于当前 activeChild 的绘本
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 1. 验证登录
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const record = await getRewriteById(id)
    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (record.status !== 'final') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // 2. 验证孩子归属：rewrite 的 child_id 必须属于当前登录家长的某个孩子
    if (record.child_id) {
      const client = getSupabaseClient()
      const { data: child } = await client
        .from('children')
        .select('id, parent_id')
        .eq('id', record.child_id)
        .single()
      
      if (!child || child.parent_id !== user.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    } else {
      // 没有 child_id 的通用版本，不提供给孩子端阅读
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
