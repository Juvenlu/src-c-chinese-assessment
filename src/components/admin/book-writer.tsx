'use client';

import { useState, useEffect } from 'react';
import { VersionManager } from './version-manager';

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

// ---------- P3-H-12F-4G-B 批量导入与渲染守卫纯函数（导出供本地测试） ----------

export interface BulkImportResult {
  ok: boolean;
  pages?: Map<number, string>;
  totalChars?: number;
  hanziChars?: number;
  errors?: string[];
}

// 页码标记行：行首「第N页」「第 N 页」「【第N页】」，可跟冒号/标题
const PAGE_MARK_RE = /^【?\s*第\s*0*(\d{1,3})\s*页\s*】?\s*[:：.、]?\s*/;
// 分页符：单独一行三个及以上连字符
const SEPARATOR_RE = /^\s*-{3,}\s*$/;

// 与 Worker PATCH 重算口径一致：全部 Unicode 字符数（含标点换行）
export function countChars(text: string): number {
  return Array.from(text || '').length;
}

export function countHanzi(text: string): number {
  return Array.from(text || '').filter((ch) => ch >= '一' && ch <= '鿿').length;
}

/**
 * 解析批量粘贴文本为分页结果。
 * 支持两种格式：
 *  1) 页码格式：每页以「第N页」标记行开头；
 *  2) 分页符格式：以单独一行 --- 分隔，按顺序对应第 1..N 页。
 * 校验：页数必须恰好等于 expectedPageCount；无缺页/重复页号/超范围页号/空页。
 * 任何错误均返回 ok=false 且不含 pages，调用方不得部分应用。
 */
export function parseBulkPageText(raw: string, expectedPageCount: number): BulkImportResult {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { ok: false, errors: ['内容为空，请先粘贴改写文本'] };
  }
  if (!Number.isInteger(expectedPageCount) || expectedPageCount <= 0) {
    return { ok: false, errors: ['目标页数无效'] };
  }

  const lines = trimmed.split(/\r?\n/);
  const hasPageMark = lines.some((l) => PAGE_MARK_RE.test(l));
  const hasSeparator = lines.some((l) => SEPARATOR_RE.test(l));

  const pages = new Map<number, string>();
  const errors: string[] = [];

  if (hasPageMark) {
    const duplicated: number[] = [];
    let currentNo: number | null = null;
    let buf: string[] = [];
    let preamble = '';
    const flush = () => {
      if (currentNo === null) return;
      pages.set(currentNo, buf.join('\n').trim());
      buf = [];
    };
    for (const line of lines) {
      const m = line.match(PAGE_MARK_RE);
      if (m) {
        flush();
        currentNo = parseInt(m[1], 10);
        if (pages.has(currentNo)) duplicated.push(currentNo);
        const rest = line.slice(m[0].length);
        buf = rest.trim() ? [rest] : [];
      } else if (currentNo === null) {
        if (line.trim()) preamble += (preamble ? '\n' : '') + line.trim();
      } else {
        buf.push(line);
      }
    }
    flush();
    if (preamble) {
      errors.push('首个「第1页」标记之前存在无法归属的文字，请删除或补页码');
    }
    if (duplicated.length > 0) {
      errors.push(`页号重复：第 ${Array.from(new Set(duplicated)).join('、')} 页`);
    }
  } else if (hasSeparator) {
    const segments: string[] = [];
    let buf: string[] = [];
    for (const line of lines) {
      if (SEPARATOR_RE.test(line)) {
        segments.push(buf.join('\n').trim());
        buf = [];
      } else {
        buf.push(line);
      }
    }
    segments.push(buf.join('\n').trim());
    if (segments.length !== expectedPageCount) {
      return {
        ok: false,
        errors: [`按分页符解析出 ${segments.length} 页，应为 ${expectedPageCount} 页（分页符 --- 应出现 ${expectedPageCount - 1} 次）`],
      };
    }
    segments.forEach((text, idx) => pages.set(idx + 1, text));
  } else {
    return {
      ok: false,
      errors: ['未识别到页码标记（如「第1页」）或分页符（单独一行 ---），请按格式粘贴'],
    };
  }

  const missing: number[] = [];
  for (let i = 1; i <= expectedPageCount; i++) {
    if (!pages.has(i)) missing.push(i);
  }
  const outOfRange = Array.from(pages.keys()).filter((n) => n < 1 || n > expectedPageCount);
  const emptyPages = Array.from(pages.entries())
    .filter(([, text]) => !text.trim())
    .map(([n]) => n);

  if (missing.length > 0) errors.push(`缺少页面：第 ${missing.join('、')} 页（共需 ${expectedPageCount} 页）`);
  if (outOfRange.length > 0) errors.push(`页号超出范围（1-${expectedPageCount}）：${outOfRange.join('、')}`);
  if (emptyPages.length > 0) errors.push(`页面内容为空：第 ${emptyPages.join('、')} 页`);
  if (errors.length > 0) return { ok: false, errors };

  let totalChars = 0;
  let hanziChars = 0;
  pages.forEach((text) => {
    totalChars += countChars(text);
    hanziChars += countHanzi(text);
  });
  return { ok: true, pages, totalChars, hanziChars };
}

/**
 * 将导入文本合并进现有页面数组：仅替换 text 字段，
 * 保留 page / image_url / original_text / frontier 等其他字段（引用不变）。
 */
export function applyBulkTextToPages(pages: RewritePage[], imported: Map<number, string>): RewritePage[] {
  return pages.map((p) => (imported.has(p.page) ? { ...p, text: imported.get(p.page) as string } : p));
}

/**
 * 版本管理（激活入口）渲染守卫：
 * 仅当当前版本为 final、归属当前选中孩子、且与当前选中故事一致时显示。
 */
export function shouldShowVersionManager(
  detail: Pick<RewriteVersion, 'status' | 'child_id' | 'episode_id'> | null,
  selectedChildId: string,
  selectedEpisodeId?: number | null,
): boolean {
  if (!detail) return false;
  if (detail.status !== 'final') return false;
  if (!detail.child_id || !selectedChildId) return false;
  if (String(detail.child_id) !== String(selectedChildId)) return false;
  const epId = Number(detail.episode_id ?? selectedEpisodeId);
  if (!Number.isFinite(epId) || epId <= 0) return false;
  if (selectedEpisodeId != null && Number(detail.episode_id) !== Number(selectedEpisodeId)) return false;
  return true;
}

/** 版本列表过滤：只显示当前选中孩子的 rewrite（未选孩子时不显示任何版本）。 */
export function filterVersionsForChild(versions: RewriteVersion[], childId: string): RewriteVersion[] {
  if (!childId) return [];
  return versions.filter((v) => String(v.child_id ?? '') === String(childId));
}

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
  const [generatingAi, setGeneratingAi] = useState(false);
  const [targetLevel, setTargetLevel] = useState<string>('SRC300');

  // 批量导入面板（P3-H-12F-4G-B）
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [bulkPreview, setBulkPreview] = useState<BulkImportResult | null>(null);

  const resetBulkPanel = () => {
    setBulkOpen(false);
    setBulkText('');
    setBulkErrors([]);
    setBulkPreview(null);
  };

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
    // 切换孩子时清空重选状态（含批量导入面板，防止跨孩子残留）
    setSelectedEpisode(null);
    setEpisodePages([]);
    setRewriteVersions([]);
    setSelectedRewriteId(null);
    setRewriteDetail(null);
    setEditedPages([]);
    setEditMode(false);
    resetBulkPanel();
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
    resetBulkPanel();
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

  // AI 一键生成个性化初稿（MULTIBOOK-13）
  // 后端链路：Next 编排层读 Master+真实档案(D1) → LLM 改写 → 质量验证 → 落库 status=review
  // 成功后自动打开待审核版本，复用现有逐页编辑/保存/Finalize 流程
  const handleGenerateAiDraft = async () => {
    if (!selectedEpisode || !selectedChildId) return;
    setGeneratingAi(true);
    try {
      const res = await adminFetch('/api/admin/rewrite/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episode_id: selectedEpisode.id,
          child_id: selectedChildId,
          target_level: targetLevel,
        }),
      });
      const data = await res.json();
      if (res.ok && data.rewrite_id) {
        alert(
          `AI 初稿生成成功，已进入待审核！\n版本ID: ${data.rewrite_id} · v${data.version}\n` +
          `字数: ${data.volume_validation?.actual_count ?? data.total_chars}（目标 ${data.volume_validation?.target_min}-${data.volume_validation?.target_max}）\n` +
          `质量验证: ${data.validation_summary || '通过'}\n请逐页审核后再决定是否 Finalize。`
        );
        loadRewriteVersions(selectedEpisode.id);
        setSelectedRewriteId(data.rewrite_id);
        loadRewriteDetail(data.rewrite_id);
      } else if (res.status === 409) {
        alert(
          '已存在待审核版本，不能重复生成。\n' +
          (data?.existing_rewrite_id ? `现有版本ID: ${data.existing_rewrite_id}（v${data.existing_version}）\n` : '') +
          '请先编辑或驳回现有版本。'
        );
      } else if (res.status === 422) {
        // 档案不足 / 质量验证失败：展示明确原因，不产生任何版本
        let msg = '生成未通过，未创建任何版本。\n\n原因：' + (data?.error || '未知');
        if (data?.volume_validation) {
          msg += `\n实际字数: ${data.volume_validation.actual_count}（目标 ${data.volume_validation.target_min}-${data.volume_validation.target_max}）`;
        }
        if (data?.validation?.summary) {
          msg += `\n验证明细: ${data.validation.summary}`;
        }
        alert(msg);
      } else {
        // 优先展示后端 message（真实错误细节），error 为通用文案兜底
        alert('AI 生成失败：' + (data?.message || data?.error || `HTTP ${res.status}`));
      }
    } catch (err: any) {
      alert('AI 生成失败：' + (err?.message || String(err)));
    } finally {
      setGeneratingAi(false);
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
        resetBulkPanel();
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
    if (!confirm('确认定稿此版本？定稿后状态变为 final，仍需在下方「版本管理」设为正式版，孩子才能阅读。')) return;
    try {
      const res = await adminFetch(`/api/books/writer/rewrites/${selectedRewriteId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data && data.id && data.status === 'final') {
        alert('已定稿。请在下方「版本管理」中设为正式版，孩子才能阅读。');
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

  // 批量导入：仅解析+预览，不修改任何已有文本（P3-H-12F-4G-B）
  const handleBulkParse = () => {
    const expected = editedPages.length || selectedEpisode?.page_count || 10;
    const result = parseBulkPageText(bulkText, expected);
    if (!result.ok) {
      setBulkErrors(result.errors || ['解析失败']);
      setBulkPreview(null);
    } else {
      setBulkErrors([]);
      setBulkPreview(result);
    }
  };

  // 批量导入：确认后应用到编辑器（仅内存态，仍需点击「保存修改」才写入）
  const handleBulkApply = () => {
    if (!bulkPreview?.ok || !bulkPreview.pages) return;
    const imported = bulkPreview.pages;
    setEditedPages((prev) => applyBulkTextToPages(prev, imported));
    resetBulkPanel();
    alert(`已应用 ${imported.size} 页到编辑器（尚未保存）。请逐页核对后点击「保存修改」。`);
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
                  disabled={creatingDraft || generatingAi || !selectedEpisode}
                  className="px-6 py-2 bg-[var(--color-src-secondary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium"
                >
                  {creatingDraft ? '⏳ 创建中...' : '✍️ 创建人工初稿'}
                </button>
                <button
                  onClick={handleGenerateAiDraft}
                  disabled={generatingAi || creatingDraft || !selectedEpisode || !selectedChildId}
                  title={!selectedChildId ? '请先在第 1 步选择孩子（AI 个性化需要真实阅读档案）' : '基于孩子真实识字档案一键生成个性化初稿，生成后进入待审核'}
                  className="px-6 py-2 bg-[var(--color-src-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium"
                >
                  {generatingAi ? '⏳ AI 生成中（约1分钟）...' : '🤖 AI 生成个性化初稿'}
                </button>
                {!selectedChildId && (
                  <span className="text-xs text-gray-400 self-center">
                    （AI 生成需要先选择孩子）
                  </span>
                )}
              </div>
            </div>

            {/* 版本列表（仅显示当前选中孩子的 rewrite） */}
            <div className="mb-6">
              <div className="text-sm font-medium mb-2 text-gray-700">版本列表</div>
              <div className="space-y-2">
                {filterVersionsForChild(rewriteVersions, selectedChildId).map((v) => (
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
                      resetBulkPanel();
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
                        {v.source === 'ai' && (
                          <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                            🤖 AI
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
                {filterVersionsForChild(rewriteVersions, selectedChildId).length === 0 && (
                  <div className="text-sm text-gray-400 italic">当前孩子暂无版本，点击上方「创建人工初稿」开始</div>
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
                            setBulkOpen((v) => !v);
                            setBulkErrors([]);
                            setBulkPreview(null);
                          }}
                          className={`px-3 py-1.5 text-sm rounded-lg ${
                            bulkOpen
                              ? 'bg-teal-600 text-white'
                              : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                          }`}
                        >
                          📋 批量导入
                        </button>
                        <button
                          onClick={() => {
                            setEditMode(false);
                            resetBulkPanel();
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

                {/* 版本管理（激活入口）：仅 final 且归属当前孩子/当前故事时显示（D1 数据源） */}
                {shouldShowVersionManager(rewriteDetail, selectedChildId, selectedEpisode?.id) && (
                  <div className="mb-4">
                    <VersionManager
                      key={`${selectedChildId}-${selectedEpisode!.id}-${rewriteDetail.id}`}
                      childId={String(rewriteDetail.child_id)}
                      episodeId={Number(rewriteDetail.episode_id ?? selectedEpisode!.id)}
                      currentRewriteId={Number(rewriteDetail.id)}
                      onChanged={() => {
                        loadRewriteVersions(selectedEpisode!.id);
                        loadRewriteDetail(rewriteDetail.id);
                      }}
                    />
                  </div>
                )}

                {/* 批量导入面板（P3-H-12F-4G-B）：解析预览 → 应用到编辑器 → 保存才写入 */}
                {editMode && bulkOpen && (
                  <div className="mb-4 border border-teal-200 rounded-xl p-4 bg-teal-50/40">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-teal-800">📋 批量导入改写文本</div>
                      <button
                        onClick={resetBulkPanel}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        关闭
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 mb-2">
                      格式：每页以「第1页」「第2页」… 标记开头；或用单独一行 <code>---</code> 分页（共{' '}
                      {editedPages.length || selectedEpisode?.page_count || 10} 页）。
                      解析后先预览，点击「应用到编辑器」后仍需「保存」才会写入。
                    </div>
                    <textarea
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      rows={8}
                      placeholder={'第1页\n（第一页改写文本）\n第2页\n（第二页改写文本）\n…'}
                      className="w-full px-3 py-2 border border-teal-200 rounded-lg text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-300 font-mono"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={handleBulkParse}
                        className="px-4 py-1.5 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                      >
                        解析预览
                      </button>
                      {bulkPreview?.ok && (
                        <span className="text-xs text-teal-700">
                          共 {bulkPreview.pages?.size ?? 0} 页 · 总字符 {bulkPreview.totalChars ?? 0} · 汉字{' '}
                          {bulkPreview.hanziChars ?? 0}
                        </span>
                      )}
                    </div>
                    {bulkErrors.length > 0 && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="text-xs font-medium text-red-700 mb-1">解析失败（未改动任何内容）：</div>
                        <ul className="text-xs text-red-600 list-disc pl-4 space-y-0.5">
                          {bulkErrors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {bulkPreview?.ok && bulkPreview.pages && (
                      <div className="mt-3">
                        <div className="text-xs font-medium text-gray-700 mb-1">预览（逐页核对）：</div>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {Array.from(bulkPreview.pages.entries()).map(([no, text]) => (
                            <div key={no} className="text-xs bg-white border rounded px-2 py-1.5 flex gap-2">
                              <span className="font-bold text-teal-700 shrink-0">第 {no} 页</span>
                              <span className="text-gray-400 shrink-0">{countChars(text)} 字符</span>
                              <span className="text-gray-600 truncate">{text.slice(0, 40)}</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={handleBulkApply}
                          className="mt-2 px-4 py-1.5 text-sm bg-[var(--color-src-primary)] text-white rounded-lg hover:opacity-90"
                        >
                          ✅ 应用到编辑器（未保存）
                        </button>
                      </div>
                    )}
                  </div>
                )}

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
