import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

// POST: generate a custom book preview or confirm creation
export async function POST(request: NextRequest) {
  try {
    const { child_id, episode_id, action, pages } = await request.json();

    if (!child_id || !episode_id) {
      return NextResponse.json({ error: "child_id and episode_id required" }, { status: 400 });
    }

    const client = getSupabaseClient();

    // Get child's latest result
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

    // Get pages for this episode
    const { data: pages_data, error: pagesError } = await client
      .from("book_episode_pages")
      .select("*")
      .eq("episode_id", episode_id)
      .order("page_number", { ascending: true });

    if (pagesError) throw pagesError;
    if (!pages_data || pages_data.length === 0) {
      return NextResponse.json({ error: "No pages found for this episode" }, { status: 400 });
    }

    // If action is "preview", generate preview data
    if (action === "preview") {
      const previewPages = pages_data.map((page: any) => {
        const originalText = page.original_text || "";
        const adaptedText = adaptText(originalText, knownCharacters, level === "SRC300" ? 10 : level === "SRC500" ? 20 : 30);
        
        return {
          page_number: page.page_number,
          image_url: page.image_url,
          original_text: originalText,
          adapted_text: adaptedText,
          new_characters: extractNewChars(adaptedText, knownCharacters),
        };
      });

      return NextResponse.json({ 
        data: { 
          preview: true,
          pages: previewPages,
          level_tier: level,
          known_char_count: knownCharacters.length,
        } 
      });
    }

    // If action is "confirm", save to database with user-edited pages
    if (action === "confirm" && pages) {
      try {
        const { data: bookId, error: bookError } = await client
          .rpc('create_custom_book', {
            p_child_id: child_id,
            p_episode_id: episode_id,
            p_level_tier: level,
            p_initial_char_count: knownCharacters.length,
            p_pages_json: pages,
            p_new_chars: pages.flatMap((p: any) => p.new_characters || []),
            p_cumulative_chars: [...new Set([...knownCharacters, ...pages.flatMap((p: any) => p.new_characters || [])])],
            p_version: 1,
          });

        if (bookError) {
          console.error('RPC error:', bookError);
          throw bookError;
        }

        return NextResponse.json({ 
          data: { 
            message: 'Book created successfully',
            book_id: bookId,
            child_id,
            episode_id,
            level_tier: level,
          } 
        });
      } catch (e: any) {
        console.error('Book generation error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Invalid action. Use 'preview' or 'confirm'" }, { status: 400 });
  } catch (e: any) {
    console.error("Book generation error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Simple text adaptation function
function adaptText(text: string, knownChars: string[], targetLength: number): string {
  const sentences = text.split(/[。！？]/).filter(s => s.trim());
  let result = "";
  
  for (const sentence of sentences) {
    if (result.length >= targetLength) break;
    
    const chars = Array.from(sentence);
    const knownCount = chars.filter(c => knownChars.includes(c)).length;
    const knownRatio = knownCount / chars.length;
    
    if (knownRatio >= 0.7) {
      result += sentence + "。";
    } else if (knownRatio >= 0.5) {
      const simplified = sentence.slice(0, Math.min(sentence.length, targetLength - result.length));
      result += simplified + "。";
    }
  }
  
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
