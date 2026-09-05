"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function BookReaderPage() {
  const params = useParams();
  const router = useRouter();
  const [book, setBook] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/books/custom/${params.id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.data) {
          setBook(res.data);
        }
        setLoading(false);
      });
  }, [params.id]);

  if (loading) return <div className="p-8 text-center">加载中...</div>;
  if (!book) return <div className="p-8 text-center">绘本不存在</div>;

  const pages = book.pages_json || [];
  const page = pages[currentPage];
  const episode = book.episodes;

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-yellow-50">
      {/* Header */}
      <div className="bg-white shadow-sm p-4 flex items-center justify-between">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-600">
          <ArrowLeft size={20} />
          返回
        </button>
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-800">
            {episode?.series_name} {episode?.episode_number}
          </h1>
          <p className="text-sm text-gray-500">{episode?.episode_title}</p>
        </div>
        <div className="text-sm text-gray-500">
          {currentPage + 1} / {pages.length}
        </div>
      </div>

      {/* Book Page */}
      <div className="max-w-2xl mx-auto p-4">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Image - 16:9 原始比例，不裁切不拉伸 */}
          <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
            {page?.image_url ? (
              <img src={page.image_url} alt={`第${page.page_number}页`} className="w-full h-full object-contain" />
            ) : (
              <div className="text-gray-400">暂无图片</div>
            )}
          </div>
          {/* Text */}
          <div className="p-6 min-h-[120px] flex items-center justify-center">
            <p className="text-xl leading-relaxed text-gray-800 text-center" style={{ fontFamily: "KaiTi, STKaiti, 楷体, sans-serif" }}>
              {page?.adapted_text || page?.text || "暂无内容"}
            </p>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-6 gap-4">
          <button
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl bg-white shadow disabled:opacity-50"
          >
            <ArrowLeft size={20} />
            上一页
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.min(pages.length - 1, p + 1))}
            disabled={currentPage === pages.length - 1}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl bg-orange-500 text-white shadow disabled:opacity-50"
          >
            下一页
            <ArrowRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
