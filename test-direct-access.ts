import { S3Storage } from 'coze-coding-dev-sdk';

async function testDirectAccess() {
  const storage = new S3Storage({
    bucket: 'src-c-books',
    region: 'auto',
    endpoint: 'https://3599ff1cf335404cb7a5cd62bb8222b5.r2.cloudflarestorage.com',
    accessKeyId: process.env.COZE_BUCKET_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.COZE_BUCKET_SECRET_ACCESS_KEY || '',
  });

  console.log('列出 bucket 根目录所有文件：');
  console.log('---');

  try {
    const result = await storage.listFiles({
      prefix: '',
      limit: 100,
    });

    console.log(`找到 ${result.keys.length} 个文件/文件夹：`);
    result.keys.forEach((key, index) => {
      console.log(`${index + 1}. ${key}`);
    });
  } catch (error) {
    console.error('错误:', error);
  }
}

testDirectAccess();
