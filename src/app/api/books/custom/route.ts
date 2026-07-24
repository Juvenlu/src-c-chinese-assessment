import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// GET: list custom books for a child (or all)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const childId = searchParams.get("child_id");

    const client = getSupabaseClient();
    
    // Use RPC function to bypass schema cache issues
    const { data, error } = await client
      .rpc('get_custom_books', { p_child_id: childId && childId !== "all" ? childId : null });

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
