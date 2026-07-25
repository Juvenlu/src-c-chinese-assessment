import * as mammoth from 'mammoth';
import * as fs from 'fs';

async function parseWord() {
  const result = await mammoth.extractRawText({ path: '/tmp/001-Text.docx' });
  const text = result.value;
  
  console.log('Word 文档内容：');
  console.log('='.repeat(80));
  console.log(text);
  console.log('='.repeat(80));
  
  // 按段落分割
  const paragraphs = text.split('\n').filter(p => p.trim());
  console.log(`\n共 ${paragraphs.length} 个段落`);
  
  // 保存文本
  fs.writeFileSync('/tmp/word-content.txt', text);
}

parseWord().catch(console.error);
