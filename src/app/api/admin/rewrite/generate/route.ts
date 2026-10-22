import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerUrl, WORKER_FETCH_INIT } from '../../../lib/worker-target'
import {
  generateRewrite,
  type ChildReadingProfile,
  type GenerateResult,
} from '@/lib/book-rewrite/generator'
import { selectFrontiers } from '@/lib/book-rewrite/frontier'
import { runAllValidations } from '@/lib/book-rewrite/validation'
import type { Level } from '@/lib/types'

/**
 * POST /api/admin/rewrite/generate
 *
 * BookWriter 一键 AI 个性化改写——编排层。
 *
 * 流程（任一步失败均零写入，不产生可发布版本）：
 *   1. 参数与鉴权前置检查（x-admin-password 由 Worker 端逐次强校验）
 *   2. Worker 读 Master Pages（D1）
 *   3. Worker 读孩子真实阅读档案（D1 test_results formal 记录）
 *   4. 档案充分性校验：无 formal 记录或已知字表为空 → 422 明确报错，
 *      绝不伪装为完整个性化（掌握率字段 D1 不存在，传 null 降级展示）
 *   5. selectFrontiers（已知字组成的新词优先）
 *   6. generateRewrite（LLM；内部强制页数一致 + image_url/original_text 回填）
 *   7. 确定性验证：阅读量（level-rules 口径，SRC500=500-600）+
 *      runAllValidations 五类（≥4/5）+ Master 图片/原文逐项断言
 *      ——任一失败 → 422，不落库
 *   8. Worker POST /v1/admin/rewrite/generated（status 硬编码 review，幂等）
 *
 * 本路由绝不：自动 Finalize / Activate / Push；触碰 Master；写 Supabase/旧 PG。
 * 日志安全：不输出管理员密码、LLM Key、孩子档案内容，仅记录 ID 与计数。
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// LLM 调用可能超过默认超时
export const maxDuration = 120

const SERVICE_KEY = process.env.SRC_WORKER_SERVICE_KEY
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const WORKER_ENABLED =
  process.env.WORKER_GUEST_API_ENABLED === 'true' ||
  process.env.WORKER_CHILDREN_ENABLED === 'true' ||
  IS_PRODUCTION

const VALID_LEVELS: Level[] = ['SRC100', 'SRC300', 'SRC500', 'SRC800']

interface GenerateBody {
  episode_id?: number | string
  child_id?: string
  target_level?: string
}

interface MasterPage {
  page: number
  text: string
  image_url?: string
}

interface ReadingProfileLevelEntry {
  level: string
  stable_char_count: number | null
  stable_vocab_count: number | null
  total_questions: number | null
  correct_count: number | null
  known_characters_count: number
  weak_characters_count: number
  completed_at: string | null
}

interface ReadingProfileData {
  child: { id: string; nickname: string }
  confirmed_level: string | null
  levels: ReadingProfileLevelEntry[]
  known_characters: string[]
  weak_characters: string[]
}

/** 带鉴权的 Worker 调用（x-admin-password 透传 + Service Key + 禁止重定向） */
async function callWorker(
  baseUrl: string,
  path: string,
  adminPwd: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': adminPwd,
      'X-SRC-Service-Key': SERVICE_KEY as string,
      ...(init.headers || {}),
    },
    cache: 'no-store',
    ...WORKER_FETCH_INIT,
  })
}

export async function POST(req: NextRequest) {
  // ---- 0. 环境与配置守卫（resolveWorkerUrl 内含 Preview/Production 隔离守卫）----
  const workerBaseUrl = resolveWorkerUrl(process.env.WORKER_BASE_URL, process.env)
  if (!WORKER_ENABLED || !workerBaseUrl || !SERVICE_KEY) {
    if (IS_PRODUCTION) {
      return NextResponse.json({ error: '服务配置错误' }, { status: 500 })
    }
    return NextResponse.json(
      { error: 'Worker 未启用或当前环境禁止访问 Production Worker' },
      { status: 503 },
    )
  }

  const adminPwd = req.headers.get('x-admin-password') || ''
  if (!adminPwd) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ---- 1. 参数校验 ----
  let body: GenerateBody
  try {
    body = (await req.json()) as GenerateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const episodeId = Number(body.episode_id)
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    return NextResponse.json({ error: 'episode_id required' }, { status: 400 })
  }
  const childId = typeof body.child_id === 'string' ? body.child_id.trim() : ''
  if (!childId) {
    return NextResponse.json({ error: 'child_id required' }, { status: 400 })
  }
  const targetLevel = body.target_level as Level
  if (!VALID_LEVELS.includes(targetLevel)) {
    return NextResponse.json({ error: 'invalid target_level' }, { status: 400 })
  }

  const startedAt = Date.now()

  try {
    // ---- 2. 读 Master Pages（D1 via Worker）----
    const masterRes = await callWorker(
      workerBaseUrl,
      `/v1/admin/episodes/${episodeId}/pages`,
      adminPwd,
    )
    if (masterRes.status === 401) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!masterRes.ok) {
      const errText = await masterRes.text()
      return NextResponse.json(
        { error: `读取 Master 失败 (HTTP ${masterRes.status})`, detail: errText.slice(0, 300) },
        { status: masterRes.status === 404 ? 404 : 502 },
      )
    }
    const masterData = await masterRes.json()
    const masterPages = (masterData?.data?.pages || []) as MasterPage[]
    if (!Array.isArray(masterPages) || masterPages.length === 0) {
      return NextResponse.json({ error: 'Master 无页面数据' }, { status: 404 })
    }

    // ---- 3. 读孩子真实阅读档案（D1 via Worker）----
    const profileRes = await callWorker(
      workerBaseUrl,
      `/v1/admin/children/${encodeURIComponent(childId)}/reading-profile`,
      adminPwd,
    )
    if (profileRes.status === 401) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!profileRes.ok) {
      const errText = await profileRes.text()
      return NextResponse.json(
        { error: `读取孩子档案失败 (HTTP ${profileRes.status})`, detail: errText.slice(0, 300) },
        { status: profileRes.status === 404 ? 404 : 502 },
      )
    }
    const profileData = (await profileRes.json())?.data as ReadingProfileData | undefined
    if (!profileData || !profileData.child) {
      return NextResponse.json({ error: '孩子档案数据异常' }, { status: 502 })
    }

    // ---- 4. 档案充分性校验（不满足则明确报错，绝不伪装完整个性化）----
    if (!Array.isArray(profileData.levels) || profileData.levels.length === 0) {
      return NextResponse.json(
        {
          error: '孩子阅读档案不足：没有任何已完成的正式测评记录，无法进行个性化改写',
          code: 'PROFILE_INSUFFICIENT',
        },
        { status: 422 },
      )
    }
    if (!Array.isArray(profileData.known_characters) || profileData.known_characters.length === 0) {
      return NextResponse.json(
        {
          error: '孩子阅读档案不足：正式测评中未观测到已掌握汉字，无法进行个性化改写',
          code: 'PROFILE_INSUFFICIENT',
        },
        { status: 422 },
      )
    }

    // 锚定等级记录：优先与目标等级一致，否则取已测最高等级（levels 按等级升序排列）
    const anchor =
      profileData.levels.find((l) => l.level === targetLevel) ||
      profileData.levels[profileData.levels.length - 1]

    // ---- 5. 装配 ChildReadingProfile ----
    // 掌握率：D1 无该字段，传 null 降级（prompt 中整行省略），不得把整级正确率虚构为掌握率
    const childProfile: ChildReadingProfile = {
      observed_known_chars: profileData.known_characters.length,
      stable_char_count: anchor.stable_char_count ?? 0,
      stable_vocab_count: anchor.stable_vocab_count ?? 0,
      character_mastery_rate: null,
      vocab_mastery_rate: null,
      known_characters: profileData.known_characters,
      weak_char_signals: profileData.weak_characters || [],
      weak_word_signals: [],
      child_nickname: profileData.child.nickname,
      generation_mode: 'child_specific',
    }

    // ---- 6. Frontier 选择（已知字组成的新词优先）----
    const masterFullText = masterPages.map((p) => p.text).join('\n')
    const frontiers = selectFrontiers(masterFullText, profileData.known_characters, 4)

    // ---- 7. LLM 生成（内部强制：页数一致 + image_url/original_text 回填）----
    let genResult: GenerateResult
    try {
      genResult = await generateRewrite(
        masterPages,
        targetLevel,
        frontiers,
        childProfile,
        req.headers,
      )
    } catch (llmError) {
      console.error(
        `[rewrite/generate] LLM 生成失败 episode=${episodeId} child=${childId.slice(0, 8)}:`,
        llmError instanceof Error ? llmError.message.slice(0, 200) : 'Unknown',
      )
      return NextResponse.json(
        {
          error: 'AI 生成失败',
          message: llmError instanceof Error ? llmError.message.slice(0, 300) : 'Unknown error',
        },
        { status: 502 },
      )
    }

    // ---- 8. 确定性质量验证（失败不落库，不产生可 Finalize 版本）----
    // 8a. 阅读量（level-rules 口径：SRC500 = 500-600 汉字）
    if (genResult.volume_validation.volume_status !== 'pass') {
      return NextResponse.json(
        {
          error: '生成结果未达到阅读量标准，未保存',
          code: 'VOLUME_CHECK_FAILED',
          volume_validation: genResult.volume_validation,
        },
        { status: 422 },
      )
    }

    // 8b. Master Asset Lock 断言：图片与原文必须与 Master 逐项一致
    for (let i = 0; i < masterPages.length; i++) {
      const gen = genResult.pages[i]
      const master = masterPages[i]
      if (
        gen.page !== master.page ||
        gen.image_url !== master.image_url ||
        gen.original_text !== master.text
      ) {
        console.error(
          `[rewrite/generate] Master Asset Lock 断言失败 episode=${episodeId} page=${master.page}`,
        )
        return NextResponse.json(
          { error: '生成结果违反 Master 结构保护，未保存', code: 'MASTER_LOCK_VIOLATION' },
          { status: 500 },
        )
      }
    }

    // 8c. 五类验证（阅读量/语言难度/Frontier/故事保持/图文一致性，≥4/5 通过）
    const originalPages = masterPages.map((p) => ({ page: p.page, text: p.text }))
    const validationResult = runAllValidations(
      genResult.pages,
      targetLevel,
      profileData.known_characters,
      originalPages,
      frontiers,
    )
    if (!validationResult.overall_pass) {
      return NextResponse.json(
        {
          error: '生成结果未通过质量验证，未保存',
          code: 'VALIDATION_FAILED',
          validation: validationResult,
        },
        { status: 422 },
      )
    }

    const generationSeconds = Math.round((Date.now() - startedAt) / 100) / 10

    // ---- 9. 受控落库（status=review；Worker 端幂等 + Master 回填双保险）----
    const saveRes = await callWorker(
      workerBaseUrl,
      '/v1/admin/rewrite/generated',
      adminPwd,
      {
        method: 'POST',
        body: JSON.stringify({
          episode_id: episodeId,
          child_id: childId,
          target_level: targetLevel,
          pages: genResult.pages,
          frontier_targets: frontiers,
          generation_params: {
            model: 'doubao-seed-2-1-pro-260915',
            temperature: 0.7,
            frontiers,
            child_nickname: profileData.child.nickname,
            pipeline_version: 'MULTIBOOK-13 one-click AI generate',
            generation_mode: 'child_specific',
            known_characters_count: profileData.known_characters.length,
            stable_char_count: childProfile.stable_char_count,
            stable_vocab_count: childProfile.stable_vocab_count,
            volume_validation: genResult.volume_validation,
            generation_seconds: generationSeconds,
          },
          validation_result: validationResult,
        }),
      },
    )

    const saveText = await saveRes.text()
    if (saveRes.status === 409) {
      // 幂等冲突：已存在活跃待审核版本
      return new NextResponse(saveText, {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (!saveRes.ok) {
      console.error(
        `[rewrite/generate] 落库失败 episode=${episodeId} status=${saveRes.status}`,
      )
      return NextResponse.json(
        { error: `保存生成稿失败 (HTTP ${saveRes.status})`, detail: saveText.slice(0, 300) },
        { status: 502 },
      )
    }

    const saved = JSON.parse(saveText)
    return NextResponse.json(
      {
        success: true,
        rewrite_id: saved.rewrite_id ?? saved.id,
        status: saved.status,
        version: saved.version,
        total_chars: saved.total_chars,
        unique_chars: saved.unique_chars,
        volume_validation: genResult.volume_validation,
        validation_summary: validationResult.summary,
        generation_seconds: generationSeconds,
        frontiers,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error(
      `[rewrite/generate] 编排异常 episode=${episodeId}:`,
      error instanceof Error ? error.message.slice(0, 200) : 'Unknown',
    )
    return NextResponse.json(
      {
        error: 'AI 生成编排失败',
        message: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
