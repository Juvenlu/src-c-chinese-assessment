"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";

const SERIES = [
  { id: "xiyouji", name: "西游记系列", icon: "🐵", color: "from-orange-400 to-red-400" },
  { id: "harrypotter", name: "哈利波特系列", icon: "🧙", color: "from-purple-400 to-blue-400" },
  { id: "traditional", name: "传统/成语故事系列", icon: "🏮", color: "from-red-400 to-yellow-400" },
];

function BookSelectContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const childId = searchParams.get("childId") || "";
  const [child, setChild] = useState<any>(null);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [customBooks, setCustomBooks] = useState<any[]>([]);

  useEffect(() => {
    if (childId) {
      fetch(`/api/children?id=${childId}`).then(r => r.json()).then(d => setChild(d.data?.[0]));
      fetch(`/api/books/custom?child_id=${childId}`).then(r => r.json()).then(d => setCustomBooks(d.data || []));
    }
    fetch("/api/books/episodes").then(r => r.json()).then(d => setEpisodes(d.data || []));
  }, [childId]);

  const filteredEpisodes = selectedSeries
    ? episodes.filter((ep) => ep.series_name === SERIES.find((s) => s.id === selectedSeries)?.name)
    : [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-yellow-50">
      {/* Header */}
      <div className="bg-white shadow-sm p-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button onClick={() => router.back()} className="text-gray-600">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-display text-gray-800">📚 绘本图书馆</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-6">
        {/* 孩子信息 */}
        {child && (
          <div className="bg-white rounded-2xl p-4 shadow">
            <div className="text-sm text-gray-500">为</div>
            <div className="text-xl font-bold text-gray-800">{child.name}</div>
            <div className="text-sm text-gray-500">{child.age}岁 · {child.grade}年级</div>
          </div>
        )}

        {/* 已生成的绘本 */}
        {customBooks.length > 0 && (
          <div className="bg-white rounded-2xl p-6 shadow">
            <h2 className="text-lg font-bold mb-4">📖 我的绘本</h2>
            <div className="space-y-3">
              {customBooks.map((book) => (
                <a
                  key={book.id}
                  href={`/book/${book.id}`}
                  target="_blank"
                  className="block border rounded-xl p-4 hover:shadow-md transition"
                >
                  <div className="font-bold">{book.episodes?.series_name} 第{book.episodes?.episode_number}集</div>
                  <div className="text-sm text-gray-500">{book.episodes?.episode_title}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {book.level_tier} · {new Date(book.created_at).toLocaleDateString()}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* 系列选择 */}
        {!selectedSeries ? (
          <div>
            <h2 className="text-lg font-bold mb-4">选择绘本系列</h2>
            <div className="grid grid-cols-1 gap-4">
              {SERIES.map((series) => (
                <button
                  key={series.id}
                  onClick={() => setSelectedSeries(series.id)}
                  className={`bg-gradient-to-r ${series.color} text-white rounded-2xl p-6 shadow-lg hover:scale-105 transition`}
                >
                  <div className="text-4xl mb-2">{series.icon}</div>
                  <div className="text-xl font-bold">{series.name}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-4 mb-4">
              <button onClick={() => setSelectedSeries(null)} className="text-gray-600">
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-lg font-bold">
                {SERIES.find((s) => s.id === selectedSeries)?.name}
              </h2>
            </div>
            <div className="space-y-3">
              {filteredEpisodes.map((ep) => (
                <div key={ep.id} className="bg-white rounded-xl p-4 shadow flex items-center justify-between">
                  <div>
                    <div className="font-bold">第{ep.episode_number}集</div>
                    <div className="text-sm text-gray-500">{ep.episode_title}</div>
                  </div>
                  <button className="bg-orange-500 text-white px-4 py-2 rounded-lg flex items-center gap-2">
                    <BookOpen size={16} /> 阅读
                  </button>
                </div>
              ))}
              {filteredEpisodes.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  该系列暂无绘本，请联系管理员添加
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BookSelectPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-5xl animate-bounce">📚</div>
      </div>
    }>
      <BookSelectContent />
    </Suspense>
  );
}
