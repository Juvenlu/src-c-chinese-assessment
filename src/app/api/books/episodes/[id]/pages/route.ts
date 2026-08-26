import { NextRequest, NextResponse } from 'next/server';

// 配置路由段配置
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const fetchCache = 'force-no-store';

/**
 * POST /api/books/episodes/[id]/pages
 * 上传绘本页图片和文本
 *
 * 安全封口：当前版本无 Admin/Teacher 权限体系，
 * 此接口暂禁用，防止匿名用户篡改内容或滥用存储。
 * 待 Admin 权限体系建立后再开放。
 */
export async function POST(
  _request: NextRequest,
  _params: { params: Promise<{ id: string }> }
) {
  return NextResponse.json(
    { error: '内容管理权限体系尚未建立，此接口暂不开放' },
    { status: 403 }
  );
}
