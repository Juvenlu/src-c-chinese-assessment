import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/admin/users
 * 管理后台：获取所有用户（家长+孩子）列表
 *
 * 安全说明：
 * 当前版本无 Admin/Teacher 权限体系，
 * 为防止全量用户数据泄露，此接口暂禁用，统一返回 403。
 * 待 Admin 权限体系建立后再开放。
 */
export async function GET(req: NextRequest) {
  return NextResponse.json(
    { error: '管理员权限体系尚未建立，此接口暂不开放' },
    { status: 403 }
  );
}
