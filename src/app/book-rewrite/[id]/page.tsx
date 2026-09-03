"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/**
 * 绘本改写版本阅读页（孩子端）
 * 路径：/book-rewrite/[id]
 * 用于阅读 AI 改写的 i+1 定制版本
 * 权限：必须登录，且只能阅读属于当前孩子的绘本
 */
export default function BookRewriteReaderPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [book, setBook] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    fetch(`/api/books/rewrite/${params.id}/public`)
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((res) => {
        // public API 直接返回 rewrite 对象（无 data 字段包裹）
        if (res && res.id) {
          setBook(res);
        }
        setLoading(false);
      });
  }, [params.id, user, authLoading, router]);

  if (authLoading || loading) return <div className="p-8 text-center">加载中...</div>;
  if (!book) return <div className="p-8 text-center">绘本不存在</div>;

  const pages = book.pages || [];
  const page = pages[currentPage];
  const episode = book.episode;

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
          <p className="text-sm text-gray-500">
            {episode?.episode_title} · {book.target_level}
          </p>
        </div>
        <div className="text-sm text-gray-500">
          {currentPage + 1} / {pages.length}
        </div>
      </div>

      {/* Book Page */}
      <div className="max-w-2xl mx-auto p-4">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Image */}
          <div className="aspect-square bg-gray-100 flex items-center justify-center">
            {page?.image_url ? (
              <img src={page.image_url} alt={`第${page.page}页`} className="w-full h-full object-cover" />
            ) : (
              <div className="text-gray-400">暂无图片</div>
            )}
          </div>
          {/* Frontier 标签 */}
          {page?.frontier && page.frontier.length > 0 && (
            <div className="px-6 pt-4 flex flex-wrap gap-2">
              {page.frontier.map((f: string, i: number) => (
                <span key={i} className="text-xs px-2 py-1 bg-teal-100 text-teal-700 rounded-full">
                  🌟 {f}
                </span>
              ))}
            </div>
          )}
          {/* Text */}
          <div className="p-6 min-h-[140px] flex items-center justify-center">
            <p className="text-xl leading-relaxed text-gray-800 text-center" style={{ fontFamily: "KaiTi, STKaiti, 楷体, sans-serif" }}>
              {page?.text || "暂无内容"}
            </p>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-6 gap-4">
          <button
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl bg-white shadow disabled:opacity-50 hover:shadow-md transition-shadow"
          >
            <ArrowLeft size={20} />
            上一页
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.min(pages.length - 1, p + 1))}
            disabled={currentPage === pages.length - 1}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl bg-[var(--color-src-primary)] text-white shadow disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            下一页
            <ArrowRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
