import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// POST: generate a custom book for a child based on their known characters
export async function POST(request: NextRequest) {
  try {
    const { child_id, episode_id } = await request.json();

    if (!child_id || !episode_id) {
      return NextResponse.json({ error: "child_id and episode_id required" }, { status: 400 });
    }

    // Get child's latest result to know their known characters
    const client = getSupabaseClient();
    const { data: results, error: resultError } = await client
      .from("test_results")
      .select("*")
      .eq("child_id", child_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (resultError) throw resultError;
    if (!results || results.length === 0) {
      return NextResponse.json({ error: "No test results found for this child" }, { status: 400 });
    }

    const latestResult = results[0];
    const knownCharacters = latestResult.known_characters || [];
    const level = latestResult.level;

    // Get episode with pages
    const { data: episode, error: epError } = await client
      .from("book_episodes")
      .select("*")
      .eq("id", episode_id)
      .single();

    if (epError) throw epError;
    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }

    // Get pages for this episode
    const { data: pages, error: pagesError } = await client
      .from("book_episode_pages")
      .select("*")
      .eq("episode_id", episode_id)
      .order("page_number", { ascending: true });

    if (pagesError) throw pagesError;
    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: "No pages found for this episode" }, { status: 400 });
    }

    // Determine target text length per page based on level
    const targetPerPage = level === "SRC300" ? 10 : level === "SRC500" ? 20 : 30;
    const maxNewChars = Math.ceil(knownCharacters.length * 0.05); // 5% new chars

    // Rewrite each page using LLM-like logic (simplified: filter and adapt text)
    // In production, this would call an LLM API
    const rewrittenPages: any[] = [];
    for (const page of pages) {
      const originalText = page.original_text || "";
      // Simple adaptation: keep sentences that use known characters, add pinyin for new ones
      const adaptedText = adaptText(originalText, knownCharacters, targetPerPage);
      
      rewrittenPages.push({
        page_number: page.page_number,
        image_url: page.image_url,
        original_text: originalText,
        adapted_text: adaptedText,
        new_characters: extractNewChars(adaptedText, knownCharacters),
      });
    }

    // Create custom book record
    const { data: book, error: bookError } = await client
      .from("custom_books")
      .insert({
        child_id,
        episode_id,
        level_tier: level,
        initial_char_count: knownCharacters.length,
        pages_json: rewrittenPages,
        new_chars: rewrittenPages.flatMap((p) => p.new_characters),
        cumulative_chars: [...new Set([...knownCharacters, ...rewrittenPages.flatMap((p) => p.new_characters)])],
        version: 1,
      })
      .select()
      .single();

    if (bookError) throw bookError;

    return NextResponse.json({ data: book });
  } catch (e: any) {
    console.error("Book generation error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Simple text adaptation function
function adaptText(text: string, knownChars: string[], targetLength: number): string {
  // Split into sentences
  const sentences = text.split(/[。！？]/).filter(s => s.trim());
  let result = "";
  
  for (const sentence of sentences) {
    if (result.length >= targetLength) break;
    
    // Check if sentence uses mostly known characters
    const chars = Array.from(sentence);
    const knownCount = chars.filter(c => knownChars.includes(c)).length;
    const knownRatio = knownCount / chars.length;
    
    if (knownRatio >= 0.7) {
      result += sentence + "。";
    } else if (knownRatio >= 0.5) {
      // Simplify the sentence
      const simplified = sentence.slice(0, Math.min(sentence.length, targetLength - result.length));
      result += simplified + "。";
    }
  }
  
  // If still too short, add simple filler
  if (result.length < targetLength * 0.5) {
    result = text.slice(0, targetLength);
  }
  
  return result;
}

function extractNewChars(text: string, knownChars: string[]): string[] {
  const chars = Array.from(text);
  const newChars = chars.filter(c => !knownChars.includes(c) && /[\u4e00-\u9fa5]/.test(c));
  return [...new Set(newChars)];
}
