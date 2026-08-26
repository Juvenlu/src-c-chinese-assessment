import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUser } from "@/lib/auth-utils";

// GET: get a single custom book with pages (must belong to current parent's child)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseClient();

    // 先取绘本详情，拿到 child_id 做归属校验
    const { data: book, error: bookError } = await supabase
      .from('custom_books')
      .select('*')
      .eq('id', parseInt(id))
      .single();

    if (bookError || !book) {
      return NextResponse.json({ error: "绘本不存在" }, { status: 404 });
    }

    // 校验 child 归属当前家长
    const { data: child, error: childError } = await supabase
      .from('children')
      .select('id, nickname')
      .eq('id', book.child_id)
      .eq('parent_id', user.id)
      .eq('status', 'active')
      .single();

    if (childError || !child) {
      return NextResponse.json({ error: '无权访问该绘本' }, { status: 403 });
    }

    // 两步查询替代 RPC（原 RPC 函数 c.name 字段名错误，children 表实际为 nickname）
    // 获取 episode 信息
    let epData: any = {};
    if (book.episode_id) {
      const { data: ep, error: epError } = await supabase
        .from('book_episodes')
        .select('id, series_name, episode_number, episode_title')
        .eq('id', book.episode_id)
        .single();
      if (!epError && ep) {
        epData = ep;
      }
    }

    // 组装返回数据（保持与原 RPC 返回结构兼容）
    const result = {
      ...book,
      series_name: epData.series_name,
      episode_number: epData.episode_number,
      episode_title: epData.episode_title,
      child_name: child.nickname,
      episodes: {
        series_name: epData.series_name,
        episode_number: epData.episode_number,
        episode_title: epData.episode_title,
      },
      children: {
        name: child.nickname,
      },
    };

    return NextResponse.json({ data: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
