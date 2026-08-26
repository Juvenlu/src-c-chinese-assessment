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

    const client = getSupabaseClient();

    // 校验 child 归属：该 child_id 必须属于当前登录家长
    const { data: child, error: childError } = await client
      .from('children')
      .select('id')
      .eq('id', childId)
      .eq('parent_id', user.id)
      .eq('status', 'active')
      .single();

    if (childError || !child) {
      return NextResponse.json({ error: '无权访问该孩子的数据' }, { status: 403 });
    }

    // Use RPC function to bypass schema cache issues
    const { data, error } = await client
      .rpc('get_custom_books', { p_child_id: childId });

    if (error) {
      console.error('RPC error:', error);
      throw error;
    }
    
    // Transform data to match expected format
    const transformedData = (data || []).map((item: any) => ({
      ...item,
      episodes: {
        series_name: item.series_name,
        episode_number: item.episode_number,
        episode_title: item.episode_title,
      },
      children: {
        name: item.child_name,
      },
    }));
    
    return NextResponse.json({ data: transformedData });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
