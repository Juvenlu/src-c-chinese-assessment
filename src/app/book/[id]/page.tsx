'use client';

import { useState, useEffect, useRef, use } from 'react';

interface EpisodePage {
  page_number?: number;
  page_num?: number;
  image_url?: string;
  imageUrl?: string;
  text_content?: string;
  textContent?: string;
  text?: string;
}

export default function BookReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const bookId = parseInt(id, 10);

  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [childId, setChildId] = useState<number | null>(null);
  const [bookType, setBookType] = useState<'custom' | 'episode'>('custom');

  const lastSavedPageRef = useRef<number>(1);

  useEffect(() => {
    async function initBook() {
      try {
        setLoading(true);

        // 1. 获取当前激活的孩子 ID
        const activeChildRes = await fetch('/api/children');
        const activeChildData = await activeChildRes.json();
        let currentChildId = null;
        if (activeChildData.success && activeChildData.data?.length > 0) {
          currentChildId = activeChildData.data[0].id;
          setChildId(currentChildId);
        }

        let bookData = null;
        let isCustomBook = false;

        // 2. 优先按 Episode 模式加载（因为图书馆列表以 Episode 绘本为主）
        try {
          const episodeRes = await fetch(`/api/books/episodes/${bookId}`);
          const episodeData = await episodeRes.json();
          if (episodeData.success && episodeData.data) {
            bookData = episodeData.data;
            isCustomBook = false;
          }
        } catch (e) {
          console.log('Not an episode book, trying custom route...');
        }

        // 3. 若 Episode 获取失败，备选 Custom 模式加载
        if (!bookData) {
          try {
            const customRes = await fetch(`/api/books/custom/${bookId}`);
            const customData = await customRes.json();
            if (customData.success && customData.data) {
              bookData = customData.data;
              isCustomBook = true;
            }
          } catch (e) {
            console.error('Failed to load custom book', e);
          }
        }

        if (bookData) {
          setBook(bookData);
          setBookType(isCustomBook ? 'custom' : 'episode');

          // 多端字段容错解析 (pages_json / content_json / pages)
          let rawPages = bookData.pages_json || bookData.content_json || bookData.pages || [];
          if (typeof rawPages === 'string') {
            try {
              rawPages = JSON.parse(rawPages);
            } catch (pErr) {
              rawPages = [];
            }
          }
          setPages(Array.isArray(rawPages) ? rawPages : []);

          // 4. 读取与初始化阅读记录
          if (currentChildId) {
            const recordBody = isCustomBook
              ? { child_id: currentChildId, custom_book_id: bookId, total_pages: rawPages.length || 10 }
              : { child_id: currentChildId, episode_id: bookId, total_pages: rawPages.length || 10 };

            const recordRes = await fetch('/api/reading-records', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(recordBody),
            });
            const recordData = await recordRes.json();
            if (recordData.success && recordData.data?.pages_read) {
              const savedPage = recordData.data.pages_read;
              setCurrentPage(savedPage);
              lastSavedPageRef.current = savedPage;
            }
          }
        }
      } catch (err) {
        console.error('Failed to load book or reading record:', err);
      } finally {
        setLoading(false);
      }
    }

    if (bookId) {
      initBook();
    }
  }, [bookId]);

  // 5. 翻页时保存进度
  const handlePageChange = async (newPage: number) => {
    if (newPage < 1 || newPage > pages.length) return;
    setCurrentPage(newPage);

    if (!childId) return;

    const isCompleted = newPage === pages.length;

    try {
      const patchBody = bookType === 'custom'
        ? { child_id: childId, pages_read: newPage, completed: isCompleted }
        : { child_id: childId, pages_read: newPage, completed: isCompleted, episode_id: bookId };

      await fetch(`/api/reading-records/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      lastSavedPageRef.current = newPage;
    } catch (err) {
      console.error('Failed to update reading record:', err);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-screen text-gray-600">绘本加载中...</div>;
  }

  if (!book || pages.length === 0) {
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
        <h1 className="text-xl font-bold">{book.title || book.name || 'SRC 趣味中文绘本'}</h1>
        <span className="text-sm text-gray-500 font-medium">
          第 {currentPage} / {pages.length} 页
        </span>
      </div>

      <div className="w-full bg-white rounded-lg shadow-md p-6 flex flex-col items-center border">
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
      </div>

      <div className="flex gap-4 mt-6">
        <button
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="px-6 py-2 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 rounded-md font-medium"
        >
          上一页
        </button>
        <button
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage >= pages.length}
          className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-md font-medium"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
