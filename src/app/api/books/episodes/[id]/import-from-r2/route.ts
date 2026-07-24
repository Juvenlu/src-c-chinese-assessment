import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 初始化 S3 存储客户端
// 注意：S3Storage SDK 使用 COZE_BUCKET_NAME 环境变量，但我们的配置使用 COZE_BUCKET
const bucketName = process.env.COZE_BUCKET_NAME || process.env.COZE_BUCKET || 'src-c-books';
const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT || process.env.COZE_BUCKET_ENDPOINT_URL || '',
  accessKey: process.env.COZE_BUCKET_ACCESS_KEY_ID || '',
  secretKey: process.env.COZE_BUCKET_SECRET_ACCESS_KEY || '',
  bucketName: bucketName,
  region: 'auto',
});

// 设置 COZE_BUCKET_NAME 环境变量，确保 SDK 内部也能正确读取
if (!process.env.COZE_BUCKET_NAME) {
  process.env.COZE_BUCKET_NAME = bucketName;
}

// POST: 从 Cloudflare R2 文件夹 URL 自动导入绘本内容
export async function POST(request: NextRequest) {
  try {
    const { folder_url, episode_id } = await request.json();

    if (!folder_url || !episode_id) {
      return NextResponse.json(
        { error: 'folder_url 和 episode_id 是必填参数' },
        { status: 400 }
      );
    }

    console.log(`[Import] 开始从 Cloudflare R2 导入，episode_id: ${episode_id}`);
    console.log(`[Import] 文件夹 URL: ${folder_url}`);

    // 从 URL 中提取 bucket 名称和 prefix（文件夹路径）
    // URL 格式：https://dash.cloudflare.com/xxx/r2/default/buckets/bucket-name?prefix=path/to/folder
    let prefix = '';
    let bucketName = process.env.COZE_BUCKET_NAME || process.env.COZE_BUCKET || 'src-c-books';
    try {
      const url = new URL(folder_url);
      
      // 从路径中提取 bucket 名称
      // 路径格式：/a99cb263154947ea7b7a5e508bba09a0/r2/default/buckets/bucket-name
      const pathParts = url.pathname.split('/');
      const bucketsIndex = pathParts.indexOf('buckets');
      if (bucketsIndex !== -1 && bucketsIndex + 1 < pathParts.length) {
        bucketName = pathParts[bucketsIndex + 1];
        console.log(`[Import] 从 URL 中提取的 bucket 名称：${bucketName}`);
      }
      
      const prefixParam = url.searchParams.get('prefix');
      if (prefixParam) {
        prefix = decodeURIComponent(prefixParam);
        // 确保 prefix 以 / 结尾
        if (!prefix.endsWith('/')) {
          prefix += '/';
        }
      }
    } catch (e) {
      return NextResponse.json(
        { error: '无效的 URL 格式' },
        { status: 400 }
      );
    }

    if (!prefix) {
      return NextResponse.json(
        { error: '无法从 URL 中提取文件夹路径' },
        { status: 400 }
      );
    }

    console.log(`[Import] 提取的 prefix: ${prefix}`);

    // 使用从 URL 中提取的 bucket 名称创建存储客户端
    const importStorage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT || process.env.COZE_BUCKET_ENDPOINT_URL || '',
      accessKey: process.env.COZE_BUCKET_ACCESS_KEY_ID || '',
      secretKey: process.env.COZE_BUCKET_SECRET_ACCESS_KEY || '',
      bucketName: bucketName,
      region: 'auto',
    });

    // 列出文件夹中的所有文件
    const filesResult = await importStorage.listFiles({ prefix });
    const fileKeys = filesResult.keys || [];
    console.log(`[Import] 找到 ${fileKeys.length} 个文件`);

    if (fileKeys.length === 0) {
      return NextResponse.json(
        { error: '文件夹中未找到任何文件' },
        { status: 404 }
      );
    }

    // 分离图片文件和 Word 文件
    const imageKeys = fileKeys.filter(key => 
      key.endsWith('.png') || key.endsWith('.jpg') || key.endsWith('.jpeg')
    );
    const wordKeys = fileKeys.filter(key => 
      key.endsWith('.docx') || key.endsWith('.doc')
    );

    console.log(`[Import] 图片文件：${imageKeys.length} 个，Word 文件：${wordKeys.length} 个`);

    if (imageKeys.length === 0) {
      return NextResponse.json(
        { error: '文件夹中未找到图片文件' },
        { status: 400 }
      );
    }

    // 按文件名排序图片文件
    imageKeys.sort((a, b) => {
      const aNum = extractPageNumber(a);
      const bNum = extractPageNumber(b);
      return aNum - bNum;
    });

    console.log(`[Import] 排序后的图片文件:`);
    imageKeys.forEach((key, i) => {
      console.log(`  ${i + 1}. ${key}`);
    });

    // 下载并解析 Word 文件
    let pageTexts: string[] = [];
    if (wordKeys.length > 0) {
      const wordKey = wordKeys[0];
      console.log(`[Import] 解析 Word 文件：${wordKey}`);
      
      const wordBuffer = await importStorage.readFile({ fileKey: wordKey });
      const text = extractTextFromDocx(wordBuffer);
      pageTexts = splitIntoPages(text, imageKeys.length);
      
      console.log(`[Import] 从 Word 文件提取了 ${pageTexts.length} 页文本`);
    }

    // 生成公开访问 URL
    const publicUrl = process.env.COZE_BUCKET_PUBLIC_URL;
    const pages = [];

    for (let i = 0; i < imageKeys.length; i++) {
      const imageKey = imageKeys[i];
      let imageUrl = '';

      if (publicUrl) {
        // 从 key 中提取相对路径
        const relativePath = imageKey.replace(/^.*?books-huiben\//, 'books-huiben/');
        imageUrl = `${publicUrl}/${relativePath}`;
      } else {
        imageUrl = await storage.generatePresignedUrl({
          key: imageKey,
          expireTime: 315360000, // 10 年有效期
        });
      }

      pages.push({
        episode_id: parseInt(episode_id),
        page_number: i + 1,
        image_url: imageUrl,
        original_text: pageTexts[i] || '',
      });
    }

    console.log(`[Import] 准备保存 ${pages.length} 页到数据库`);

    // 保存到数据库
    const supabase = getSupabaseClient();
    
    // 先删除该绘本集的旧页面数据
    const { error: deleteError } = await supabase
      .from('book_episode_pages')
      .delete()
      .eq('episode_id', parseInt(episode_id));

    if (deleteError) {
      console.warn('[Import] 删除旧页面数据失败:', deleteError);
    }

    // 插入新页面数据
    const { data, error } = await supabase
      .from('book_episode_pages')
      .insert(pages)
      .select();

    if (error) {
      console.error('[Import] 保存页面数据失败:', error);
      return NextResponse.json(
        { error: `保存页面数据失败：${error.message}` },
        { status: 500 }
      );
    }

    console.log(`[Import] 完成！成功导入 ${pages.length} 页`);

    return NextResponse.json({
      success: true,
      message: `成功导入 ${pages.length} 页`,
      data: data,
    });
  } catch (error) {
    console.error('[Import] 错误:', error);
    return NextResponse.json(
      { error: `导入失败：${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}

// 从文件名中提取页码
function extractPageNumber(key: string): number {
  const match = key.match(/P?(\d+)(?:\.\w+)?$/i);
  if (match) {
    return parseInt(match[1]);
  }
  return 0;
}

// 从 DOCX 文件中提取文本（简化版）
function extractTextFromDocx(buffer: Buffer): string {
  try {
    // DOCX 文件是 ZIP 格式，包含 XML 文件
    // 这里使用简单的文本提取方法
    // 实际生产环境应使用 mammoth 等库
    
    // 尝试查找 XML 中的文本内容
    const text = buffer.toString('utf-8');
    const paragraphs = text.split(/<\/w:p>/g)
      .map(p => {
        const match = p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
        if (match) {
          return match.map(m => m.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, '')).join('');
        }
        return '';
      })
      .filter(p => p.trim())
      .join('\n');
    
    return text || '';
  } catch (e) {
    console.error('[Import] 解析 Word 文件失败:', e);
    return '';
  }
}

// 将文本分割成指定页数
function splitIntoPages(text: string, pageCount: number): string[] {
  if (!text) return [];
  
  // 按段落分割
  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  
  if (paragraphs.length <= pageCount) {
    // 如果段落数少于页数，每段一页
    return paragraphs;
  }
  
  // 如果段落数多于页数，平均分配
  const pages: string[] = [];
  const paragraphsPerPage = Math.ceil(paragraphs.length / pageCount);
  
  for (let i = 0; i < pageCount; i++) {
    const start = i * paragraphsPerPage;
    const end = Math.min(start + paragraphsPerPage, paragraphs.length);
    pages.push(paragraphs.slice(start, end).join('\n'));
  }
  
  return pages;
}
