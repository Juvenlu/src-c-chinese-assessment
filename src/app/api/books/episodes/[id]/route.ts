import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();
    const { data: episode, error: epError } = await client
      .from("book_episodes")
      .select("*, pages:book_episode_pages(*)")
      .eq("id", id)
      .single();

    if (epError) throw epError;
    return NextResponse.json({ data: episode });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    const client = getSupabaseClient();
    const { data, error } = await client
      .from("book_episodes")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
