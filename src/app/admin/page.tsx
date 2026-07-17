'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { QuestionItem, Child, TestResult, Level } from '@/lib/types';

type AdminTab = 'results' | 'charlib' | 'users' | 'questions' | 'books';

const ADMIN_PASSWORD = 'srcc2026';

function AdminContent() {
  const [tab, setTab] = useState<AdminTab>('results');
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [charLibData, setCharLibData] = useState<Record<string, string[]>>({});
  
  // Book-related states
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [customBooks, setCustomBooks] = useState<any[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [episodePages, setEpisodePages] = useState<any[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [newEpisode, setNewEpisode] = useState({
    series_name: '西游记',
    episode_number: 1,
    episode_title: '',
    page_count: 10,
  });
  const [generating, setGenerating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, cRes, rRes] = await Promise.all([
        fetch(`/api/questions${filterLevel ? `?level=${filterLevel}` : ''}`),
        fetch('/api/children'),
        fetch('/api/results'),
      ]);

      const qData = await qRes.json();
      const cData = await cRes.json();
      const rData = await rRes.json();

      if (qData.data) setQuestions(qData.data);
      if (cData.data) setChildren(cData.data);
      if (rData.data) setResults(rData.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filterLevel]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (tab === 'books') {
      fetchEpisodes();
      fetchCustomBooks();
    }
  }, [tab]);

  useEffect(() => {
    const lib: Record<string, string[]> = {};
    results.forEach((r) => {
      if (r.known_characters && r.known_characters.length > 0) {
        if (!lib[r.child_id]) lib[r.child_id] = [];
        const existing = new Set(lib[r.child_id]);
        r.known_characters.forEach((c) => {
          if (!existing.has(c)) {
            lib[r.child_id].push(c);
            existing.add(c);
          }
        });
      }
    });
    setCharLibData(lib);
  }, [results]);

  const fetchEpisodes = async () => {
    const res = await fetch('/api/books/episodes');
    const data = await res.json();
    setEpisodes(data.data || []);
  };

  const fetchCustomBooks = async () => {
    const res = await fetch('/api/books/custom?child_id=all');
    const data = await res.json();
    setCustomBooks(data.data || []);
  };

  const handleSeedQuestions = async () => {
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      const data = await res.json();
      alert(data.message || data.error);
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (!confirm('确定要删除这道题吗？')) return;
    try {
      await fetch(`/api/questions?id=${id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddEpisode = async () => {
    try {
      const res = await fetch('/api/books/episodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEpisode),
      });
      const data = await res.json();
      if (data.data) {
        alert('绘本集创建成功！');
        setNewEpisode({ series_name: '西游记', episode_number: newEpisode.episode_number + 1, episode_title: '', page_count: 10 });
        // 重新获取列表并自动选中新创建的绘本集
        const res2 = await fetch('/api/books/episodes');
        const data2 = await res2.json();
        setEpisodes(data2.data || []);
        if (data2.data && data2.data.length > 0) {
          setSelectedEpisode(data2.data[data2.data.length - 1]); // 选中最后一个（刚创建的）
        }
      }
    } catch (err) {
      console.error(err);
      alert('创建失败');
    }
  };

  const handleUploadPages = async () => {
    if (!selectedEpisode || imageFiles.length === 0) {
      alert('请先选择绘本集并上传图片');
      return;
    }

    const formData = new FormData();
    imageFiles.forEach((f) => formData.append('images', f));
    if (wordFile) formData.append('word_file', wordFile);

    try {
      const res = await fetch(`/api/books/episodes/${selectedEpisode.id}/pages`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.data) {
        alert(`成功上传 ${data.data.length} 页`);
        setEpisodePages(data.data);
        setImageFiles([]);
        setWordFile(null);
      } else {
        alert('上传失败: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('上传失败');
    }
  };

  const handleGenerateBook = async (childId: string, episodeId: string) => {
    setGenerating(true);
    try {
      const res = await fetch('/api/books/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_id: childId, episode_id: episodeId }),
      });
      const data = await res.json();
      if (data.data) {
        alert('绘本生成成功！');
        fetchCustomBooks();
      } else {
        alert('生成失败: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleExportCSV = () => {
    const headers = ['child_id', 'child_name', 'level', 'known_count', 'known_characters'];
    const rows = Object.entries(charLibData).map(([childId, chars]) => {
      const child = children.find((c) => c.id === childId);
      const result = results.find((r) => r.child_id === childId);
      return [
        childId,
        child?.name || '',
        result?.level || '',
        chars.length,
        `"${chars.join(',')}"`,
      ];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'word_bank.csv';
    a.click();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Admin header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="font-display text-2xl text-gray-800">SRC-C 管理后台</h1>
              <p className="text-sm text-gray-500">题库管理 · 用户数据 · 测试结果 · 识字字库 · 绘本工坊</p>
            </div>
            <Link href="/" className="text-sm text-[var(--color-src-primary)] hover:underline">
              ← 返回前台
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {([
            { key: 'results', label: '📊 测试结果' },
            { key: 'charlib', label: '📖 识字字库' },
            { key: 'users', label: '👥 用户数据' },
            { key: 'questions', label: '📚 题库管理' },
            { key: 'books', label: '📚 绘本工坊' },
          ] as { key: AdminTab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-[var(--color-src-primary)] text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-500">加载中...</div>
        ) : (
          <>
            {/* Results Tab */}
            {tab === 'results' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-sm text-gray-500">共 {results.length} 条记录</span>
                  <button
                    onClick={handleExportCSV}
                    className="px-4 py-2 bg-[var(--color-src-secondary)] text-white rounded-lg text-sm hover:opacity-90"
                  >
                    导出 CSV
                  </button>
                </div>
                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-3 text-gray-600">日期</th>
                          <th className="text-left px-4 py-3 text-gray-600">姓名</th>
                          <th className="text-left px-4 py-3 text-gray-600">等级</th>
                          <th className="text-right px-4 py-3 text-gray-600">识字量</th>
                          <th className="text-right px-4 py-3 text-gray-600">词汇量</th>
                          <th className="text-right px-4 py-3 text-gray-600">得分</th>
                          <th className="text-right px-4 py-3 text-gray-600">用时</th>
                          <th className="text-center px-4 py-3 text-gray-600">字库</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((r) => {
                          const child = children.find((c) => c.id === r.child_id);
                          const childName = child?.name || r.child_id.slice(0, 8);
                          const hasLib = r.known_characters && r.known_characters.length > 0;
                          const minutes = Math.floor((r.completion_time_seconds || 0) / 60);
                          const seconds = (r.completion_time_seconds || 0) % 60;

                          return (
                            <tr key={r.id} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-3 text-gray-500">
                                {new Date(r.created_at).toLocaleDateString('zh-CN')}
                              </td>
                              <td className="px-4 py-3 font-medium">{childName}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  r.level === 'SRC300' ? 'bg-green-100 text-green-700' :
                                  r.level === 'SRC500' ? 'bg-blue-100 text-blue-700' :
                                  'bg-purple-100 text-purple-700'
                                }`}>
                                  {r.level}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-[var(--color-src-primary)]">
                                {r.stable_char_count}
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-[var(--color-src-secondary)]">
                                {r.stable_vocab_count}
                              </td>
                              <td className="px-4 py-3 text-right font-bold">{r.total_score}</td>
                              <td className="px-4 py-3 text-right text-gray-500">
                                {minutes}:{seconds.toString().padStart(2, '0')}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {hasLib ? (
                                  <button
                                    onClick={() => { setSelectedChildId(r.child_id); setTab('charlib'); }}
                                    className="text-[var(--color-src-secondary)] hover:underline text-xs"
                                  >
                                    查看({r.known_characters!.length}字)
                                  </button>
                                ) : (
                                  <span className="text-gray-400 text-xs">无</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Character Library Tab */}
            {tab === 'charlib' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-sm text-gray-500">共 {Object.keys(charLibData).length} 个字库</span>
                  <button
                    onClick={handleExportCSV}
                    className="px-4 py-2 bg-[var(--color-src-secondary)] text-white rounded-lg text-sm hover:opacity-90"
                  >
                    导出 CSV
                  </button>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <div className="mb-4">
                    <label className="text-sm text-gray-600 mr-2">选择孩子：</label>
                    <select
                      value={selectedChildId}
                      onChange={(e) => setSelectedChildId(e.target.value)}
                      className="px-3 py-2 border rounded-lg text-sm"
                    >
                      <option value="">请选择</option>
                      {Object.entries(charLibData).map(([childId, chars]) => {
                        const child = children.find((c) => c.id === childId);
                        const charCount = chars.length;
                        return (
                          <option key={childId} value={childId}>
                            {child?.name} ({charCount}字)
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {selectedChildId && (
                    <div className="space-y-4">
                      {(() => {
                        const child = children.find((c) => c.id === selectedChildId);
                        const chars = charLibData[selectedChildId] || [];
                        const childResults = results.filter((r) => r.child_id === selectedChildId);
                        return (
                          <>
                            <div className="bg-white rounded-xl shadow-sm p-6">
                              <div className="flex justify-between items-start mb-4">
                                <div>
                                  <h3 className="text-xl font-bold text-gray-800">{child?.name}</h3>
                                  <p className="text-sm text-gray-500">
                                    {child?.age}岁 · {child?.grade} · {child?.country} · 
                                    {child?.language_env === 'chinese_primary' ? '中文为主' :
                                     child?.language_env === 'bilingual' ? '双语' :
                                     child?.language_env === 'english_primary' ? '英文为主' : '其他'}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <div className="text-3xl font-bold text-[var(--color-src-primary)]">{chars.length}</div>
                                  <div className="text-xs text-gray-500">认识汉字数</div>
                                </div>
                              </div>
                              
                              {chars.length > 0 ? (
                                <>
                                  <div className="mb-3 text-sm font-medium text-gray-700">
                                    确认识字字库（{chars.length}字）
                                  </div>
                                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                                    <div className="text-lg leading-relaxed" style={{ fontFamily: 'KaiTi, STKaiti, 楷体, serif' }}>
                                      {chars.join(' ')}
                                    </div>
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    基于 {childResults.length} 次测试结果汇总
                                  </div>
                                </>
                              ) : (
                                <div className="text-center py-8 text-gray-400">
                                  暂无字库数据，请先完成逐字测试
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Users Tab */}
            {tab === 'users' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-sm text-gray-500">共 {children.length} 个用户</span>
                </div>
                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-3 text-gray-600">姓名</th>
                          <th className="text-left px-4 py-3 text-gray-600">年龄</th>
                          <th className="text-left px-4 py-3 text-gray-600">年级</th>
                          <th className="text-left px-4 py-3 text-gray-600">国家</th>
                          <th className="text-left px-4 py-3 text-gray-600">语言环境</th>
                          <th className="text-left px-4 py-3 text-gray-600">测试次数</th>
                          <th className="text-left px-4 py-3 text-gray-600">注册时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {children.map((c) => {
                          const testCount = results.filter((r) => r.child_id === c.id).length;
                          const charCount = charLibData[c.id]?.length || 0;
                          return (
                            <tr key={c.id} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium">{c.name}</td>
                              <td className="px-4 py-3">{c.age}</td>
                              <td className="px-4 py-3">{c.grade}</td>
                              <td className="px-4 py-3">{c.country}</td>
                              <td className="px-4 py-3">
                                {c.language_env === 'chinese_primary' ? '中文为主' :
                                 c.language_env === 'bilingual' ? '双语' :
                                 c.language_env === 'english_primary' ? '英文为主' : '其他'}
                              </td>
                              <td className="px-4 py-3">
                                {testCount > 0 ? (
                                  <span className="text-[var(--color-src-secondary)]">{testCount}次</span>
                                ) : (
                                  <span className="text-gray-400">未测试</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-gray-500">
                                {new Date(c.created_at).toLocaleDateString('zh-CN')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Questions Tab */}
            {tab === 'questions' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <div className="flex gap-2 items-center">
                    <select
                      value={filterLevel}
                      onChange={(e) => setFilterLevel(e.target.value)}
                      className="px-3 py-2 border rounded-lg text-sm"
                    >
                      <option value="">全部等级</option>
                      <option value="SRC300">SRC300</option>
                      <option value="SRC500">SRC500</option>
                      <option value="SRC800">SRC800</option>
                    </select>
                    <span className="text-sm text-gray-500">共 {questions.length} 道题</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSeedQuestions}
                      className="px-4 py-2 bg-[var(--color-src-secondary)] text-white rounded-lg text-sm hover:opacity-90"
                    >
                      导入默认题库
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-3 text-gray-600">字</th>
                          <th className="text-left px-4 py-3 text-gray-600">词</th>
                          <th className="text-left px-4 py-3 text-gray-600">等级</th>
                          <th className="text-left px-4 py-3 text-gray-600">句子</th>
                          <th className="text-left px-4 py-3 text-gray-600">问题</th>
                          <th className="text-left px-4 py-3 text-gray-600">答案</th>
                          <th className="text-right px-4 py-3 text-gray-600">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {questions.slice(0, 50).map((q) => (
                          <tr key={q.id} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-bold text-lg">{q.character}</td>
                            <td className="px-4 py-3">{q.word}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                q.level === 'SRC300' ? 'bg-green-100 text-green-700' :
                                q.level === 'SRC500' ? 'bg-blue-100 text-blue-700' :
                                'bg-purple-100 text-purple-700'
                              }`}>
                                {q.level}
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-40 truncate">{q.sentence}</td>
                            <td className="px-4 py-3 max-w-32 truncate">{q.meaning_question}</td>
                            <td className="px-4 py-3">{q.answer}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleDeleteQuestion(q.id)}
                                className="text-red-500 hover:underline"
                              >
                                删除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {questions.length > 50 && (
                    <div className="px-4 py-3 text-center text-sm text-gray-500">
                      显示前50条，共 {questions.length} 条
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Books Tab */}
            {tab === 'books' && (
              <div className="space-y-6">
                {/* Create Episode */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h2 className="font-display text-xl text-gray-800 mb-4">创建新绘本集</h2>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <input
                      className="px-3 py-2 border rounded-lg text-sm"
                      placeholder="系列名"
                      value={newEpisode.series_name}
                      onChange={(e) => setNewEpisode({ ...newEpisode, series_name: e.target.value })}
                    />
                    <input
                      className="px-3 py-2 border rounded-lg text-sm"
                      placeholder="集数"
                      type="number"
                      value={newEpisode.episode_number}
                      onChange={(e) => setNewEpisode({ ...newEpisode, episode_number: parseInt(e.target.value) || 1 })}
                    />
                    <input
                      className="px-3 py-2 border rounded-lg text-sm"
                      placeholder="标题"
                      value={newEpisode.episode_title}
                      onChange={(e) => setNewEpisode({ ...newEpisode, episode_title: e.target.value })}
                    />
                    <input
                      className="px-3 py-2 border rounded-lg text-sm"
                      placeholder="页数"
                      type="number"
                      value={newEpisode.page_count}
                      onChange={(e) => setNewEpisode({ ...newEpisode, page_count: parseInt(e.target.value) || 10 })}
                    />
                  </div>
                  <button
                    onClick={handleAddEpisode}
                    className="px-6 py-2 bg-[var(--color-src-primary)] text-white rounded-lg hover:opacity-90"
                  >
                    创建绘本集
                  </button>
                </div>

                {/* Episode List */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h2 className="font-display text-xl text-gray-800 mb-4">绘本集列表</h2>
                  <div className="space-y-3">
                    {episodes.map((ep) => (
                      <div key={ep.id} className="border rounded-lg p-4 flex items-center justify-between hover:bg-gray-50">
                        <div>
                          <div className="font-bold">{ep.series_name} 第{ep.episode_number}集</div>
                          <div className="text-sm text-gray-500">{ep.episode_title} · {ep.page_count}页 · {ep.status}</div>
                        </div>
                        <button
                          onClick={() => { setSelectedEpisode(ep); setEpisodePages([]); }}
                          className="text-[var(--color-src-primary)] hover:underline"
                        >
                          上传内容
                        </button>
                      </div>
                    ))}
                    {episodes.length === 0 && <div className="text-gray-500">暂无绘本集</div>}
                  </div>
                </div>

                {/* Upload Pages */}
                {selectedEpisode && (
                  <div className="bg-white rounded-xl shadow-sm p-6">
                    <h2 className="font-display text-xl text-gray-800 mb-4">
                      上传内容: {selectedEpisode.series_name} 第{selectedEpisode.episode_number}集
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
                      <button
                        onClick={handleUploadPages}
                        className="px-6 py-2 bg-[var(--color-src-secondary)] text-white rounded-lg hover:opacity-90"
                      >
                        上传并解析
                      </button>
                    </div>

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

                {/* Generate Custom Book */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h2 className="font-display text-xl text-gray-800 mb-4">生成定制绘本</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">选择孩子</label>
                      <select
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        onChange={(e) => {
                          const child = children.find((c) => c.id === e.target.value);
                          if (child) setSelectedChildId(child.id);
                        }}
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
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        onChange={(e) => setSelectedEpisode(episodes.find((ep) => ep.id === e.target.value))}
                      >
                        <option value="">请选择</option>
                        {episodes.map((ep) => (
                          <option key={ep.id} value={ep.id}>{ep.series_name} 第{ep.episode_number}集 - {ep.episode_title}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => selectedChildId && selectedEpisode && handleGenerateBook(selectedChildId, selectedEpisode.id)}
                      disabled={generating || !selectedChildId || !selectedEpisode}
                      className="px-6 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50 hover:opacity-90"
                    >
                      {generating ? '生成中...' : '生成定制绘本'}
                    </button>
                  </div>
                </div>

                {/* Custom Books List */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h2 className="font-display text-xl text-gray-800 mb-4">已生成绘本</h2>
                  <div className="space-y-3">
                    {customBooks.map((b) => (
                      <div key={b.id} className="border rounded-lg p-4 flex items-center justify-between hover:bg-gray-50">
                        <div>
                          <div className="font-bold">{b.episodes?.series_name} 第{b.episodes?.episode_number}集</div>
                          <div className="text-sm text-gray-500">
                            {b.children?.name || b.child_id} · {b.level_tier} · {new Date(b.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        <a href={`/book/${b.id}`} target="_blank" className="text-[var(--color-src-primary)] hover:underline">
                          阅读
                        </a>
                      </div>
                    ))}
                    {customBooks.length === 0 && <div className="text-gray-500">暂无已生成绘本</div>}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('admin_auth') === '1') {
      setAuthed(true);
    }
  }, []);

  const handleLogin = () => {
    if (passwordInput === ADMIN_PASSWORD) {
      sessionStorage.setItem('admin_auth', '1');
      setAuthed(true);
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-src-bg)] px-4">
        <div className="card-game max-w-sm w-full p-8 text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="font-display text-2xl text-[var(--color-src-text)] mb-2">
            管理员登录
          </h1>
          <p className="text-[var(--color-src-text-light)] text-sm mb-6">
            请输入管理员密码以访问后台
          </p>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
            placeholder="请输入密码"
            className={`w-full px-4 py-3 rounded-xl border-2 text-center text-lg outline-none transition-colors ${
              passwordError
                ? 'border-[var(--color-src-error)] bg-red-50'
                : 'border-gray-200 focus:border-[var(--color-src-primary)]'
            }`}
          />
          {passwordError && (
            <p className="text-[var(--color-src-error)] text-sm mt-2">密码错误，请重试</p>
          )}
          <button
            onClick={handleLogin}
            className="mt-4 w-full py-3 rounded-xl bg-[var(--color-src-primary)] text-white font-bold text-lg transition-all hover:opacity-90 active:scale-95"
          >
            进入后台
          </button>
          <Link
            href="/"
            className="block mt-4 text-[var(--color-src-text-light)] text-sm hover:text-[var(--color-src-primary)]"
          >
            ← 返回首页
          </Link>
        </div>
      </div>
    );
  }

  return <AdminContent />;
}
