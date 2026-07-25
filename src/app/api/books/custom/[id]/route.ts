import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// GET: get a single custom book with pages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    
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
