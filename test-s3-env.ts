import { loadEnvConfig } from '@next/env';
import { S3Storage } from 'coze-coding-dev-sdk';

async function main() {
  // 加载环境变量
  const projectDir = process.cwd();
  loadEnvConfig(projectDir);

  console.log('环境变量:');
  console.log('COZE_BUCKET:', process.env.COZE_BUCKET);
  console.log('COZE_BUCKET_ENDPOINT:', process.env.COZE_BUCKET_ENDPOINT);
  console.log('COZE_BUCKET_ACCESS_KEY_ID:', process.env.COZE_BUCKET_ACCESS_KEY_ID ? '已设置' : '未设置');
  console.log('COZE_BUCKET_SECRET_ACCESS_KEY:', process.env.COZE_BUCKET_SECRET_ACCESS_KEY ? '已设置' : '未设置');

  // 尝试不同的 endpoint 格式
  const endpoints = [
    process.env.COZE_BUCKET_ENDPOINT!,
    `https://${process.env.COZE_BUCKET}.r2.cloudflarestorage.com`,
    'https://r2.cloudflarestorage.com',
  ];

  for (const endpoint of endpoints) {
    console.log(`\n尝试 Endpoint: ${endpoint}`);
    try {
      const storage = new S3Storage({
        bucket: process.env.COZE_BUCKET!,
        region: process.env.COZE_BUCKET_REGION || 'auto',
        accessKeyId: process.env.COZE_BUCKET_ACCESS_KEY_ID!,
        secretAccessKey: process.env.COZE_BUCKET_SECRET_ACCESS_KEY!,
        endpoint: endpoint,
      });

      // 测试上传
      const testContent = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const result = await storage.uploadFile({
        bucket: process.env.COZE_BUCKET!,
        key: 'test/test.txt',
        body: testContent,
        contentType: 'text/plain',
      });

      console.log('✅ 上传成功:', result);

      // 生成 URL
      const url = await storage.generatePresignedUrl({
        bucket: process.env.COZE_BUCKET!,
        key: 'test/test.txt',
        expiresIn: 3600 * 24 * 365 * 10,
      });

      console.log('访问 URL:', url);
      break;
    } catch (error: any) {
      console.error('❌ 失败:', error.message || error);
    }
  }
}

main();
