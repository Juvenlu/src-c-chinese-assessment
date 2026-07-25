import { S3Storage } from 'coze-coding-dev-sdk';
import { Document } from 'docx';
import * as fs from 'fs';
import * as path from 'path';

const PUBLIC_URL = 'https://pub-3599ff1cf335404cb7a5cd62bb8222b5.r2.dev';
const FOLDER_PATH = 'books-huiben/Journey to the west/EP 001';

async function generateBookJSON() {
  console.log('正在生成绘本 JSON 数据...\n');

  // 生成 10 页的 JSON 数据
  const pages = [];
  for (let i = 1; i <= 10; i++) {
    const pageNum = i.toString().padStart(2, '0');
    pages.push({
      page_number: i,
      image_url: `${PUBLIC_URL}/${FOLDER_PATH}/P${pageNum}.png`,
      original_text: `第${i}页文本（待从 Word 文档提取）`
    });
  }

  console.log('生成的 JSON 数据：');
  console.log(JSON.stringify(pages, null, 2));
  
  // 保存到文件
  fs.writeFileSync('/workspace/projects/book-pages.json', JSON.stringify(pages, null, 2));
  console.log('\n已保存到 /workspace/projects/book-pages.json');
}

generateBookJSON().catch(console.error);
