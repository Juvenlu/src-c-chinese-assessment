import { NextRequest, NextResponse } from "next/server";
import { listFinalRewritesByChild } from "@/lib/book-rewrite/rewrite-store";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * GET /api/books/rewrites?child_id={childId}&status=final
 *
 * 返回孩子的 Final Rewrite 列表（孩子端「AI 定制绘本」区域使用）
 * 严格按 child_id 过滤，默认只返回 final 状态
 * 附带 episode 信息（series_name / episode_number / episode_title）
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const childId = searchParams.get("child_id");
    const status = searchParams.get("status") || "final";

    if (!childId) {
      return NextResponse.json(
        { error: "child_id is required" },
        { status: 400 }
      );
    }

    const rewrites = await listFinalRewritesByChild(childId);

    if (rewrites.length === 0) {
      return NextResponse.json({ rewrites: [] });
    }

    // 批量查询 episode 信息
    const episodeIds = [...new Set(rewrites.map((r) => r.episode_id).filter(Boolean))];
    let episodesMap: Record<number, any> = {};

    if (episodeIds.length > 0) {
      const client = getSupabaseClient();
      const { data: episodes, error } = await client
        .from("book_episodes")
        .select("id, series_name, episode_number, episode_title")
        .in("id", episodeIds);

      if (error) throw error;

      for (const ep of episodes || []) {
        episodesMap[ep.id] = ep;
      }
    }

    // 组装返回数据（列表页用，不含完整 pages_json）
    const rewritesWithEpisode = rewrites.map((r) => {
      const ep = episodesMap[r.episode_id] || {};
      return {
        id: r.id,
        episode_id: r.episode_id,
        child_id: r.child_id,
        target_level: r.target_level,
        status: r.status,
        version: r.version,
        created_at: r.created_at,
        finalized_at: r.finalized_at,
        page_count: Array.isArray(r.pages_json) ? r.pages_json.length : 0,
        frontier_targets: r.frontier_targets,
        series_name: ep.series_name || null,
        episode_number: ep.episode_number || null,
        episode_title: ep.episode_title || null,
        cover_image_url: ep.cover_image_url || null,
      };
    });

    return NextResponse.json({ rewrites: rewritesWithEpisode });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Failed to load rewrites" },
      { status: 500 }
    );
  }
}
