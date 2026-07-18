import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// GET: list custom books for a child (or all)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const childId = searchParams.get("child_id");

    const client = getSupabaseClient();
    
    // 使用 RPC 或直接查询来绕过 schema cache 问题
    let query = client
      .from("custom_books")
      .select("*, episodes:book_episodes(series_name, episode_number, episode_title), children(name)")
      .order("created_at", { ascending: false });

    if (childId && childId !== "all") {
      query = query.eq("child_id", childId);
    }

    const { data, error } = await query;

    if (error) {
      // 如果表不存在，返回空数组而不是错误
      if (error.message.includes("Could not find the table")) {
        return NextResponse.json({ data: [] });
      }
      throw error;
    }
    return NextResponse.json({ data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
