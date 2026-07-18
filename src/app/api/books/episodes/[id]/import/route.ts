import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

/**
 * POST /api/books/episodes/[id]/import
 * 手动录入已上传到 Cloudflare 的文件 URL
 * 
 * Body:
 * {
 *   "pages": [
 *     {
 *       "page_number": 1,
 *       "image_url": "https://pub-xxx.r2.dev/books/2/page_1.png",
 *       "original_text": "第一页的故事文本..."
 *     },
 *     ...
 *   ]
 * }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  const supabase = getSupabaseClient();

  try {
    const body = await request.json();
    const { pages } = body;

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return NextResponse.json(
        { error: '请提供 pages 数组' },
        { status: 400 },
      );
    }

    // 批量插入页面数据
    const pagesToInsert = pages.map((page: any) => ({
      episode_id: episodeId,
      page_number: page.page_number,
      image_url: page.image_url,
      original_text: page.original_text || '',
    }));

    const { data, error } = await supabase
      .from('book_episode_pages')
      .upsert(pagesToInsert, {
        onConflict: 'episode_id,page_number',
      })
      .select();

    if (error) {
      console.error('[Import Pages] Supabase error:', error);
      return NextResponse.json(
        { error: '保存失败：' + error.message },
        { status: 500 },
      );
    }

    // 更新绘本集状态为 completed
    await supabase
      .from('book_episodes')
      .update({ status: 'completed' })
      .eq('id', episodeId);

    return NextResponse.json({
      success: true,
      data: data,
      count: data.length,
    });
  } catch (err) {
    console.error('[Import Pages] Error:', err);
    return NextResponse.json(
      { error: '录入失败：' + (err as Error).message },
      { status: 500 },
    );
  }
}
