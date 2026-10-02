'use client';

import { useState, useEffect, useRef, use } from 'react';

export default function BookReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const bookId = parseInt(id, 10);

  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function initBook() {
      try {
        setLoading(true);

        const episodeRes = await fetch(`/api/books/episodes/${bookId}`);
        const episodeData = await episodeRes.json();

        if (episodeData.data) {
          const bookData = episodeData.data;
          setBook(bookData);

          let rawPages = bookData.pages || bookData.pages_json || [];
          if (typeof rawPages === 'string') {
            try {
              rawPages = JSON.parse(rawPages);
            } catch (pErr) {
              rawPages = [];
            }
          }
          setPages(Array.isArray(rawPages) ? rawPages : []);
        }
      } catch (err) {
        console.error('Failed to load book:', err);
      } finally {
        setLoading(false);
      }
    }

    if (bookId) {
      initBook();
    }
  }, [bookId]);

  if (loading) {
    return <div className="flex justify-center items-center h-screen text-gray-600">绘本加载中...</div>;
  }

  if (!book) {
    return (
      <div className="flex flex-col justify-center items-center h-screen gap-4">
        <p className="text-gray-500 font-medium">未找到绘本内容 (ID: {bookId})</p>
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-md text-sm"
        >
          返回书架
        </button>
      </div>
    );
  }

  const currentPageData = pages[currentPage - 1] || {};
  const imageUrl = currentPageData.image_url || currentPageData.imageUrl || '';
  const textContent = currentPageData.text_content || currentPageData.textContent || currentPageData.text || '';

  return (
    <div className="max-w-4xl mx-auto p-4 flex flex-col items-center min-h-screen">
      <div className="w-full flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">{book.episode_title || book.series_name || 'SRC 趣味中文绘本'}</h1>
        <span className="text-sm text-gray-500 font-medium">
          {pages.length > 0 ? `第 ${currentPage} / ${pages.length} 页` : '暂无页码'}
        </span>
      </div>

      <div className="w-full bg-white rounded-lg shadow-md p-6 flex flex-col items-center border">
        {pages.length === 0 ? (
          <div className="py-12 text-center text-gray-500 font-medium">
            📖 该绘本暂未上传具体页面内容 (ID: {bookId})
          </div>
        ) : (
          <>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={`Page ${currentPage}`}
                className="max-h-[500px] object-contain rounded-md mb-6"
              />
            ) : (
              <div className="w-full h-64 bg-gray-100 rounded-md mb-6 flex items-center justify-center text-gray-400">
                暂无图片
              </div>
            )}
            <p className="text-lg text-gray-800 leading-relaxed text-center font-medium max-w-2xl">
              {textContent || '暂无文字内容'}
            </p>
          </>
        )}
      </div>

      {pages.length > 0 && (
        <div className="flex gap-4 mt-6">
          <button
            onClick={() => setCurrentPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-6 py-2 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 rounded-md font-medium"
          >
            上一页
          </button>
          <button
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={currentPage >= pages.length}
            className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-md font-medium"
          >
            下一页
          </button>
        </div>
      )}

      <button
        onClick={() => window.history.back()}
        className="mt-6 px-4 py-2 text-sm text-gray-500 hover:text-gray-800"
      >
        ← 返回书架
      </button>
    </div>
  );
}
