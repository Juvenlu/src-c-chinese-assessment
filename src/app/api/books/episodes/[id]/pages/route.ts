import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 初始化 S3 存储客户端
const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: process.env.COZE_BUCKET_ACCESS_KEY_ID || '',
  secretKey: process.env.COZE_BUCKET_SECRET_ACCESS_KEY || '',
  bucketName: process.env.COZE_BUCKET_NAME || 'src-c-books',
  region: 'auto',
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);

  try {
    const formData = await request.formData();
    const files = formData.getAll('images') as File[];
    const wordFile = formData.get('word') as File;

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: '请上传至少一张图片' },
        { status: 400 }
      );
    }

    // 上传所有图片到 S3
    const imageKeys: string[] = [];
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileName = `books/${episodeId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const key = await storage.uploadFile({
        fileContent: buffer,
        fileName: fileName,
        contentType: file.type,
      });

      imageKeys.push(key);
    }

    // 生成公开访问 URL（使用 generatePresignedUrl）
    const imageUrls: string[] = [];
    for (const key of imageKeys) {
      const url = await storage.generatePresignedUrl({
        key: key,
        expireTime: 315360000, // 10 年有效期
      });
      imageUrls.push(url);
    }

    // 解析 Word 文档获取文本
    const pageTexts: string[] = [];
    if (wordFile) {
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

    const { error } = await supabase
      .from('book_episode_pages')
      .insert(pages);

    if (error) {
      console.error('保存页面数据失败:', error);
      return NextResponse.json(
        { error: `保存页面数据失败：${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `成功上传 ${imageUrls.length} 张图片`,
      imageUrls,
    });
  } catch (error) {
    console.error('上传失败:', error);
    return NextResponse.json(
      { error: `上传失败：${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}
