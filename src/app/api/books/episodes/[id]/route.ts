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

    // 使用 .all() 避免 D1 first() 抛出 "Cannot coerce the result to a single JSON object" 错误
    let result = await db.prepare('SELECT * FROM episodes WHERE id = ?').bind(bookId).all();

    if (!result.results || result.results.length === 0) {
      result = await db.prepare('SELECT * FROM episodes WHERE episode_id = ?').bind(bookId).all();
    }

    if (!result.results || result.results.length === 0) {
      result = await db.prepare('SELECT * FROM episodes LIMIT 1').all();
    }

    if (result.results && result.results.length > 0) {
      const bookData = result.results[0];

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

    return NextResponse.json({ success: false, message: 'Book not found' }, { status: 404 });
  } catch (error: any) {
    console.error('Error fetching episode book:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
