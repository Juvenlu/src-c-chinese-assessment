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
    const client = getSupabaseClient();

    // 先取绘本详情，拿到 child_id 做归属校验
    const { data: book, error: bookError } = await client
      .from('custom_books')
      .select('child_id')
      .eq('id', parseInt(id))
      .single();

    if (bookError || !book) {
      return NextResponse.json({ error: "绘本不存在" }, { status: 404 });
    }

    // 校验 child 归属当前家长
    const { data: child, error: childError } = await client
      .from('children')
      .select('id')
      .eq('id', book.child_id)
      .eq('parent_id', user.id)
      .eq('status', 'active')
      .single();

    if (childError || !child) {
      return NextResponse.json({ error: '无权访问该绘本' }, { status: 403 });
    }

    // 使用 RPC 函数绕过 schema cache 问题
    const { data, error } = await client.rpc("get_custom_book_by_id", { p_book_id: parseInt(id) });

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "绘本不存在" }, { status: 404 });
    }
    
    return NextResponse.json({ data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
