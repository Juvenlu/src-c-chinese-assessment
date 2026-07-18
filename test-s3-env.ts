import { S3Storage } from 'coze-coding-dev-sdk';
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());

  console.log('环境变量:');
  console.log('COZE_BUCKET:', process.env.COZE_BUCKET);
  console.log('COZE_BUCKET_ENDPOINT:', process.env.COZE_BUCKET_ENDPOINT);

  // 尝试不同的 Endpoint 格式
  const endpoints = [
    process.env.COZE_BUCKET_ENDPOINT || '',
    'https://r2.cloudflarestorage.com',
    'https://a99cb263154947ea7b7a5e508bba09a0.r2.cloudflarestorage.com',
  ];

  for (const endpoint of endpoints) {
    console.log(`\n尝试 Endpoint: ${endpoint}`);
    try {
      const storage = new S3Storage({
        bucket: process.env.COZE_BUCKET!,
        region: 'auto',
        accessKeyId: process.env.COZE_BUCKET_ACCESS_KEY_ID!,
        secretAccessKey: process.env.COZE_BUCKET_SECRET_ACCESS_KEY!,
        endpoint,
      });

      console.log('S3 Storage 初始化成功');

      const testContent = new Uint8Array([72, 101, 108, 108, 111]);
      const result = await storage.uploadFile({
        bucket: process.env.COZE_BUCKET!,
        key: 'test/test.txt',
        body: testContent,
        contentType: 'text/plain',
      });

      console.log('✅ 上传成功!');
      console.log('结果:', result);
      break;
    } catch (error: any) {
      console.log('❌ 错误:', error.message);
    }
  }
}

main().catch(console.error);
