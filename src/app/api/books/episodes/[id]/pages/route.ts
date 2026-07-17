import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { S3Storage } from "coze-coding-dev-sdk";

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: "",
  secretKey: "",
  bucketName: process.env.COZE_BUCKET_NAME,
  region: "cn-beijing",
});

// POST: upload pages (images + texts) for an episode
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const formData = await request.formData();
    const episodeId = id;
    const imageFiles = formData.getAll("images") as File[];
    const wordFile = formData.get("word_file") as File | null;

    // Parse Word document to extract text (simplified: split by paragraphs)
    let pageTexts: string[] = [];
    if (wordFile) {
      // For now, we'll store the raw text content
      // In production, use mammoth or docx parser
      const text = await wordFile.text();
      // Simple split by newlines or paragraphs
      pageTexts = text.split(/\n+/).filter(t => t.trim());
    }

    // Upload images to S3
    const pages = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      if (file instanceof File && file.type.startsWith("image/")) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const key = await storage.uploadFile({
          fileContent: buffer,
          fileName: `books/${episodeId}/${Date.now()}_${file.name}`,
          contentType: file.type,
        });
        const url = await storage.generatePresignedUrl({ key, expireTime: 315360000 }); // 10 years
        
        pages.push({
          episode_id: episodeId,
          page_number: i + 1,
          image_url: url,
          original_text: pageTexts[i] || "",
        });
      }
    }

    // Save pages to DB
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("book_episode_pages")
      .insert(pages)
      .select();

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (e: any) {
    console.error("Pages upload error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
