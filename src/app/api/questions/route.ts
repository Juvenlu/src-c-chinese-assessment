import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level');

    const client = getSupabaseClient();
    let query = client.from('question_bank').select('*', { count: 'exact' }).order('created_at').limit(99999);

    if (level) {
      // Cumulative level: SRC500 includes SRC300, SRC800 includes SRC300+SRC500
      const levelMap: Record<string, string[]> = {
        'SRC100': ['SRC100'],
        'SRC300': ['SRC100', 'SRC300'],
        'SRC500': ['SRC100', 'SRC300', 'SRC500'],
        'SRC800': ['SRC100', 'SRC300', 'SRC500', 'SRC800'],
      };
      const levels = levelMap[level] || [level];
      query = query.in('level', levels);
    }

    const { data, error } = await query;

    if (error) throw new Error(`查询题库失败: ${error.message}`);

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 题库管理权限将在后续 Admin/Teacher 权限体系建立时正式实现
// 当前版本暂时禁止公开写操作，仅管理员可通过后台/数据库直接操作
const WRITE_DISABLED_RESPONSE = NextResponse.json(
  { error: "题库管理功能暂未开放" },
  { status: 403 }
);

export async function POST(request: NextRequest) {
  return WRITE_DISABLED_RESPONSE;
}

export async function PUT(request: NextRequest) {
  return WRITE_DISABLED_RESPONSE;
}

export async function DELETE(request: NextRequest) {
  return WRITE_DISABLED_RESPONSE;
}
