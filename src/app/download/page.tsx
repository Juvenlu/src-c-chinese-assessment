'use client';

import { useState, useEffect } from 'react';

export default function DownloadPage() {
  const [fileContent, setFileContent] = useState<string>('');
  const [currentFile, setCurrentFile] = useState<string>('src300');

  const files = [
    { key: 'src300', name: 'SRC300_v1.1 字词库', desc: '75字/词，基础词汇' },
    { key: 'src500', name: 'SRC500_v1.1 字词库（新增）', desc: '40字/词，中级词汇' },
    { key: 'src800', name: 'SRC800_v1.1 字词库（新增）', desc: '40字/词，高级词汇' },
  ];

  useEffect(() => {
    let filename = '';
    if (currentFile === 'src300') filename = 'src300_v1.1_vocabulary.txt';
    else if (currentFile === 'src500') filename = 'src500_v1.1_vocabulary.txt';
    else filename = 'src800_v1.1_vocabulary.txt';
    
    fetch(`/${filename}`)
      .then(res => res.text())
      .then(text => setFileContent(text))
      .catch(err => {
        console.error('加载失败:', err);
        setFileContent('文件加载失败，请刷新页面重试');
      });
  }, [currentFile]);

  const handleDownload = (fileKey: string) => {
    let filename = '';
    if (fileKey === 'src300') filename = 'src300_v1.1_vocabulary.txt';
    else if (fileKey === 'src500') filename = 'src500_v1.1_vocabulary.txt';
    else filename = 'src800_v1.1_vocabulary.txt';
    
    // 使用fetch + blob方式下载，避免路径问题
    fetch(`/${filename}`)
      .then(res => res.blob())
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(fileContent);
    alert('已复制到剪贴板！');
  };

  return (
    <div className="min-h-screen p-8 bg-[var(--color-src-bg)]">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-2">SRC字词库1.1版本下载</h1>
        <p className="text-center text-gray-600 mb-8">选择文件查看和下载</p>

        {/* 文件选择按钮 */}
        <div className="flex flex-wrap gap-4 mb-8 justify-center">
          {files.map(file => (
            <button
              key={file.key}
              onClick={() => setCurrentFile(file.key)}
              className={`px-6 py-3 rounded-xl font-medium transition-all ${
                currentFile === file.key
                  ? 'bg-[var(--color-src-primary)] text-white shadow-lg scale-105'
                  : 'bg-white text-gray-700 shadow hover:shadow-md'
              }`}
            >
              <div className="font-bold">{file.name}</div>
              <div className="text-sm opacity-80">{file.desc}</div>
            </button>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-4 mb-4 justify-center">
          <button
            onClick={() => handleDownload(currentFile)}
            className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition"
          >
            ⬇️ 下载文件
          </button>
          <button
            onClick={handleCopy}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            📋 复制内容
          </button>
        </div>

        {/* 文件内容预览 */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800 overflow-auto max-h-[600px]">
            {fileContent || '加载中...'}
          </pre>
        </div>

        {/* 使用说明 */}
        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h3 className="font-bold text-lg mb-2">📝 使用说明</h3>
          <ol className="list-decimal list-inside space-y-2 text-gray-700">
            <li>点击上方按钮选择要查看的字词库</li>
            <li>点击"下载文件"按钮下载到您的电脑</li>
            <li>或者点击"复制内容"复制全部文字</li>
            <li>用记事本或Word打开编辑</li>
            <li>编辑完成后，把修改后的内容发给我更新</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
