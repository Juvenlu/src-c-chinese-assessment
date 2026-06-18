'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { QuestionItem, Child, TestResult, Level } from '@/lib/types';

type AdminTab = 'questions' | 'users' | 'results' | 'charlib';

// Admin password - change this to your desired password
const ADMIN_PASSWORD = 'srcc2026';

// --- Admin Content Component (only rendered after auth) ---
function AdminContent() {
  const [tab, setTab] = useState<AdminTab>('results');
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [charLibData, setCharLibData] = useState<Record<string, string[]>>({});

  // Edit question state
  const [editingQuestion, setEditingQuestion] = useState<Partial<QuestionItem> | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

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

  // Build character library per child from results
  useEffect(() => {
    const lib: Record<string, string[]> = {};
    results.forEach((r) => {
      if (r.known_characters && r.known_characters.length > 0) {
        if (!lib[r.child_id]) lib[r.child_id] = [];
        // Merge and deduplicate
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

  const handleSaveQuestion = async () => {
    if (!editingQuestion) return;
    try {
      const method = editingQuestion.id ? 'PUT' : 'POST';
      await fetch('/api/questions', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingQuestion),
      });
      setShowEditModal(false);
      setEditingQuestion(null);
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportCSV = () => {
    if (!results.length) return;
    const headers = ['日期', '孩子姓名', '等级', '识字量', '词汇量', '综合得分', '识字得分', '词汇得分', '阅读得分', '理解得分', '识字字库'];
    const childMap = new Map(children.map((c) => [c.id, c.name]));
    const rows = results.map((r) => [
      new Date(r.created_at).toLocaleDateString('zh-CN'),
      childMap.get(r.child_id) || '未知',
      r.level,
      r.stable_char_count,
      r.stable_vocab_count,
      r.total_score,
      r.character_score,
      r.vocab_score,
      r.reading_score,
      r.comprehension_score,
      (r.known_characters || []).join(' '),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `src-c-results-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCharLib = () => {
    if (!children.length) return;
    const headers = ['姓名', '年龄', '国家', '认识汉字数', '认识汉字字库'];
    const rows = children.map((c) => {
      const chars = charLibData[c.id] || [];
      return [
        c.name,
        c.age,
        c.country,
        chars.length,
        chars.join(' '),
      ];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `src-c-charlib-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getChildName = (childId: string) => {
    return children.find((c) => c.id === childId)?.name || '未知';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Admin header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="font-display text-2xl text-gray-800">SRC-C 管理后台</h1>
              <p className="text-sm text-gray-500">题库管理 · 用户数据 · 测试结果 · 识字字库</p>
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
                    📥 导出CSV
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
                          <th className="text-right px-4 py-3 text-gray-600">综合得分</th>
                          <th className="text-right px-4 py-3 text-gray-600">用时</th>
                          <th className="text-center px-4 py-3 text-gray-600">识字字库</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((r) => {
                          const childName = getChildName(r.child_id);
                          const minutes = Math.floor(r.completion_time_seconds / 60);
                          const seconds = r.completion_time_seconds % 60;
                          const hasLib = r.known_characters && r.known_characters.length > 0;
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
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">
                      逐字测试后，系统自动为每个孩子生成其确认认识的汉字字库
                    </span>
                  </div>
                  <button
                    onClick={handleExportCharLib}
                    className="px-4 py-2 bg-[var(--color-src-secondary)] text-white rounded-lg text-sm hover:opacity-90"
                  >
                    📥 导出全部字库CSV
                  </button>
                </div>

                {/* Child selector */}
                <div className="mb-4">
                  <select
                    value={selectedChildId}
                    onChange={(e) => setSelectedChildId(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm w-64"
                  >
                    <option value="">选择孩子查看识字字库</option>
                    {children.map((c) => {
                      const charCount = (charLibData[c.id] || []).length;
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name} ({charCount}字)
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
                          {/* Child info card */}
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
                                <div className="flex flex-wrap gap-2 p-4 bg-[var(--color-src-bg)] rounded-xl">
                                  {chars.map((ch, i) => (
                                    <span
                                      key={i}
                                      className="inline-flex items-center justify-center w-12 h-12 text-xl rounded-lg bg-white shadow-sm border border-gray-100"
                                      style={{ fontFamily: 'KaiTi, STKaiti, 楷体, "Microsoft YaHei", 微软雅黑, SimHei, sans-serif' }}
                                    >
                                      {ch}
                                    </span>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <div className="text-center py-8 text-gray-400">
                                该孩子尚未完成逐字测试，暂无识字字库数据
                              </div>
                            )}
                          </div>

                          {/* Test history */}
                          {childResults.length > 0 && (
                            <div className="bg-white rounded-xl shadow-sm p-6">
                              <h4 className="text-sm font-medium text-gray-700 mb-3">测试历史</h4>
                              <div className="space-y-2">
                                {childResults.map((r) => (
                                  <div key={r.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-100 last:border-0">
                                    <span className="text-gray-500">
                                      {new Date(r.created_at).toLocaleDateString('zh-CN')}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                      r.level === 'SRC300' ? 'bg-green-100 text-green-700' :
                                      r.level === 'SRC500' ? 'bg-blue-100 text-blue-700' :
                                      'bg-purple-100 text-purple-700'
                                    }`}>
                                      {r.level}
                                    </span>
                                    <span className="text-[var(--color-src-primary)] font-bold">
                                      识字 {r.stable_char_count}
                                    </span>
                                    <span className="text-[var(--color-src-secondary)] font-bold">
                                      词汇 {r.stable_vocab_count}
                                    </span>
                                    <span className="font-bold">得分 {r.total_score}</span>
                                    {r.known_characters && r.known_characters.length > 0 && (
                                      <span className="text-xs text-gray-400">
                                        字库 {r.known_characters.length}字
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {!selectedChildId && (
                  <div className="bg-white rounded-xl shadow-sm p-6">
                    <div className="text-center py-8 text-gray-400">
                      请在上方下拉框选择孩子，查看其识字字库
                    </div>
                    {/* Overview of all children's libraries */}
                    <div className="mt-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">全部孩子识字概览</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-4 py-3 text-gray-600">姓名</th>
                              <th className="text-left px-4 py-3 text-gray-600">年龄</th>
                              <th className="text-left px-4 py-3 text-gray-600">国家</th>
                              <th className="text-right px-4 py-3 text-gray-600">认识汉字数</th>
                              <th className="text-left px-4 py-3 text-gray-600">识字字库预览</th>
                              <th className="text-center px-4 py-3 text-gray-600">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {children.map((c) => {
                              const chars = charLibData[c.id] || [];
                              return (
                                <tr key={c.id} className="border-t hover:bg-gray-50">
                                  <td className="px-4 py-3 font-medium">{c.name}</td>
                                  <td className="px-4 py-3">{c.age}岁</td>
                                  <td className="px-4 py-3">{c.country}</td>
                                  <td className="px-4 py-3 text-right font-bold text-[var(--color-src-primary)]">
                                    {chars.length}
                                  </td>
                                  <td className="px-4 py-3">
                                    {chars.length > 0 ? (
                                      <span className="text-gray-600" style={{ fontFamily: 'KaiTi, STKaiti, 楷体, "Microsoft YaHei", sans-serif', letterSpacing: '0.1em' }}>
                                        {chars.slice(0, 20).join(' ')}{chars.length > 20 ? ' ...' : ''}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400">暂无数据</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <button
                                      onClick={() => setSelectedChildId(c.id)}
                                      className="text-[var(--color-src-primary)] hover:underline text-xs"
                                    >
                                      查看详情
                                    </button>
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
              </div>
            )}

            {/* Users Tab */}
            {tab === 'users' && (
              <div>
                <div className="mb-4 text-sm text-gray-500">共 {children.length} 个孩子</div>
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
                          <th className="text-right px-4 py-3 text-gray-600">识字字库</th>
                          <th className="text-left px-4 py-3 text-gray-600">注册时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {children.map((c) => {
                          const charCount = (charLibData[c.id] || []).length;
                          return (
                            <tr key={c.id} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium">{c.name}</td>
                              <td className="px-4 py-3">{c.age}岁</td>
                              <td className="px-4 py-3">{c.grade}</td>
                              <td className="px-4 py-3">{c.country}</td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100">
                                  {c.language_env === 'chinese_primary' ? '中文为主' :
                                   c.language_env === 'bilingual' ? '双语' :
                                   c.language_env === 'english_primary' ? '英文为主' : '其他'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                {charCount > 0 ? (
                                  <button
                                    onClick={() => { setSelectedChildId(c.id); setTab('charlib'); }}
                                    className="text-[var(--color-src-secondary)] hover:underline text-xs"
                                  >
                                    {charCount}字 → 查看
                                  </button>
                                ) : (
                                  <span className="text-gray-400 text-xs">-</span>
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
                    <button
                      onClick={() => {
                        setEditingQuestion({ level: 'SRC300', character: '', word: '', sentence: '', meaning_question: '', options: ['', '', ''], answer: '' });
                        setShowEditModal(true);
                      }}
                      className="px-4 py-2 bg-[var(--color-src-primary)] text-white rounded-lg text-sm hover:opacity-90"
                    >
                      + 新增题目
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
                                onClick={() => {
                                  setEditingQuestion({ ...q });
                                  setShowEditModal(true);
                                }}
                                className="text-[var(--color-src-primary)] hover:underline mr-3"
                              >
                                编辑
                              </button>
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
          </>
        )}
      </div>

      {/* Edit Modal */}
      {showEditModal && editingQuestion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-xl mb-4">
              {editingQuestion.id ? '编辑题目' : '新增题目'}
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">等级</label>
                  <select
                    value={editingQuestion.level || 'SRC300'}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, level: e.target.value as Level })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="SRC300">SRC300</option>
                    <option value="SRC500">SRC500</option>
                    <option value="SRC800">SRC800</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">汉字</label>
                  <input
                    type="text"
                    value={editingQuestion.character || ''}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, character: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">词语</label>
                <input
                  type="text"
                  value={editingQuestion.word || ''}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, word: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">句子</label>
                <input
                  type="text"
                  value={editingQuestion.sentence || ''}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, sentence: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">词义问题</label>
                <input
                  type="text"
                  value={editingQuestion.meaning_question || ''}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, meaning_question: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">选项（逗号分隔）</label>
                <input
                  type="text"
                  value={(editingQuestion.options || []).join(',')}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, options: e.target.value.split(',') })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">答案</label>
                <input
                  type="text"
                  value={editingQuestion.answer || ''}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, answer: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">理解故事（可选）</label>
                <textarea
                  value={editingQuestion.story_text || ''}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, story_text: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">故事问题</label>
                  <input
                    type="text"
                    value={editingQuestion.story_question || ''}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, story_question: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">故事答案</label>
                  <input
                    type="text"
                    value={editingQuestion.story_answer || ''}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, story_answer: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowEditModal(false); setEditingQuestion(null); }}
                className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSaveQuestion}
                className="flex-1 px-4 py-2 bg-[var(--color-src-primary)] text-white rounded-lg text-sm hover:opacity-90"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main Admin Page with Password Gate ---
export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('srcc_admin_auth') === '1') {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = () => {
    if (passwordInput === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      setPasswordError(false);
      sessionStorage.setItem('srcc_admin_auth', '1');
    } else {
      setPasswordError(true);
    }
  };

  if (!isAuthenticated) {
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
