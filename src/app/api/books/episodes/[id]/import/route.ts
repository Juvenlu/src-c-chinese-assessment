import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/books/episodes/[id]/import
 * 手动录入已上传到 Cloudflare 的文件 URL
 *
 * 安全封口：当前版本无 Admin/Teacher 权限体系，
 * 此接口暂禁用，防止匿名用户批量篡改绘本内容。
 * 待 Admin 权限体系建立后再开放。
 */
export async function POST(
  _request: Request,
  _params: { params: Promise<{ id: string }> },
) {
  return NextResponse.json(
    { error: '内容管理权限体系尚未建立，此接口暂不开放' },
    { status: 403 }
  );
}
