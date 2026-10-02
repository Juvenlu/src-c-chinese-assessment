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

    let result = await db.prepare('SELECT * FROM episodes WHERE id = ?').bind(bookId).all();

    if (!result.results || result.results.length === 0) {
      result = await db.prepare('SELECT * FROM episodes WHERE episode_id = ?').bind(bookId).all();
    }

    if (result.results && result.results.length > 0) {
      const bookData: any = result.results[0];

      // 解析 pages JSON
      let parsedPages: any[] = [];
      if (typeof bookData.pages === 'string') {
        try {
          parsedPages = JSON.parse(bookData.pages);
        } catch (e) {
          parsedPages = [];
        }
      } else if (Array.isArray(bookData.pages)) {
        parsedPages = bookData.pages;
      }

      // 如果数据库里 pages 为空，注入默认示例页面（防止前端无数据展示）
      if (parsedPages.length === 0) {
        parsedPages = [
          {
            page_number: 1,
            text_content: '很久很久以前，在东胜神洲的花果山上，有一块仙石。',
            image_url: 'https://placehold.co/600x400/png?text=Page+1+Monkey+King'
          },
          {
            page_number: 2,
            text_content: '有一天，仙石崩裂，产下一个石猴。大家都叫他孙悟空！',
            image_url: 'https://placehold.co/600x400/png?text=Page+2+Sun+Wukong'
          }
        ];
      }

      bookData.pages = parsedPages;

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
