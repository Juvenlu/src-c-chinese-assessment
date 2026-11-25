'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * 管理员 — 密码重置申请审核工作台（P5-R1B）
 *
 * 安全设计：
 *   - 列表仅含 token_hash 摘要，绝不含明文 Token（明文仅批准时响应一次并立即展示）
 *   - 批准必须填写核实方式（verification_method），未核实不得批准
 *   - 拒绝必须填写原因（reject_reason）
 *   - 管理员无法查看或设置家长永久密码（无任何读取 password_hash 的界面）
 *   - 重置链接 30 分钟有效、一次性；批准后旧链接自动失效（同邮箱仅一条活跃申请）
 */

type PasswordResetRequest = {
  id: string;
  parent_id: string | null;
  email: string;
  status: 'pending' | 'approved' | 'rejected' | 'used' | 'expired';
  request_ip: string | null;
  created_at: number;
  consumed_at: number | null;
  verified_by: string | null;
  rejected_by: string | null;
  reject_reason: string | null;
};

const STATUS_LABEL: Record<PasswordResetRequest['status'], string> = {
  pending: '待审核',
  approved: '已批准（待使用）',
  rejected: '已拒绝',
  used: '已使用',
  expired: '已失效',
};

const STATUS_COLOR: Record<PasswordResetRequest['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  used: 'bg-gray-100 text-gray-500',
  expired: 'bg-gray-100 text-gray-500',
};

export function PasswordResetReviews({ adminFetch }: { adminFetch: (url: string, options?: RequestInit) => Promise<Response> }) {
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState<string | null>(null);
  // 批准弹窗
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [verificationMethod, setVerificationMethod] = useState('');
  // 拒绝弹窗
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  // 一次性链接展示（明文 Token 仅此一次，刷新即丢失）
  const [issuedLink, setIssuedLink] = useState<{ email: string; link: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/password-resets');
      const data = await res.json();
      if (res.ok && Array.isArray(data.requests)) {
        setRequests(data.requests);
      } else {
        setError(data.error || '加载失败');
      }
    } catch {
      setError('网络异常');
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  const handleApprove = async (id: string) => {
    if (!verificationMethod.trim()) return;
    setActioningId(id);
    try {
      const res = await adminFetch(`/api/admin/password-resets/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verification_method: verificationMethod.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const req = requests.find((r) => r.id === id);
        setIssuedLink({ email: req?.email || '', link: data.reset_link });
        setApprovingId(null);
        setVerificationMethod('');
        await load();
      } else {
        alert(data.error || '批准失败');
      }
    } catch {
      alert('网络异常');
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return;
    setActioningId(id);
    try {
      const res = await adminFetch(`/api/admin/password-resets/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reject_reason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRejectingId(null);
        setRejectReason('');
        await load();
      } else {
        alert(data.error || '操作失败');
      }
    } catch {
      alert('网络异常');
    } finally {
      setActioningId(null);
    }
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      alert('链接已复制，请通过可信渠道交付家长。链接 30 分钟内有效，仅可使用一次。');
    } catch {
      alert(`复制失败，请手动复制：${link}`);
    }
  };

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-base font-bold text-gray-800">
          密码重置申请
          {pendingCount > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-[var(--color-src-primary)] text-white rounded-full">
              {pendingCount} 待审核
            </span>
          )}
        </h3>
        <button
          onClick={load}
          className="px-3 py-1 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          刷新
        </button>
      </div>

      {issuedLink && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-green-800 mb-1">
            已批准 {issuedLink.email} 的重置申请
          </p>
          <p className="text-xs text-green-700 mb-2">
            一次性重置链接（明文 Token 仅展示这一次，请立即通过可信渠道交付，勿留存）：
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-green-200 rounded-lg px-3 py-2 break-all">
              {issuedLink.link}
            </code>
            <button
              onClick={() => copyLink(issuedLink.link)}
              className="px-3 py-2 text-xs font-medium bg-[var(--color-src-primary)] text-white rounded-lg hover:opacity-90 whitespace-nowrap"
            >
              复制
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {loading ? (
        <div className="text-center py-6 text-gray-400">加载中…</div>
      ) : requests.length === 0 ? (
        <div className="text-center py-8 text-gray-400 bg-white rounded-xl shadow-sm">暂无重置申请</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600">邮箱</th>
                  <th className="text-left px-4 py-3 text-gray-600">状态</th>
                  <th className="text-left px-4 py-3 text-gray-600">申请时间</th>
                  <th className="text-left px-4 py-3 text-gray-600">核实/驳回</th>
                  <th className="text-left px-4 py-3 text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{r.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLOR[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(r.created_at * 1000).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {r.status === 'approved' && r.verified_by ? `已记录 ${r.verified_by}` : ''}
                      {r.status === 'rejected' && r.reject_reason ? r.reject_reason : ''}
                      {r.status === 'used' ? '家长已使用' : ''}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {r.status === 'pending' && (
                          <>
                            <button
                              onClick={() => { setApprovingId(r.id); setVerificationMethod(''); }}
                              disabled={actioningId === r.id}
                              className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                            >
                              批准
                            </button>
                            <button
                              onClick={() => { setRejectingId(r.id); setRejectReason(''); }}
                              disabled={actioningId === r.id}
                              className="px-3 py-1 text-xs font-medium bg-red-100 text-red-600 rounded-lg hover:bg-red-200 disabled:opacity-50"
                            >
                              拒绝
                            </button>
                          </>
                        )}
                        {r.status === 'approved' && (
                          <span className="text-xs text-gray-400">已签发链接，等待家长使用</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 批准确认弹窗（必须填写核实方式） */}
      {approvingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setApprovingId(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-base font-bold text-gray-800 mb-2">批准重置申请</h4>
            <p className="text-sm text-gray-600 mb-4">
              批准前请务必通过<strong>事先建立的可信联系方式</strong>（如客服微信、已备案家长群等）核实申请人身份。
              邮箱及孩子昵称不能单独作为身份证明。
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">核实方式（必填）</label>
            <input
              value={verificationMethod}
              onChange={(e) => setVerificationMethod(e.target.value)}
              placeholder="例：已通过家长群电话核实身份（2026-02-14 14:30）"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-400 focus:outline-none"
            />
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setApprovingId(null)}
                className="flex-1 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => handleApprove(approvingId)}
                disabled={!verificationMethod.trim() || actioningId === approvingId}
                className="flex-1 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {actioningId === approvingId ? '处理中…' : '确认批准并生成链接'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拒绝确认弹窗（必须填写原因） */}
      {rejectingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setRejectingId(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-base font-bold text-gray-800 mb-2">拒绝重置申请</h4>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">拒绝原因（必填）</label>
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="例：无法核实身份，请家长补充信息后重新申请"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-red-400 focus:outline-none"
            />
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setRejectingId(null)}
                className="flex-1 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => handleReject(rejectingId)}
                disabled={!rejectReason.trim() || actioningId === rejectingId}
                className="flex-1 py-2 text-sm font-medium bg-red-100 text-red-600 rounded-lg hover:bg-red-200 disabled:opacity-50"
              >
                {actioningId === rejectingId ? '处理中…' : '确认拒绝'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}