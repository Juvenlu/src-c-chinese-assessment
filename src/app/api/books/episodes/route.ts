import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// GET: list all episodes
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const series = searchParams.get("series");
    const status = searchParams.get("status");

    const client = getSupabaseClient();
    let query = client.from("book_episodes").select("*").order("created_at", { ascending: false });
    if (series) query = query.eq("series_name", series);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: create new episode
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { series_name, episode_number, episode_title, page_count } = body;

    const client = getSupabaseClient();
    const { data, error } = await client
      .from("book_episodes")
      .insert([{ series_name, episode_number, episode_title, page_count: page_count || 10, status: "draft" }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
