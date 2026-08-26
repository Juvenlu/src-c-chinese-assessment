import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/books/episodes/[id]/import-from-r2
 * 从 Cloudflare R2 文件夹 URL 自动导入绘本内容
 *
 * 安全封口：当前版本无 Admin/Teacher 权限体系，
 * 此接口暂禁用，防止匿名用户触发批量导入或滥用存储。
 * 待 Admin 权限体系建立后再开放。
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: '内容管理权限体系尚未建立，此接口暂不开放' },
    { status: 403 }
  );
}
