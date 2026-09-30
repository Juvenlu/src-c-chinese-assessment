'use client';

import { useState, useEffect } from 'react';

interface Child {
  id: string | number;
  nickname: string;
  age?: number;
  grade?: string;
  confirmed_level?: string;
}

interface Episode {
  id: number;
  series_name: string;
  episode_number: number;
  episode_title: string;
  page_count: number;
  status: string;
}

interface EpisodePage {
  id?: number;
  page_number: number;
  original_text: string;
  image_url: string;
}

interface RewriteVersion {
  id: number;
  episode_id: number;
  target_level: string;
  status: string;
  version: number;
  child_id: string | null;
  pages_json: RewritePage[];
  frontier_targets: string[];
  created_at: string;
  finalized_at: string | null;
  source?: string;
  total_chars?: number;
  unique_chars?: number;
}

interface RewritePage {
  page: number;
  text: string;
  frontier: string[];
  image_url?: string;
  original_text?: string;
}

interface BookWriterProps {
  childList: Child[];
  adminFetch: (url: string, options?: RequestInit) => Promise<Response>;
  ADMIN_PASSWORD: string;
}

const STATUS_LABEL: Record<string, string> = {
  ai_draft: '🤖 AI 草稿',
  review: '👀 审核中',
  final: '✅ 已发布',
  rejected: '❌ 已驳回',
  failed: '⚠️ 生成失败',
};

const STATUS_COLOR: Record<string, string> = {
  ai_draft: 'bg-yellow-100 text-yellow-700',
  review: 'bg-blue-100 text-blue-700',
  final: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  failed: 'bg-gray-100 text-gray-700',
};

export function BookWriter({ childList, adminFetch }: BookWriterProps) {
  // Step 1: Child
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [childLoading, setChildLoading] = useState(false);

  // Step 2: Episode (self-fetched from D1 via admin endpoint)
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesLoaded, setEpisodesLoaded] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [episodePages, setEpisodePages] = useState<EpisodePage[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);

  // Step 3: Rewrite
  const [rewriteVersions, setRewriteVersions] = useState<RewriteVersion[]>([]);
  const [selectedRewriteId, setSelectedRewriteId] = useState<number | null>(null);
  const [rewriteDetail, setRewriteDetail] = useState<RewriteVersion | null>(null);
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedPages, setEditedPages] = useState<RewritePage[]>([]);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [targetLevel, setTargetLevel] = useState<string>('SRC300');

  // Reading profile（从 admin children detail 读取）
  const [readingProfile, setReadingProfile] = useState<any>(null);

  // 加载 Master Story 列表（D1 数据源）
  const loadEpisodes = async () => {
    if (episodesLoaded) return;
    setEpisodesLoading(true);
    try {
      const res = await adminFetch('/api/admin/episodes');
      if (res.ok) {
        const data = await res.json();
        setEpisodes((data.data as Episode[]) || []);
        setEpisodesLoaded(true);
      }
    } catch (err) {
      console.error('加载绘本集列表失败:', err);
    } finally {
      setEpisodesLoading(false);
    }
  };

  // Step 2 区域展开时才加载（懒加载）
  useEffect(() => {
    if (selectedChildId && !episodesLoaded) {
      loadEpisodes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChildId]);

  const loadChildProfile = async (childId: string) => {
    setChildLoading(true);
    setReadingProfile(null);
    try {
      // 从 Admin Reading Profile 读取（Worker /v1/admin/children/:id → D1）
      const res = await adminFetch(`/api/admin/children/${childId}`);
      if (res.ok) {
        const data = await res.json();
        setReadingProfile(data.data);
      }
    } catch (err) {
      console.error('加载孩子信息失败:', err);
    } finally {
      setChildLoading(false);
    }
  };

  const handleSelectChild = (childId: string) => {
    setSelectedChildId(childId);
    if (childId) loadChildProfile(childId);
    // 切换孩子时清空重选状态
    setSelectedEpisode(null);
    setEpisodePages([]);
    setRewriteVersions([]);
    setSelectedRewriteId(null);
    setRewriteDetail(null);
    setEditedPages([]);
    setEditMode(false);
  };

  const loadEpisodePages = async (ep: Episode) => {
    setPagesLoading(true);
    try {
      const res = await adminFetch(`/api/admin/episodes/${ep.id}/pages`);
      const data = await res.json();
      const pages = data?.data?.pages;
      if (pages && Array.isArray(pages)) {
        setEpisodePages(pages as EpisodePage[]);
      } else {
        setEpisodePages([]);
      }
    } catch (err) {
      console.error('加载绘本页失败:', err);
      setEpisodePages([]);
    } finally {
      setPagesLoading(false);
    }
  };

  const loadRewriteVersions = async (epId: number) => {
    try {
      const res = await adminFetch(`/api/books/writer/episodes/${epId}/rewrites`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRewriteVersions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('加载改写版本失败:', err);
      setRewriteVersions([]);
    }
  };

  const handleSelectEpisode = (ep: Episode) => {
    setSelectedEpisode(ep);
    loadEpisodePages(ep);
    loadRewriteVersions(ep.id);
    setSelectedRewriteId(null);
    setRewriteDetail(null);
    setEditedPages([]);
    setEditMode(false);
  };

  const loadRewriteDetail = async (id: number) => {
    setRewriteLoading(true);
    try {
      const res = await adminFetch(`/api/books/writer/rewrites/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.id) {
        setRewriteDetail(data as RewriteVersion);
        setEditedPages(data.pages_json || []);
      }
    } catch (err) {
      console.error('加载改写详情失败:', err);
    } finally {
      setRewriteLoading(false);
    }
  };

  const handleCreateManualDraft = async () => {
    if (!selectedEpisode) return;
    setCreatingDraft(true);
    try {
      const body: any = {
        episode_id: selectedEpisode.id,
        target_level: targetLevel,
      };
      if (selectedChildId) body.child_id = selectedChildId;

      const res = await adminFetch('/api/books/rewrite/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.rewrite_id) {
        alert(`创建成功！版本ID: ${data.rewrite_id}`);
        loadRewriteVersions(selectedEpisode.id);
        setSelectedRewriteId(data.rewrite_id);
        loadRewriteDetail(data.rewrite_id);
      } else {
        alert('创建失败：' + (data?.error || data?.message || `HTTP ${res.status}`));
      }
    } catch (err: any) {
      alert('创建失败：' + (err?.message || String(err)));
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleSaveRewriteEdit = async () => {
    if (!selectedRewriteId) return;
    setRewriteLoading(true);
    try {
      const res = await adminFetch(`/api/books/writer/rewrites/${selectedRewriteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: editedPages }),
      });
      const data = await res.json();
      if (res.ok && data && data.id) {
        alert('保存成功！');
        setEditMode(false);
        setRewriteDetail(data as RewriteVersion);
        setEditedPages(data.pages_json || []);
        loadRewriteVersions(selectedEpisode!.id);
      } else {
        alert('保存失败：' + (data?.error || data?.message || res.statusText));
      }
    } catch (err) {
      console.error(err);
      alert('保存失败');
    } finally {
      setRewriteLoading(false);
    }
  };

  const handleRejectRewrite = async () => {
    if (!selectedRewriteId) return;
    if (!confirm('确认驳回此版本？')) return;
    try {
      const res = await adminFetch(`/api/books/writer/rewrites/${selectedRewriteId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data && data.id) {
        alert('已驳回');
        setRewriteDetail(data as RewriteVersion);
        loadRewriteVersions(selectedEpisode!.id);
      } else {
        alert('操作失败：' + (data?.error || data?.message || res.statusText));
      }
    } catch (err) {
      console.error(err);
      alert('操作失败');
    }
  };

  const handleFinalizeRewrite = async () => {
    if (!selectedRewriteId) return;
    if (!confirm('确认发布此版本？发布后状态变为 final，孩子可以阅读。')) return;
    try {
      const res = await adminFetch(`/api/books/writer/rewrites/${selectedRewriteId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data && data.id && data.status === 'final') {
        alert('已发布！孩子端可阅读。');
        setRewriteDetail(data as RewriteVersion);
        loadRewriteVersions(selectedEpisode!.id);
      } else {
        alert('发布失败：' + (data?.error || data?.message || res.statusText));
      }
    } catch (err) {
      console.error(err);
      alert('发布失败');
    }
  };

  const handleEditPageText = (index: number, text: string) => {
    const updated = [...editedPages];
    updated[index] = { ...updated[index], text };
    setEditedPages(updated);
  };

  const selectedChild = childList.find((c) => String(c.id) === selectedChildId);

  return (
    <div className="space-y-6">
      {/* Step 1: 选择孩子 */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-[var(--color-src-primary)] text-white flex items-center justify-center font-bold text-sm">1</span>
          <h2 className="font-display text-xl text-gray-800">选择孩子</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <select
            className="w-full px-3 py-2 border rounded-lg text-sm"
            value={selectedChildId}
            onChange={(e) => handleSelectChild(e.target.value)}
          >
            <option value="">请选择孩子</option>
            {childList.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {c.nickname} ({c.age}岁)
              </option>
            ))}
          </select>
        </div>
        {selectedChild && (
          <div className="bg-orange-50 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-gray-500">昵称</div>
              <div className="font-bold text-gray-800">{selectedChild.nickname}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">年龄</div>
              <div className="font-bold text-gray-800">{selectedChild.age} 岁</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Reading Profile</div>
              <div className="font-bold text-[var(--color-src-primary)]">
                {readingProfile?.confirmed_level || readingProfile?.level || '暂无数据'}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">说明</div>
              <div className="text-sm text-gray-600">
                {readingProfile?.total_char_questions ? `${readingProfile.total_char_questions} 题测评` : '暂无测评'}
              </div>
            </div>
          </div>
        )}
        {childLoading && <div className="text-sm text-gray-400">加载中...</div>}
      </div>

      {/* Step 2: 选择 Master Story */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-[var(--color-src-primary)] text-white flex items-center justify-center font-bold text-sm">2</span>
          <h2 className="font-display text-xl text-gray-800">选择 Master Story</h2>
        </div>
        {episodesLoading && <div className="text-sm text-gray-400 mb-4">加载中...</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {episodes.map((ep) => (
            <div
              key={ep.id}
              className={`border rounded-lg p-4 cursor-pointer transition-all ${
                selectedEpisode?.id === ep.id
                  ? 'border-[var(--color-src-primary)] bg-orange-50'
                  : 'hover:bg-gray-50'
              }`}
              onClick={() => handleSelectEpisode(ep)}
            >
              <div className="font-bold">{ep.series_name} · 第{ep.episode_number}集</div>
              <div className="text-sm text-gray-500 mt-1">{ep.episode_title}</div>
              <div className="text-xs text-gray-400 mt-2">{ep.page_count} 页 · {ep.status}</div>
            </div>
          ))}
          {episodes.length === 0 && <div className="text-gray-500 col-span-3">暂无绘本集</div>}
        </div>

        {/* Master Pages 预览 */}
        {selectedEpisode && episodePages.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h3 className="font-display text-lg text-gray-800 mb-3">
              Master Pages（图片 + 原文）
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-[400px] overflow-y-auto pr-2">
              {episodePages.map((p) => (
                <div key={p.id ?? p.page_number} className="border rounded-lg overflow-hidden">
                  <img
                    src={p.image_url}
                    alt={`第${p.page_number}页`}
                    className="w-full aspect-square object-cover"
                  />
                  <div className="p-2 text-xs text-gray-600 line-clamp-3 min-h-[48px]">
                    {p.original_text}
                  </div>
                </div>
              ))}
            </div>
            {pagesLoading && <div className="text-sm text-gray-400 mt-2">加载中...</div>}
          </div>
        )}
      </div>

      {/* Step 3: 生产 & 发布 */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-[var(--color-src-primary)] text-white flex items-center justify-center font-bold text-sm">3</span>
          <h2 className="font-display text-xl text-gray-800">创作 & 发布</h2>
        </div>

        {!selectedEpisode ? (
          <div className="text-gray-400 text-sm py-8 text-center">请先选择 Master Story</div>
        ) : (
          <>
            {/* 创建初稿控制面板 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6 p-4 bg-gray-50 rounded-lg">
              <div>
                <label className="block text-sm font-medium mb-1">目标等级</label>
                <select
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  value={targetLevel}
                  onChange={(e) => setTargetLevel(e.target.value)}
                >
                  <option value="SRC100">SRC100（入门）</option>
                  <option value="SRC300">SRC300（初级）</option>
                  <option value="SRC500">SRC500（中级）</option>
                  <option value="SRC800">SRC800（进阶）</option>
                </select>
              </div>
              <div className="flex items-end md:col-span-3 gap-2">
                <button
                  onClick={handleCreateManualDraft}
                  disabled={creatingDraft || !selectedEpisode}
                  className="px-6 py-2 bg-[var(--color-src-secondary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium"
                >
                  {creatingDraft ? '⏳ 创建中...' : '✍️ 创建人工初稿'}
                </button>
                <span className="text-xs text-gray-400 self-center">
                  （未来 AI 生成初稿入口将添加在此处）
                </span>
              </div>
            </div>

            {/* 版本列表 */}
            <div className="mb-6">
              <div className="text-sm font-medium mb-2 text-gray-700">版本列表</div>
              <div className="space-y-2">
                {rewriteVersions.map((v) => (
                  <div
                    key={v.id}
                    className={`border rounded-lg p-3 cursor-pointer transition-all ${
                      selectedRewriteId === v.id
                        ? 'border-[var(--color-src-secondary)] bg-teal-50'
                        : 'hover:bg-gray-50'
                    }`}
                    onClick={() => {
                      setSelectedRewriteId(v.id);
                      setEditMode(false);
                      loadRewriteDetail(v.id);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold">{v.target_level}</span>
                        <span className="ml-2 text-sm text-gray-500">
                          v{v.version} · {new Date(v.created_at).toLocaleString()}
                        </span>
                        {v.source === 'manual' && (
                          <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            人工
                          </span>
                        )}
                        {v.child_id && (
                          <span className="ml-2 text-xs text-gray-400">
                            · 孩子: {String(v.child_id).slice(0, 8)}
                          </span>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[v.status] || 'bg-gray-100 text-gray-700'}`}>
                        {STATUS_LABEL[v.status] || v.status}
                      </span>
                    </div>
                    {v.total_chars !== undefined && (
                      <div className="text-xs text-gray-500 mt-1">
                        总字数: {v.total_chars} · 独立字: {v.unique_chars}
                      </div>
                    )}
                  </div>
                ))}
                {rewriteVersions.length === 0 && (
                  <div className="text-sm text-gray-400 italic">暂无版本，点击上方「创建人工初稿」开始</div>
                )}
              </div>
            </div>

            {/* 编辑/审核详情 */}
            {rewriteDetail && (
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h3 className="font-display text-lg text-gray-800">
                    编辑审核：{rewriteDetail.target_level} 版本
                  </h3>
                  <div className="flex gap-2">
                    {!editMode ? (
                      <button
                        onClick={() => setEditMode(true)}
                        className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                      >
                        ✏️ 编辑
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditMode(false);
                            setEditedPages(rewriteDetail.pages_json);
                          }}
                          className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSaveRewriteEdit}
                          disabled={rewriteLoading}
                          className="px-3 py-1.5 text-sm bg-[var(--color-src-secondary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                        >
                          💾 保存
                        </button>
                      </>
                    )}
                    <button
                      onClick={handleRejectRewrite}
                      disabled={rewriteDetail.status === 'final'}
                      className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                    >
                      驳回
                    </button>
                    <button
                      onClick={handleFinalizeRewrite}
                      disabled={rewriteDetail.status === 'final'}
                      className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                    >
                      ✅ 发布 Final
                    </button>
                  </div>
                </div>

                {/* 字数统计 */}
                <div className="mb-4 p-3 bg-gray-50 rounded-lg grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">总字数: </span>
                    <span className="font-bold">{rewriteDetail.total_chars || 0}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">独立字: </span>
                    <span className="font-bold">{rewriteDetail.unique_chars || 0}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">来源: </span>
                    <span className="font-bold">{rewriteDetail.source || 'unknown'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">版本: </span>
                    <span className="font-bold">v{rewriteDetail.version}</span>
                  </div>
                </div>

                {/* 逐页编辑器 */}
                <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
                  {editedPages.map((page: RewritePage, idx: number) => {
                    const original = episodePages.find((ep) => ep.page_number === page.page);
                    const masterImage = original?.image_url || page.image_url;
                    const masterText = original?.original_text || page.original_text;
                    return (
                      <div key={idx} className="border rounded-xl overflow-hidden">
                        <div className="bg-gray-100 px-4 py-2 flex items-center justify-between">
                          <span className="font-bold">第 {page.page} 页</span>
                          {page.frontier && page.frontier.length > 0 && (
                            <span className="text-xs text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                              🌟 {page.frontier.join('、')}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
                          <div className="bg-gray-50 p-3 flex items-center justify-center">
                            {masterImage ? (
                              <img
                                src={masterImage}
                                alt={`第 ${page.page} 页`}
                                className="max-w-full max-h-48 object-contain rounded"
                              />
                            ) : (
                              <div className="text-gray-400 text-sm">无图片</div>
                            )}
                          </div>
                          <div className="md:col-span-2 flex flex-col divide-y">
                            <div className="p-3">
                              <div className="text-xs text-gray-500 font-medium mb-1">
                                📜 原文 (Master Text)
                              </div>
                              <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                                {masterText || '（无原文）'}
                              </div>
                            </div>
                            <div className="p-3 bg-teal-50/30">
                              <div className="text-xs text-teal-700 font-medium mb-1">
                                ✨ 改写文
                              </div>
                              {editMode ? (
                                <textarea
                                  value={page.text || ''}
                                  onChange={(e) => handleEditPageText(idx, e.target.value)}
                                  className="w-full px-3 py-2 border border-teal-200 rounded-lg text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-teal-300"
                                  rows={4}
                                />
                              ) : (
                                <div className="text-sm text-gray-800 leading-relaxed">
                                  {page.text || '（无内容）'}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
