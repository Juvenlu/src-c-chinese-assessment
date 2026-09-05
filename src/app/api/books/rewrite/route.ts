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
    const {
      episode_id,
      target_level,
      child_id,
      custom_frontiers,
      generation_mode, // 'child_specific' | 'generic' — 可选，默认 child_specific（有 child_id 时）
    } = body

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
    const weakCharSignals = new Set<string>()
    const weakWordSignals = new Set<string>()
    let childNickname: string | undefined = undefined

    // 如果提供了 target_level，直接使用
    if (target_level && isValidLevel(target_level)) {
      targetLevel = target_level as Level
    }

    let childProfile: import('@/lib/book-rewrite/generator').ChildReadingProfile | undefined = undefined

    // 如果提供了 child_id，从 test_results 计算 confirmed_level 和 known_characters
    // 注意：test_results 表没有 status/completed_at 字段，使用 test_mode + created_at
    if (child_id) {
      // 获取孩子基本信息
      const { data: childData, error: childError } = await supabase
        .from('children')
        .select('nickname')
        .eq('id', child_id)
        .single()
      if (!childError && childData) {
        childNickname = childData.nickname
      }

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

          // 合并该等级及以下所有正式测试的 known_characters（累积已知字）
          // 例：target_level=SRC300 → 合并 SRC100 + SRC300 的 known_characters
          const LEVEL_ORDER = ['SRC100', 'SRC300', 'SRC500', 'SRC800']
          const targetIdx = targetLevel ? LEVEL_ORDER.indexOf(targetLevel) : -1
          const targetLevelResults = targetIdx >= 0
            ? formalResults.filter((r: any) => {
                const idx = LEVEL_ORDER.indexOf(r.level)
                return idx >= 0 && idx <= targetIdx
              })
            : formalResults

          // 取每个等级最新一次测试结果的 known_characters
          const perLevelLatest = new Map<string, any>()
          for (const r of targetLevelResults) {
            if (!perLevelLatest.has(r.level)) {
              perLevelLatest.set(r.level, r)
            }
          }

          for (const r of perLevelLatest.values()) {
            if (r.known_characters && Array.isArray(r.known_characters)) {
              for (const ch of r.known_characters) knownChars.add(ch)
            }
            if (r.known_vocabulary && Array.isArray(r.known_vocabulary)) {
              for (const w of r.known_vocabulary) knownWords.add(w)
            }
          }

          // 收集 Weakness Signals：从 test_answers 中找错误答案（只看本等级会话）
          try {
            const { data: sessionsData } = await supabase
              .from('test_sessions')
              .select('id')
              .eq('child_id', child_id)
              .eq('level', targetLevel)

            if (sessionsData && sessionsData.length > 0) {
              const sessionIds = sessionsData.map((s: any) => s.id)
              const { data: wrongAnswers } = await supabase
                .from('test_answers')
                .select('question_id')
                .eq('is_correct', false)
                .in('session_id', sessionIds)

              if (wrongAnswers && wrongAnswers.length > 0) {
                const questionIds = [...new Set(wrongAnswers.map((a: any) => a.question_id))]
                const { data: wrongQuestions } = await supabase
                  .from('question_bank')
                  .select('character, word')
                  .in('id', questionIds)
                if (wrongQuestions) {
                  for (const q of wrongQuestions) {
                    if (q.character) weakCharSignals.add(q.character)
                    if (q.word) weakWordSignals.add(q.word)
                  }
                }
              }
            }
          } catch (e) {
            // silence: weak signals are supplementary
          }

          // 取目标等级对应的最新结果作为 stable_char_count 等主指标
          const targetLevelLatest = perLevelLatest.get(targetLevel || '') || latest
          // 组装孩子阅读画像（用于 i+1 个性化生成）
          childProfile = {
            observed_known_chars: knownChars.size,
            stable_char_count: targetLevelLatest.stable_char_count || 0,
            stable_vocab_count: targetLevelLatest.stable_vocab_count || 0,
            character_mastery_rate: targetLevelLatest.character_mastery_rate || 0,
            vocab_mastery_rate: targetLevelLatest.vocab_mastery_rate || 0,
            known_characters: Array.from(knownChars),
            known_vocabulary: Array.from(knownWords),
            weak_char_signals: Array.from(weakCharSignals),
            weak_word_signals: Array.from(weakWordSignals),
            child_nickname: childNickname,
            generation_mode: 'child_specific',
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

    // 决定 generation_mode
    const mode: 'generic' | 'child_specific' =
      generation_mode === 'generic' ? 'generic' : child_id ? 'child_specific' : 'generic'

    // 如果是 generic 模式，清除 childProfile
    if (mode === 'generic' && childProfile) {
      childProfile = {
        ...childProfile,
        generation_mode: 'generic',
        known_characters: [],
        known_vocabulary: [],
        weak_char_signals: [],
        weak_word_signals: [],
        child_nickname: undefined,
      }
    }

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

    // 保存到数据库
    // 阅读量超限也标记为失败
    const volumePass = result.volume_validation.volume_status === 'pass'
    const success = validation.overall_pass && volumePass

    // 构造 profile snapshot（只存元数据摘要，保护隐私）
    const profileSnapshot = childProfile
      ? {
          confirmed_level: targetLevel,
          known_characters_count: childProfile.known_characters?.length || 0,
          known_vocabulary_count: childProfile.known_vocabulary?.length || 0,
          weak_char_signals_count: childProfile.weak_char_signals?.length || 0,
          weak_word_signals_count: childProfile.weak_word_signals?.length || 0,
          stable_char_count: childProfile.stable_char_count || 0,
          character_mastery_rate: childProfile.character_mastery_rate || 0,
          profile_version: 'v1.0',
        }
      : null

    const record = await insertRewrite({
      episodeId: episode_id,
      targetLevel,
      pages: result.pages,
      frontierTargets: frontiers,
      generationParams: {
        model: 'doubao-seed-2-0-pro-260215',
        prompt_version: 'v1.2',
        generation_mode: mode,
        child_id: child_id || null,
        profile_snapshot: profileSnapshot,
        custom_frontiers: custom_frontiers || null,
        rewrite_notes: result.rewrite_notes || null,
        volume_validation: result.volume_validation,
      } as any,
      validationResult: validation,
      status: success ? 'ai_draft' : 'failed',
      childId: child_id,
      failureReason: success
        ? undefined
        : !volumePass
          ? `volume_${result.volume_validation.volume_status}: ${result.volume_validation.actual_count}/${result.volume_validation.target_min}-${result.volume_validation.target_max}`
          : validation.summary,
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
