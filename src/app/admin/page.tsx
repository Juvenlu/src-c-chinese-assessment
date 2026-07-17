"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Database, Users, FileText, Upload, Trash2, Edit, Plus, LogOut, Eye } from "lucide-react";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import type { Level } from "@/lib/types";

const ADMIN_PASSWORD = "srcc2026";

type Tab = "questions" | "children" | "results" | "wordbank" | "books";

function AdminContent() {
  const [tab, setTab] = useState<Tab>("books");
  const [questions, setQuestions] = useState<any[]>([]);
  const [children, setChildren] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [wordBank, setWordBank] = useState<any[]>([]);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [selectedChild, setSelectedChild] = useState<any>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [newQuestion, setNewQuestion] = useState({
    level: "SRC300" as Level,
    character: "",
    word: "",
    sentence: "",
    meaning_question: "",
    options: ["", "", ""],
    answer: "",
    story_text: "",
    story_question: "",
    story_options: ["", "", ""],
    story_answer: "",
  });
  const [newEpisode, setNewEpisode] = useState({
    series_name: "西游记",
    episode_number: 1,
    episode_title: "",
    page_count: 10,
  });
  const [episodePages, setEpisodePages] = useState<any[]>([]);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [generating, setGenerating] = useState(false);
  const [customBooks, setCustomBooks] = useState<any[]>([]);

  useEffect(() => {
    if (tab === "questions") fetchQuestions();
    else if (tab === "children") fetchChildren();
    else if (tab === "results") fetchResults();
    else if (tab === "wordbank") fetchWordBank();
    else if (tab === "books") { fetchEpisodes(); fetchCustomBooks(); }
  }, [tab]);

  const fetchQuestions = async () => {
    const res = await fetch("/api/questions");
    const data = await res.json();
    setQuestions(data.data || []);
  };

  const fetchChildren = async () => {
    const res = await fetch("/api/children");
    const data = await res.json();
    setChildren(data.data || []);
  };

  const fetchResults = async () => {
    const res = await fetch("/api/results");
    const data = await res.json();
    setResults(data.data || []);
  };

  const fetchWordBank = async () => {
    const res = await fetch("/api/children");
    const childrenData = await res.json();
    const childrenList = childrenData.data || [];
    const wordBankData: any[] = [];
    for (const child of childrenList) {
      const res2 = await fetch(`/api/results?child_id=${child.id}`);
      const resultsData = await res2.json();
      const latest = resultsData.data?.[0];
      if (latest?.known_characters) {
        wordBankData.push({
          child_id: child.id,
          child_name: child.name,
          level: latest.level,
          known_count: latest.known_characters.length,
          known_characters: latest.known_characters,
        });
      }
    }
    setWordBank(wordBankData);
  };

  const fetchEpisodes = async () => {
    const res = await fetch("/api/books/episodes");
    const data = await res.json();
    setEpisodes(data.data || []);
  };

  const fetchCustomBooks = async () => {
    const res = await fetch("/api/books/custom?child_id=all");
    const data = await res.json();
    setCustomBooks(data.data || []);
  };

  const addQuestion = async () => {
    await fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newQuestion),
    });
    setNewQuestion({
      level: "SRC300",
      character: "",
      word: "",
      sentence: "",
      meaning_question: "",
      options: ["", "", ""],
      answer: "",
      story_text: "",
      story_question: "",
      story_options: ["", "", ""],
      story_answer: "",
    });
    fetchQuestions();
  };

  const updateQuestion = async () => {
    await fetch(`/api/questions?id=${editingQuestion.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingQuestion),
    });
    setEditingQuestion(null);
    fetchQuestions();
  };

  const deleteQuestion = async (id: string) => {
    await fetch(`/api/questions?id=${id}`, { method: "DELETE" });
    fetchQuestions();
  };

  const reseed = async () => {
    await fetch("/api/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    alert("题库已重新导入");
    fetchQuestions();
  };

  const addEpisode = async () => {
    const res = await fetch("/api/books/episodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newEpisode),
    });
    const data = await res.json();
    if (data.data) {
      setSelectedEpisode(data.data);
      setEpisodePages([]);
      setNewEpisode({ series_name: "西游记", episode_number: 1, episode_title: "", page_count: 10 });
      fetchEpisodes();
    }
  };

  const uploadPages = async () => {
    if (!selectedEpisode || imageFiles.length === 0) {
      alert("请先选择集并上传图片");
      return;
    }
    const formData = new FormData();
    imageFiles.forEach((f) => formData.append("images", f));
    if (wordFile) formData.append("word_file", wordFile);

    const res = await fetch(`/api/books/episodes/${selectedEpisode.id}/pages`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (data.data) {
      setEpisodePages(data.data);
      alert(`成功上传 ${data.data.length} 页`);
      setImageFiles([]);
      setWordFile(null);
    } else {
      alert("上传失败: " + data.error);
    }
  };

  const generateBook = async (childId: string, episodeId: string) => {
    setGenerating(true);
    const res = await fetch("/api/books/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ child_id: childId, episode_id: episodeId }),
    });
    const data = await res.json();
    setGenerating(false);
    if (data.data) {
      alert("绘本生成成功！");
      fetchCustomBooks();
    } else {
      alert("生成失败: " + data.error);
    }
  };

  const exportCSV = () => {
    const headers = ["child_id", "child_name", "level", "known_count", "known_characters"];
    const rows = wordBank.map((w) => [
      w.child_id,
      w.child_name,
      w.level,
      w.known_count,
      `"${w.known_characters.join(",")}"`,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "word_bank.csv";
    a.click();
  };

  const tabs = [
    { id: "books" as Tab, label: "绘本工坊", icon: BookOpen },
    { id: "questions" as Tab, label: "题库", icon: Database },
    { id: "children" as Tab, label: "用户", icon: Users },
    { id: "results" as Tab, label: "结果", icon: FileText },
    { id: "wordbank" as Tab, label: "识字字库", icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">SRC-C 管理后台</h1>
          <button
            onClick={() => { sessionStorage.removeItem("admin_auth"); window.location.href = "/"; }}
            className="flex items-center gap-2 text-gray-600 hover:text-red-600"
          >
            <LogOut size={18} />
            退出
          </button>
        </div>
        <div className="max-w-7xl mx-auto px-4 flex gap-2 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition ${
                tab === t.id ? "border-orange-500 text-orange-600" : "border-transparent text-gray-600"
              }`}
            >
              <t.icon size={18} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        {/* 绘本工坊 */}
        {tab === "books" && (
          <div className="space-y-6">
            {/* 创建新集 */}
            <div className="bg-white rounded-xl p-6 shadow">
              <h2 className="text-xl font-bold mb-4">创建新集</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <input
                  className="border rounded-lg px-3 py-2"
                  placeholder="系列名"
                  value={newEpisode.series_name}
                  onChange={(e) => setNewEpisode({ ...newEpisode, series_name: e.target.value })}
                />
                <input
                  className="border rounded-lg px-3 py-2"
                  placeholder="集数"
                  type="number"
                  value={newEpisode.episode_number}
                  onChange={(e) => setNewEpisode({ ...newEpisode, episode_number: parseInt(e.target.value) || 1 })}
                />
                <input
                  className="border rounded-lg px-3 py-2"
                  placeholder="标题"
                  value={newEpisode.episode_title}
                  onChange={(e) => setNewEpisode({ ...newEpisode, episode_title: e.target.value })}
                />
                <input
                  className="border rounded-lg px-3 py-2"
                  placeholder="页数"
                  type="number"
                  value={newEpisode.page_count}
                  onChange={(e) => setNewEpisode({ ...newEpisode, page_count: parseInt(e.target.value) || 10 })}
                />
              </div>
              <button onClick={addEpisode} className="mt-4 bg-orange-500 text-white px-6 py-2 rounded-lg flex items-center gap-2">
                <Plus size={18} /> 创建集
              </button>
            </div>

            {/* 集列表 */}
            <div className="bg-white rounded-xl p-6 shadow">
              <h2 className="text-xl font-bold mb-4">绘本集列表</h2>
              <div className="space-y-3">
                {episodes.map((ep) => (
                  <div key={ep.id} className="border rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <div className="font-bold">{ep.series_name} 第{ep.episode_number}集</div>
                      <div className="text-sm text-gray-500">{ep.episode_title} · {ep.page_count}页 · {ep.status}</div>
                    </div>
                    <button
                      onClick={() => { setSelectedEpisode(ep); fetch(`/api/books/episodes/${ep.id}/pages`).then(r => r.json()).then(d => setEpisodePages(d.data || [])); }}
                      className="text-blue-600 flex items-center gap-1"
                    >
                      <Edit size={16} /> 编辑
                    </button>
                  </div>
                ))}
                {episodes.length === 0 && <div className="text-gray-500">暂无绘本集</div>}
              </div>
            </div>

            {/* 编辑集内容 */}
            {selectedEpisode && (
              <div className="bg-white rounded-xl p-6 shadow">
                <h2 className="text-xl font-bold mb-4">
                  编辑: {selectedEpisode.series_name} 第{selectedEpisode.episode_number}集 - {selectedEpisode.episode_title}
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">上传插画（支持多张）</label>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => setImageFiles(Array.from(e.target.files || []))}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
                    />
                    {imageFiles.length > 0 && <div className="text-sm text-gray-500 mt-1">已选择 {imageFiles.length} 张图片</div>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">上传故事文本（Word 格式）</label>
                    <input
                      type="file"
                      accept=".docx,.doc"
                      onChange={(e) => setWordFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
                    />
                    {wordFile && <div className="text-sm text-gray-500 mt-1">已选择: {wordFile.name}</div>}
                  </div>
                  <button onClick={uploadPages} className="bg-green-500 text-white px-6 py-2 rounded-lg flex items-center gap-2">
                    <Upload size={18} /> 上传并解析
                  </button>
                </div>

                {/* 页列表 */}
                {episodePages.length > 0 && (
                  <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-4">
                    {episodePages.map((p) => (
                      <div key={p.id} className="border rounded-lg p-2">
                        <img src={p.image_url} alt={`第${p.page_number}页`} className="w-full h-32 object-cover rounded" />
                        <div className="text-xs mt-1 line-clamp-3">{p.original_text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 生成定制绘本 */}
            <div className="bg-white rounded-xl p-6 shadow">
              <h2 className="text-xl font-bold mb-4">生成定制绘本</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">选择孩子</label>
                  <select
                    className="border rounded-lg px-3 py-2 w-full"
                    onChange={(e) => setSelectedChild(children.find((c) => c.id === e.target.value))}
                  >
                    <option value="">请选择</option>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.age}岁)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">选择绘本集</label>
                  <select
                    className="border rounded-lg px-3 py-2 w-full"
                    onChange={(e) => setSelectedEpisode(episodes.find((ep) => ep.id === e.target.value))}
                  >
                    <option value="">请选择</option>
                    {episodes.map((ep) => (
                      <option key={ep.id} value={ep.id}>{ep.series_name} 第{ep.episode_number}集 - {ep.episode_title}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => selectedChild && selectedEpisode && generateBook(selectedChild.id, selectedEpisode.id)}
                  disabled={generating || !selectedChild || !selectedEpisode}
                  className="bg-purple-500 text-white px-6 py-2 rounded-lg disabled:opacity-50"
                >
                  {generating ? "生成中..." : "生成定制绘本"}
                </button>
              </div>
            </div>

            {/* 已生成绘本列表 */}
            <div className="bg-white rounded-xl p-6 shadow">
              <h2 className="text-xl font-bold mb-4">已生成绘本</h2>
              <div className="space-y-3">
                {customBooks.map((b) => (
                  <div key={b.id} className="border rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <div className="font-bold">{b.episodes?.series_name} 第{b.episodes?.episode_number}集</div>
                      <div className="text-sm text-gray-500">
                        {b.children?.name || b.child_id} · {b.level_tier} · {new Date(b.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <a href={`/book/${b.id}`} target="_blank" className="text-blue-600 flex items-center gap-1">
                      <Eye size={16} /> 阅读
                    </a>
                  </div>
                ))}
                {customBooks.length === 0 && <div className="text-gray-500">暂无已生成绘本</div>}
              </div>
            </div>
          </div>
        )}

        {/* 题库 */}
        {tab === "questions" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl p-6 shadow">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">题库管理 ({questions.length} 题)</h2>
                <button onClick={reseed} className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm">
                  重新导入题库
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">等级</th>
                      <th className="px-3 py-2 text-left">字</th>
                      <th className="px-3 py-2 text-left">词</th>
                      <th className="px-3 py-2 text-left">句</th>
                      <th className="px-3 py-2 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((q) => (
                      <tr key={q.id} className="border-t">
                        <td className="px-3 py-2">{q.level}</td>
                        <td className="px-3 py-2">{q.character}</td>
                        <td className="px-3 py-2">{q.word}</td>
                        <td className="px-3 py-2 truncate max-w-xs">{q.sentence}</td>
                        <td className="px-3 py-2 flex gap-2">
                          <button onClick={() => setEditingQuestion(q)} className="text-blue-600"><Edit size={16} /></button>
                          <button onClick={() => deleteQuestion(q.id)} className="text-red-600"><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {editingQuestion && (
              <div className="bg-white rounded-xl p-6 shadow">
                <h3 className="text-lg font-bold mb-4">编辑题目</h3>
                <div className="grid grid-cols-2 gap-4">
                  <input className="border rounded px-3 py-2" value={editingQuestion.character} onChange={(e) => setEditingQuestion({ ...editingQuestion, character: e.target.value })} placeholder="字" />
                  <input className="border rounded px-3 py-2" value={editingQuestion.word} onChange={(e) => setEditingQuestion({ ...editingQuestion, word: e.target.value })} placeholder="词" />
                  <input className="border rounded px-3 py-2 col-span-2" value={editingQuestion.sentence} onChange={(e) => setEditingQuestion({ ...editingQuestion, sentence: e.target.value })} placeholder="句" />
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={updateQuestion} className="bg-green-500 text-white px-4 py-2 rounded">保存</button>
                  <button onClick={() => setEditingQuestion(null)} className="bg-gray-300 px-4 py-2 rounded">取消</button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl p-6 shadow">
              <h3 className="text-lg font-bold mb-4">添加新题</h3>
              <div className="grid grid-cols-2 gap-4">
                <select className="border rounded px-3 py-2" value={newQuestion.level} onChange={(e) => setNewQuestion({ ...newQuestion, level: e.target.value as Level })}>
                  <option value="SRC300">SRC300</option>
                  <option value="SRC500">SRC500</option>
                  <option value="SRC800">SRC800</option>
                </select>
                <input className="border rounded px-3 py-2" value={newQuestion.character} onChange={(e) => setNewQuestion({ ...newQuestion, character: e.target.value })} placeholder="字" />
                <input className="border rounded px-3 py-2" value={newQuestion.word} onChange={(e) => setNewQuestion({ ...newQuestion, word: e.target.value })} placeholder="词" />
                <input className="border rounded px-3 py-2 col-span-2" value={newQuestion.sentence} onChange={(e) => setNewQuestion({ ...newQuestion, sentence: e.target.value })} placeholder="句" />
              </div>
              <button onClick={addQuestion} className="mt-4 bg-orange-500 text-white px-4 py-2 rounded">添加</button>
            </div>
          </div>
        )}

        {/* 用户 */}
        {tab === "children" && (
          <div className="bg-white rounded-xl p-6 shadow">
            <h2 className="text-xl font-bold mb-4">用户列表 ({children.length})</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr><th className="px-3 py-2 text-left">姓名</th><th className="px-3 py-2 text-left">年龄</th><th className="px-3 py-2 text-left">年级</th><th className="px-3 py-2 text-left">国家</th><th className="px-3 py-2 text-left">语言环境</th></tr>
              </thead>
              <tbody>
                {children.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">{c.age}</td>
                    <td className="px-3 py-2">{c.grade}</td>
                    <td className="px-3 py-2">{c.country}</td>
                    <td className="px-3 py-2">{c.language_env}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 结果 */}
        {tab === "results" && (
          <div className="bg-white rounded-xl p-6 shadow">
            <h2 className="text-xl font-bold mb-4">测试结果 ({results.length})</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr><th className="px-3 py-2 text-left">孩子</th><th className="px-3 py-2 text-left">等级</th><th className="px-3 py-2 text-left">识字量</th><th className="px-3 py-2 text-left">词汇量</th><th className="px-3 py-2 text-left">得分</th><th className="px-3 py-2 text-left">用时</th></tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">{r.child_name || r.child_id}</td>
                    <td className="px-3 py-2">{r.level}</td>
                    <td className="px-3 py-2">{r.stable_char_count}</td>
                    <td className="px-3 py-2">{r.stable_vocab_count}</td>
                    <td className="px-3 py-2">{r.total_score}</td>
                    <td className="px-3 py-2">{Math.floor((r.completion_time_seconds || 0) / 60)}:{String((r.completion_time_seconds || 0) % 60).padStart(2, "0")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 识字字库 */}
        {tab === "wordbank" && (
          <div className="bg-white rounded-xl p-6 shadow">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">识字字库 ({wordBank.length} 个孩子)</h2>
              <button onClick={exportCSV} className="bg-green-500 text-white px-4 py-2 rounded-lg flex items-center gap-2">
                <Upload size={18} /> 导出 CSV
              </button>
            </div>
            <div className="space-y-4">
              {wordBank.map((w) => (
                <div key={w.child_id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-bold text-lg">{w.child_name}</span>
                      <span className="text-gray-500 ml-2">({w.level})</span>
                    </div>
                    <span className="text-orange-600 font-bold">认识 {w.known_count} 字</span>
                  </div>
                  <div className="text-sm text-gray-600 leading-relaxed" style={{ fontFamily: "KaiTi, STKaiti, 楷体, sans-serif" }}>
                    {w.known_characters.join(" ")}
                  </div>
                </div>
              ))}
              {wordBank.length === 0 && <div className="text-gray-500">暂无数据，请先完成逐字测试</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("admin_auth") === "1") {
      setAuthed(true);
    }
  }, []);

  const handleLogin = () => {
    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem("admin_auth", "1");
      setAuthed(true);
      setError("");
    } else {
      setError("密码错误");
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-lg w-96">
          <h1 className="text-2xl font-bold mb-6 text-center">管理员登录</h1>
          <input
            type="password"
            className="w-full border rounded-lg px-4 py-3 mb-4"
            placeholder="请输入管理员密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
          {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
          <button onClick={handleLogin} className="w-full bg-orange-500 text-white py-3 rounded-lg font-bold">
            登录
          </button>
        </div>
      </div>
    );
  }

  return <AdminContent />;
}
