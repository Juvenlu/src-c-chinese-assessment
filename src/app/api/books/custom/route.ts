import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// GET: list custom books for a child (or all)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const childId = searchParams.get("child_id");

    const client = getSupabaseClient();
    let query = client
      .from("custom_books")
      .select("*, episodes:book_episodes(series_name, episode_number, episode_title), children(name)")
      .order("created_at", { ascending: false });

    if (childId && childId !== "all") {
      query = query.eq("child_id", childId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
