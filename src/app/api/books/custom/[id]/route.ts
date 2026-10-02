import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { env } = getRequestContext();
    const db = env.DB;
    const bookId = params.id;

    if (!db) {
      return NextResponse.json({ success: false, message: 'Database client not found' }, { status: 500 });
    }

    // 1. 优先按 id 精确匹配
    let result = await db.prepare('SELECT * FROM custom_books WHERE id = ?').bind(bookId).all();

    // 2. 若未查到，尝试匹配 custom_id 或 book_id
    if (!result.results || result.results.length === 0) {
      result = await db.prepare('SELECT * FROM custom_books WHERE custom_id = ? OR book_id = ?').bind(bookId, bookId).all();
    }

    // 3. 兜底逻辑：获取第一条可用记录
    if (!result.results || result.results.length === 0) {
      result = await db.prepare('SELECT * FROM custom_books ORDER BY id ASC LIMIT 1').all();
    }

    if (result.results && result.results.length > 0) {
      const bookData: any = result.results[0];

      if (typeof bookData.pages === 'string') {
        try {
          bookData.pages = JSON.parse(bookData.pages);
        } catch (e) {
          console.error('Failed to parse pages JSON', e);
        }
      }

      return NextResponse.json({
        success: true,
        data: bookData
      });
    }

    return NextResponse.json({ success: false, message: 'Custom book not found' }, { status: 404 });
  } catch (error: any) {
    console.error('Error fetching custom book:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
