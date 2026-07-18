import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 配置路由段，禁用 body parser 以支持大文件上传
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 分钟超时（支持大文件上传）
export const fetchCache = 'force-no-store';

// 初始化 S3 存储客户端
const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT || '',
  accessKey: process.env.COZE_BUCKET_ACCESS_KEY_ID || '',
  secretKey: process.env.COZE_BUCKET_SECRET_ACCESS_KEY || '',
  bucketName: process.env.COZE_BUCKET || 'src-c-books',
  region: 'auto',
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);

  try {
    console.log(`[Upload] 收到上传请求，绘本集 ID: ${episodeId}`);
    console.log(`[Upload] Content-Type: ${request.headers.get('content-type')}`);
    console.log(`[Upload] Content-Length: ${request.headers.get('content-length')}`);

    const formData = await request.formData();
    const files = formData.getAll('images') as File[];
    const wordFile = formData.get('word_file') as File;

    console.log(`[Upload] 收到 ${files.length} 张图片，Word 文件：${wordFile ? wordFile.name : '无'}`);

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: '请上传至少一张图片' },
        { status: 400 }
      );
    }

    // 检查文件总大小（限制 50MB）
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`[Upload] 文件总大小：${Math.round(totalSize / 1024 / 1024)}MB`);
    if (totalSize > 50 * 1024 * 1024) {
      return NextResponse.json(
        { error: '文件总大小超过 50MB 限制' },
        { status: 413 }
      );
    }

    // 上传所有图片到 S3
    const imageUrls: string[] = [];
    const publicUrl = process.env.COZE_BUCKET_PUBLIC_URL;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`[Upload] 上传第 ${i + 1}/${files.length} 张：${file.name}`);

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileName = `books/${episodeId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const key = await storage.uploadFile({
        fileContent: buffer,
        fileName: fileName,
        contentType: file.type,
      });

      console.log(`[Upload] 成功：${fileName}`);

      // 生成公开访问 URL
      if (publicUrl) {
        imageUrls.push(`${publicUrl}/${key}`);
      } else {
        const url = await storage.generatePresignedUrl({
          key: key,
          expireTime: 315360000, // 10 年有效期
        });
        imageUrls.push(url);
      }
    }

    // 解析 Word 文档获取文本
    const pageTexts: string[] = [];
    if (wordFile) {
      console.log(`[Upload] 解析 Word 文档：${wordFile.name}`);
      const wordArrayBuffer = await wordFile.arrayBuffer();
      const wordBuffer = Buffer.from(wordArrayBuffer);

      // 简单的文本提取（实际应使用 mammoth 等库）
      const text = wordBuffer.toString('utf-8');
      const paragraphs = text.split(/\n+/).filter(p => p.trim());
      pageTexts.push(...paragraphs);
    }

    // 保存到数据库
    const supabase = getSupabaseClient();
    const pages = imageUrls.map((url, index) => ({
      episode_id: episodeId,
      page_number: index + 1,
      image_url: url,
      original_text: pageTexts[index] || '',
    }));

    console.log(`[Upload] 保存 ${pages.length} 页到数据库`);

    const { data, error } = await supabase
      .from('book_episode_pages')
      .insert(pages)
      .select();

    if (error) {
      console.error('[Upload] 保存页面数据失败:', error);
      return NextResponse.json(
        { error: `保存页面数据失败：${error.message}` },
        { status: 500 }
      );
    }

    console.log(`[Upload] 完成！成功上传 ${imageUrls.length} 页`);

    return NextResponse.json({
      success: true,
      message: `成功上传 ${imageUrls.length} 页`,
      data: data,
    });
  } catch (error) {
    console.error('[Upload] 错误:', error);
    console.error('[Upload] 堆栈:', error instanceof Error ? error.stack : 'N/A');
    return NextResponse.json(
      { error: `上传失败：${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}

// GET: 获取绘本集的所有页面
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('book_episode_pages')
      .select('*')
      .eq('episode_id', episodeId)
      .order('page_number', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('获取页面数据失败:', err);
    return NextResponse.json(
      { error: `获取页面数据失败：${err.message}` },
      { status: 500 }
    );
  }
}
