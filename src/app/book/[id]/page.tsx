'use client';

import { useState, useEffect, useRef, use } from 'react';

interface EpisodePage {
  page_number: number;
  image_url: string;
  text_content: string;
}

export default function BookReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const customBookId = parseInt(id, 10);

  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<EpisodePage[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [childId, setChildId] = useState<number | null>(null);

  const lastSavedPageRef = useRef<number>(1);

  // 1. 加载 Custom Book 详情与当前用户孩子信息
  useEffect(() => {
    async function initBook() {
      try {
        setLoading(true);

        // 获取当前激活的孩子 ID
        const activeChildRes = await fetch('/api/children');
        const activeChildData = await activeChildRes.json();
        let currentChildId = null;
        if (activeChildData.success && activeChildData.data?.length > 0) {
          currentChildId = activeChildData.data[0].id;
          setChildId(currentChildId);
        }

        // 统一从 /api/books/custom/[customBookId] 获取绘本详情
        const res = await fetch(`/api/books/custom/${customBookId}`);
        const data = await res.json();

        if (data.success && data.data) {
          setBook(data.data);
          const parsedPages = typeof data.data.pages_json === 'string'
            ? JSON.parse(data.data.pages_json)
            : data.data.pages_json || [];
          setPages(parsedPages);

          // 获取或初始化阅读记录 (恢复历史进度)
          if (currentChildId) {
            const recordRes = await fetch('/api/reading-records', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                child_id: currentChildId,
                custom_book_id: customBookId,
                total_pages: parsedPages.length || 10,
              }),
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

    if (customBookId) {
      initBook();
    }
  }, [customBookId]);

  // 2. 翻页时保存进度
  const handlePageChange = async (newPage: number) => {
    if (newPage < 1 || newPage > pages.length) return;
    setCurrentPage(newPage);

    if (!childId) return;

    const isCompleted = newPage === pages.length;

    // 向后端保存进度
    try {
      await fetch(`/api/reading-records/${customBookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_id: childId,
          pages_read: newPage,
          completed: isCompleted,
        }),
      });
      lastSavedPageRef.current = newPage;
    } catch (err) {
      console.error('Failed to update reading record:', err);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-screen">绘本加载中...</div>;
  }

  if (!book || pages.length === 0) {
    return <div className="flex justify-center items-center h-screen">未找到绘本内容</div>;
  }

  const currentPageData = pages[currentPage - 1];

  return (
    <div className="max-w-4xl mx-auto p-4 flex flex-col items-center min-h-screen">
      <div className="w-full flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">{book.title || 'SRC 趣味中文绘本'}</h1>
        <span className="text-sm text-gray-500">
          第 {currentPage} / {pages.length} 页
        </span>
      </div>

      {currentPageData && (
        <div className="w-full bg-white rounded-lg shadow-md p-6 flex flex-col items-center border">
          <img
            src={currentPageData.image_url}
            alt={`Page ${currentPage}`}
            className="max-h-[500px] object-contain rounded-md mb-6"
          />
          <p className="text-lg text-gray-800 leading-relaxed text-center font-medium max-w-2xl">
            {currentPageData.text_content}
          </p>
        </div>
      )}

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
