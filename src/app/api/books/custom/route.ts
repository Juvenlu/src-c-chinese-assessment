import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUser } from "@/lib/auth-utils";

// GET: list custom books for a child (must belong to current parent)
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const childId = searchParams.get("child_id");
    if (!childId) {
      return NextResponse.json({ error: '缺少 child_id 参数' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // 校验 child 归属：该 child_id 必须属于当前登录家长
    const { data: child, error: childError } = await supabase
      .from('children')
      .select('id, nickname')
      .eq('id', childId)
      .eq('parent_id', user.id)
      .eq('status', 'active')
      .single();

    if (childError || !child) {
      return NextResponse.json({ error: '无权访问该孩子的数据' }, { status: 403 });
    }

    // 两步查询替代 RPC（原 RPC 函数 get_custom_books 中 c.name 字段名错误，children 表实际为 nickname）
    // custom_books 表与 book_episodes 的 Supabase 关系名不稳定，改用独立查询 + 手动拼接
    const { data: booksData, error: booksError } = await supabase
      .from('custom_books')
      .select('*')
      .eq('child_id', childId)
      .order('created_at', { ascending: false });

    if (booksError) {
      console.error('custom_books query error:', booksError);
      throw booksError;
    }

    // 批量获取 episode 信息
    let episodesMap: Record<string, any> = {};
    if (booksData && booksData.length > 0) {
      const episodeIds = [...new Set(booksData.map((b: any) => b.episode_id).filter(Boolean))];
      if (episodeIds.length > 0) {
        const { data: epsData, error: epsError } = await supabase
          .from('book_episodes')
          .select('id, series_name, episode_number, episode_title')
          .in('id', episodeIds);
        if (!epsError && epsData) {
          epsData.forEach((ep: any) => {
            episodesMap[ep.id] = ep;
          });
        }
      }
    }

    // 组装返回数据（保持与原 RPC 返回结构一致）
    const childName = child.nickname;
    const transformedData = (booksData || []).map((item: any) => {
      const ep = episodesMap[item.episode_id] || {};
      return {
        id: item.id,
        child_id: item.child_id,
        episode_id: item.episode_id,
        level_tier: item.level_tier,
        initial_char_count: item.initial_char_count,
        new_chars: item.new_chars,
        cumulative_chars: item.cumulative_chars,
        version: item.version,
        status: item.status,
        created_at: item.created_at,
        updated_at: item.updated_at,
        series_name: ep.series_name,
        episode_number: ep.episode_number,
        episode_title: ep.episode_title,
        child_name: childName,
        episodes: {
          series_name: ep.series_name,
          episode_number: ep.episode_number,
          episode_title: ep.episode_title,
        },
        children: {
          name: childName,
        },
      };
    });
    
    return NextResponse.json({ data: transformedData });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
