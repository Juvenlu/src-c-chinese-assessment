import { NextResponse } from 'next/server'
import { getConfirmedLevel, isValidLevel } from '@/lib/level-service'
import { generateRewrite } from '@/lib/book-rewrite/generator'
import { insertRewrite } from '@/lib/book-rewrite/rewrite-store'
import { getSupabaseClient } from '@/storage/database/supabase-client'
import { selectFrontiers } from '@/lib/book-rewrite/frontier'
import { runAllValidations } from '@/lib/book-rewrite/validation'
import type { Level } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { episode_id, target_level, child_id, custom_frontiers } = body

    // 简易鉴权（与 admin API 保持一致）
    const ADMIN_PASSWORD = 'srcc2026'
    const adminPwd = request.headers.get('x-admin-password')
    if (adminPwd !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!episode_id) {
      return NextResponse.json({ error: '缺少 episode_id' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // 读取 Master Story pages
    const { data: pages, error: pagesError } = await supabase
      .from('book_episode_pages')
      .select('page_number, original_text, image_url')
      .eq('episode_id', episode_id)
      .order('page_number', { ascending: true })

    if (pagesError) throw pagesError
    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: 'Episode has no pages' }, { status: 404 })
    }

    let targetLevel: Level | null = null
    const knownChars = new Set<string>()
    const knownWords = new Set<string>()

    // 如果提供了 target_level，直接使用
    if (target_level && isValidLevel(target_level)) {
      targetLevel = target_level as Level
    }

    let childProfile: {
      observed_known_chars: number;
      stable_char_count: number;
      stable_vocab_count: number;
      character_mastery_rate: number;
      vocab_mastery_rate: number;
    } | undefined = undefined

    // 如果提供了 child_id，从 test_results 计算 confirmed_level 和 known_characters
    // 注意：test_results 表没有 status/completed_at 字段，使用 test_mode + created_at
    if (child_id) {
      const { data: allResults, error: allError } = await supabase
        .from('test_results')
        .select('*')
        .eq('child_id', child_id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (!allError && allResults && allResults.length > 0) {
        // 过滤 formal/full 正式测试（test_results 表无 status 字段，
        // 能出现在 test_results 中的本身就是已完成计算的结果）
        const formalResults = allResults.filter(
          (r: any) => r.test_mode === 'full' || r.test_mode === 'formal'
        )
        if (formalResults.length > 0) {
          const latest = formalResults[0]
          const confirmed = getConfirmedLevel(latest as any)
          if (!targetLevel && confirmed) {
            targetLevel = confirmed
          }
          // 合并所有正式测试的 known_characters
          for (const r of formalResults) {
            if (r.known_characters && Array.isArray(r.known_characters)) {
              for (const ch of r.known_characters) knownChars.add(ch)
            }
            if (r.known_vocabulary && Array.isArray(r.known_vocabulary)) {
              for (const w of r.known_vocabulary) knownWords.add(w)
            }
          }
          // 组装孩子阅读画像（用于 i+1 个性化生成）
          childProfile = {
            observed_known_chars: knownChars.size,
            stable_char_count: latest.stable_char_count || 0,
            stable_vocab_count: latest.stable_vocab_count || 0,
            character_mastery_rate: latest.character_mastery_rate || 0,
            vocab_mastery_rate: latest.vocab_mastery_rate || 0,
          }
        }
      }
    }

    if (!targetLevel) {
      return NextResponse.json({ error: '无法确定目标等级' }, { status: 400 })
    }

    const masterPages = pages.map((p: any) => ({
      page: p.page_number,
      text: p.original_text,
      image_url: p.image_url,
    }))

    // 准备 Frontiers
    const masterText = masterPages.map((p) => p.text).join('\n')
    const knownCharsArr = Array.from(knownChars)
    const knownWordsArr = Array.from(knownWords)
    const frontiers = custom_frontiers && custom_frontiers.length > 0
      ? custom_frontiers
      : selectFrontiers(masterText, knownCharsArr, 5)

    // 生成改写
    const result = await generateRewrite(masterPages, targetLevel, frontiers, childProfile)

    // Validation
    const validation = runAllValidations(
      result.pages,
      targetLevel,
      knownCharsArr,
      masterPages,
      frontiers,
    )

    const success = validation.overall_pass

    // 保存到数据库
    const record = await insertRewrite({
      episodeId: episode_id,
      targetLevel,
      pages: result.pages,
      frontierTargets: frontiers,
      generationParams: {
        model: 'doubao-seed-2-0-pro-260215',
        prompt_version: 'v1.1',
        child_id: child_id || null,
        child_profile: childProfile || null,
        custom_frontiers: custom_frontiers || null,
        rewrite_notes: result.rewrite_notes || null,
      } as any,
      validationResult: validation,
      status: success ? 'ai_draft' : 'failed',
      childId: child_id,
      failureReason: success ? undefined : validation.summary,
    })

    return NextResponse.json({
      success,
      rewrite_id: record.id,
      status: record.status,
      target_level: record.target_level,
      page_count: result.pages.length,
      frontiers,
      child_profile: childProfile || null,
      validation,
    })
  } catch (error: any) {
    console.error('[books/rewrite] error:', error)
    return NextResponse.json({ error: error.message || '生成失败' }, { status: 500 })
  }
}
