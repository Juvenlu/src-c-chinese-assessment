import { S3Storage } from 'coze-coding-dev-sdk';

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT || process.env.COZE_BUCKET_ENDPOINT_URL || '',
  accessKey: process.env.COZE_BUCKET_ACCESS_KEY_ID || '',
  secretKey: process.env.COZE_BUCKET_SECRET_ACCESS_KEY || '',
  bucketName: 'src-c-books',
  region: 'auto',
});

async function testAccess() {
  console.log('测试 src-c-books bucket 访问...');
  
  try {
    // 列出所有文件
    console.log('\n列出所有文件...');
    const allFiles = await storage.listFiles({});
    console.log('找到文件数:', allFiles.keys?.length || 0);
    console.log('完整文件列表:');
    allFiles.keys?.forEach((key, i) => {
      console.log(`  ${i + 1}. ${key}`);
    });
    
    // 查找包含 "Journey" 或 "西游" 的文件
    console.log('\n查找西游记相关文件...');
    const journeyFiles = allFiles.keys?.filter(k => 
      k.toLowerCase().includes('journey') || 
      k.includes('西游') ||
      k.includes('P0') ||
      k.includes('Text') ||
      k.includes('books-huiben')
    ) || [];
    console.log('找到文件数:', journeyFiles.length);
    journeyFiles.forEach((key, i) => {
      console.log(`  ${i + 1}. ${key}`);
    });
    
  } catch (error) {
    console.error('错误:', error);
  }
}

testAccess();
