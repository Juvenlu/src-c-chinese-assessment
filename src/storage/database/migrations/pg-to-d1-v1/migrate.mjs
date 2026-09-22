#!/usr/bin/env node
/**
 * SRC Primary Database — PostgreSQL → Cloudflare D1 Migration Script v1.0
 *
 * Usage:
 *   PG_DATABASE_URL=<pg_url> \
 *   CLOUDFLARE_D1_TOKEN=<token> \
 *   CLOUDFLARE_D1_DATABASE_ID=<db_id> \
 *   CLOUDFLARE_ACCOUNT_ID=<account_id> \
 *   node src/storage/database/migrations/pg-to-d1-v1/migrate.mjs
 *
 * Rules (D1 Schema V2.1 LOCKED):
 * - full/fulltest → formal (original mode in part_breakdown_json)
 * - 2 historical custom_books skipped
 * - confirmed_level = NULL
 * - difficulty = NULL
 * - level_tier = 'SRC500' (master story default)
 * - generator_version = NULL
 * - audit_passed = 0 (placeholder, NOT audit failure)
 * - book_entitlements: allocated=10, used=0
 */

import pg from 'pg';
const { Pool } = pg;

// ---- Config ----
const config = {
  pgUrl: process.env.PG_DATABASE_URL,
  cfToken: process.env.CLOUDFLARE_D1_TOKEN,
  cfAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  cfDatabaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
  batchSize: 500,
  dryRun: process.env.DRY_RUN === '1',
};

// ---- Source ----
const pgPool = new Pool({
  connectionString: config.pgUrl,
  max: 2,
});

// ---- D1 Helper ----
async function d1Query(sql, params = []) {
  if (config.dryRun) return { results: [] };
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.cfAccountId}/d1/database/${config.cfDatabaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.cfToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  return data.result[0];
}

// ---- Utilities ----
function tsToUnix(ts) {
  if (ts == null) return null;
  return Math.floor(new Date(ts).getTime() / 1000);
}

function boolToInt(b) {
  if (b == null) return 0;
  return b ? 1 : 0;
}

function jsonToText(j) {
  if (j == null) return null;
  return JSON.stringify(j);
}

function arrayToJson(arr) {
  if (arr == null) return '[]';
  return JSON.stringify(arr);
}

// ---- Migration Stats ----
const stats = {};
const skipped = [];
const failed = [];

function initStat(name) {
  stats[name] = { source: 0, inserted: 0, skipped: 0, failed: 0 };
}

// ========================================
// MIGRATION STEPS (by dependency order)
// ========================================

// ---- Phase 1: Parents + Lookup Tables ----

async function migrateParents() {
  initStat('parents');
  const { rows } = await pgPool.query('SELECT * FROM parents_profiles ORDER BY id');
  stats.parents.source = rows.length;

  for (const row of rows) {
    try {
      await d1Query(
        `INSERT INTO parents (id, email, password_hash, email_verified, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.email,
          row.password_hash,
          boolToInt(row.email_verified),
          row.status || 'active',
          tsToUnix(row.created_at),
          row.updated_at ? tsToUnix(row.updated_at) : tsToUnix(row.created_at),
        ]
      );
      stats.parents.inserted++;
    } catch (e) {
      stats.parents.failed++;
      failed.push({ table: 'parents', id: row.id, error: e.message });
    }
  }
}

async function migrateSubscriptions() {
  initStat('subscriptions');
  const { rows } = await pgPool.query('SELECT * FROM parents_profiles ORDER BY id');
  stats.subscriptions.source = rows.length;

  for (const row of rows) {
    try {
      const id = crypto.randomUUID();
      await d1Query(
        `INSERT INTO subscriptions (
          id, parent_id, plan_type, status, provider,
          provider_subscription_id, started_at, current_period_end,
          cancel_at_period_end, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          row.id,
          row.plan_type || 'free',
          row.subscription_status || 'active',
          null, // provider unknown
          row.subscription_id || null,
          tsToUnix(row.created_at),
          null, // no period for free
          0,
          tsToUnix(row.created_at),
          tsToUnix(row.created_at),
        ]
      );
      stats.subscriptions.inserted++;
    } catch (e) {
      stats.subscriptions.failed++;
      failed.push({ table: 'subscriptions', id: row.id, error: e.message });
    }
  }
}

async function migrateBookEntitlements() {
  initStat('book_entitlements');
  const { rows } = await pgPool.query('SELECT id, plan_type, created_at FROM parents_profiles ORDER BY id');
  stats.book_entitlements.source = rows.length;

  for (const row of rows) {
    try {
      await d1Query(
        `INSERT INTO book_entitlements (
          parent_id, plan_type, total_books_allocated,
          total_books_used, created_at, updated_at
        ) VALUES (?, ?, 10, 0, ?, ?)`,
        [
          row.id,
          row.plan_type || 'free',
          tsToUnix(row.created_at),
          tsToUnix(row.created_at),
        ]
      );
      stats.book_entitlements.inserted++;
    } catch (e) {
      stats.book_entitlements.failed++;
      failed.push({ table: 'book_entitlements', id: row.id, error: e.message });
    }
  }
}

async function migrateQuestionBank() {
  initStat('question_bank');
  const { rows } = await pgPool.query('SELECT * FROM question_bank ORDER BY id');
  stats.question_bank.source = rows.length;

  for (let i = 0; i < rows.length; i += config.batchSize) {
    const batch = rows.slice(i, i + config.batchSize);
    const placeholders = [];
    const values = [];
    for (const row of batch) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        row.id,
        row.level,
        'SRC', // char_system - all SRC
        null, // difficulty - NO DEFAULT
        row.character,
        row.word,
        row.sentence,
        row.meaning_question,
        jsonToText(row.options),
        row.answer,
        row.story_text || null,
        row.story_question || null,
        jsonToText(row.story_options),
        row.story_answer || null,
        tsToUnix(row.created_at),
        row.updated_at ? tsToUnix(row.updated_at) : tsToUnix(row.created_at),
      );
    }
    try {
      const sql = `INSERT INTO question_bank (
        id, level, char_system, difficulty, character, word, sentence,
        meaning_question, options_json, answer, story_text, story_question,
        story_options_json, story_answer, created_at, updated_at
      ) VALUES ${placeholders.join(', ')}`;
      await d1Query(sql, values);
      stats.question_bank.inserted += batch.length;
    } catch (e) {
      stats.question_bank.failed += batch.length;
      failed.push({ table: 'question_bank', batch: i, error: e.message });
    }
  }
}

// ---- Phase 2: Episodes + Children ----

async function migrateBookEpisodes() {
  initStat('book_episodes');
  const { rows } = await pgPool.query('SELECT * FROM book_episodes ORDER BY id');
  stats.book_episodes.source = rows.length;

  for (const row of rows) {
    try {
      // Calculate total_words from pages
      const { rows: pages } = await pgPool.query(
        'SELECT original_text FROM book_episode_pages WHERE episode_id = $1',
        [row.id]
      );
      const totalWords = pages.reduce((sum, p) => sum + (p.original_text?.length || 0), 0);

      await d1Query(
        `INSERT INTO book_episodes (
          id, series_name, series_id, episode_number, episode_title,
          page_count, level_tier, status, cover_image_url, description,
          total_words, created_at, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?, 'SRC500', ?, NULL, NULL, ?, ?, ?)`,
        [
          row.id,
          row.series_name,
          row.episode_number,
          row.episode_title,
          row.page_count,
          row.status === 'completed' ? 'published' : row.status,
          totalWords,
          tsToUnix(row.created_at),
          row.updated_at ? tsToUnix(row.updated_at) : tsToUnix(row.created_at),
        ]
      );
      stats.book_episodes.inserted++;
    } catch (e) {
      stats.book_episodes.failed++;
      failed.push({ table: 'book_episodes', id: row.id, error: e.message });
    }
  }
}

async function migrateBookEpisodePages() {
  initStat('book_episode_pages');
  const { rows } = await pgPool.query('SELECT * FROM book_episode_pages ORDER BY id');
  stats.book_episode_pages.source = rows.length;

  for (const row of rows) {
    try {
      const text = row.original_text || '';
      const totalChars = text.length;
      const uniqueChars = [...new Set(text.split(''))].length;

      await d1Query(
        `INSERT INTO book_episode_pages (
          id, episode_id, page_number, image_url, original_text,
          new_chars_json, total_chars, unique_chars, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.episode_id,
          row.page_number,
          row.image_url,
          text,
          arrayToJson(row.new_chars),
          totalChars,
          uniqueChars,
          tsToUnix(row.created_at),
        ]
      );
      stats.book_episode_pages.inserted++;
    } catch (e) {
      stats.book_episode_pages.failed++;
      failed.push({ table: 'book_episode_pages', id: row.id, error: e.message });
    }
  }
}

async function migrateChildren() {
  initStat('children');
  const { rows } = await pgPool.query('SELECT * FROM children ORDER BY id');
  stats.children.source = rows.length;

  for (const row of rows) {
    try {
      // Derive estimated_level from latest quick assessment
      const { rows: quickRows } = await pgPool.query(
        `SELECT character_level_u, word_level_u, reading_base
         FROM quick_assessment_results
         WHERE child_id = $1::text::uuid
         ORDER BY created_at DESC LIMIT 1`,
        [row.id]
      );

      let estimatedLevel = null;
      if (quickRows.length > 0) {
        const q = quickRows[0];
        const upper = Math.max(q.character_level_u || 0, q.word_level_u || 0);
        if (upper <= 100) estimatedLevel = 'SRC100';
        else if (upper <= 300) estimatedLevel = 'SRC300';
        else if (upper <= 500) estimatedLevel = 'SRC500';
        else estimatedLevel = 'SRC800';
      }

      // Derive assessment_status
      const { rows: formalSessions } = await pgPool.query(
        `SELECT status FROM test_sessions
         WHERE child_id = $1 AND test_mode IN ('formal','full','fulltest')
         ORDER BY created_at DESC LIMIT 1`,
        [row.id]
      );
      const hasQuick = quickRows.length > 0;
      const hasFormal = formalSessions.some(s => s.status === 'completed');
      const hasFormalInProgress = formalSessions.some(s => s.status === 'in_progress');

      let assessmentStatus = 'not_started';
      if (hasFormal) assessmentStatus = 'formal_done';
      else if (hasFormalInProgress) assessmentStatus = 'formal_in_progress';
      else if (hasQuick) assessmentStatus = 'quick_done';

      await d1Query(
        `INSERT INTO children (
          id, parent_id, nickname, age, grade, country, home_language,
          home_language_other, status, estimated_level, confirmed_level,
          assessment_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          row.id,
          row.parent_id,
          row.nickname,
          row.age,
          row.grade,
          row.country,
          row.home_language || null,
          row.home_language_other || null,
          row.status || 'active',
          estimatedLevel,
          assessmentStatus,
          tsToUnix(row.created_at),
          row.updated_at ? tsToUnix(row.updated_at) : tsToUnix(row.created_at),
        ]
      );
      stats.children.inserted++;
    } catch (e) {
      stats.children.failed++;
      failed.push({ table: 'children', id: row.id, error: e.message });
    }
  }
}

// ---- Phase 3: Rewrite Versions + Guest Sessions + OTP ----

async function migrateRewriteVersions() {
  initStat('book_rewrite_versions');
  const { rows } = await pgPool.query('SELECT * FROM book_rewrite_versions ORDER BY id');
  stats.book_rewrite_versions.source = rows.length;

  for (const row of rows) {
    try {
      // Merge all audits into JSON array
      const { rows: audits } = await pgPool.query(
        `SELECT created_at, audit_engine_version, src_char_library_version,
                src_vocab_library_version, audit_result
         FROM book_rewrite_audits
         WHERE rewrite_id = $1
         ORDER BY created_at ASC`,
        [row.id]
      );

      const auditResultJson = audits.length > 0
        ? JSON.stringify(audits.map(a => ({
            rewrite_id: row.id,
            created_at: tsToUnix(a.created_at),
            audit_engine_version: a.audit_engine_version,
            src_char_library_version: a.src_char_library_version,
            src_vocab_library_version: a.src_vocab_library_version,
            audit_result: a.audit_result, // already JSON object from jsonb
          })))
        : null;

      // Calculate char stats from pages_json
      const pages = row.pages_json || [];
      let totalChars = 0;
      let uniqueChars = 0;
      let maxPageChars = 0;
      const allChars = new Set();
      for (const page of pages) {
        const text = page.text || '';
        totalChars += text.length;
        maxPageChars = Math.max(maxPageChars, text.length);
        for (const ch of text) allChars.add(ch);
      }
      uniqueChars = allChars.size;

      await d1Query(
        `INSERT INTO book_rewrite_versions (
          id, episode_id, child_id, target_level, status, version,
          pages_json, frontier_targets_json, total_chars, unique_chars,
          max_page_chars, validation_result_json, audit_result_json,
          audit_passed, generation_params_json, generator_version,
          retry_count, failure_reason, created_at, finalized_at, finalized_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.episode_id,
          row.child_id || null,
          row.target_level,
          row.status,
          row.version,
          jsonToText(row.pages_json),
          arrayToJson(row.frontier_targets),
          totalChars,
          uniqueChars,
          maxPageChars,
          jsonToText(row.validation_result),
          auditResultJson,
          // audit_passed = 0 (placeholder - NOT "failed", just unknown)
          jsonToText(row.generation_params),
          // generator_version = NULL
          row.retry_count || 0,
          row.failure_reason || null,
          tsToUnix(row.created_at),
          row.finalized_at ? tsToUnix(row.finalized_at) : null,
          row.finalized_by || null,
        ]
      );
      stats.book_rewrite_versions.inserted++;
    } catch (e) {
      stats.book_rewrite_versions.failed++;
      failed.push({ table: 'book_rewrite_versions', id: row.id, error: e.message });
    }
  }
}

async function migrateGuestTestSessions() {
  initStat('guest_test_sessions');
  const { rows } = await pgPool.query('SELECT * FROM guest_test_sessions ORDER BY id');
  stats.guest_test_sessions.source = rows.length;

  for (const row of rows) {
    try {
      await d1Query(
        `INSERT INTO guest_test_sessions (
          id, device_id, test_type, status, result_data_json,
          claimed, child_id, created_at, completed_at
        ) VALUES (?, ?, 'quick', ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.device_id || null,
          row.test_status || 'in_progress',
          jsonToText(row.result_data),
          boolToInt(row.claimed),
          row.child_id || null,
          tsToUnix(row.created_at),
          row.completed_at ? tsToUnix(row.completed_at) : null,
        ]
      );
      stats.guest_test_sessions.inserted++;
    } catch (e) {
      stats.guest_test_sessions.failed++;
      failed.push({ table: 'guest_test_sessions', id: row.id, error: e.message });
    }
  }
}

async function migrateOtpCodes() {
  initStat('otp_codes');
  const { rows } = await pgPool.query('SELECT * FROM otp_codes ORDER BY id');
  stats.otp_codes.source = rows.length;

  for (const row of rows) {
    try {
      await d1Query(
        `INSERT INTO otp_codes (
          id, email, code_hash, purpose, expires_at,
          attempts_remaining, used, revoked, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.email,
          row.code_hash,
          row.purpose || 'login',
          tsToUnix(row.expires_at),
          row.attempts_remaining,
          boolToInt(row.used),
          boolToInt(row.revoked),
          tsToUnix(row.created_at),
        ]
      );
      stats.otp_codes.inserted++;
    } catch (e) {
      stats.otp_codes.failed++;
      failed.push({ table: 'otp_codes', id: row.id, error: e.message });
    }
  }
}

// ---- Phase 4: Test Sessions + Answers + Results + Quick ----

function mapTestMode(mode) {
  if (mode === 'sampling') return 'sampling';
  if (mode === 'formal' || mode === 'full' || mode === 'fulltest') return 'formal';
  return 'formal'; // fallback
}

async function migrateTestSessions() {
  initStat('test_sessions');
  const { rows } = await pgPool.query('SELECT * FROM test_sessions ORDER BY id');
  stats.test_sessions.source = rows.length;

  for (const row of rows) {
    try {
      // Count total_questions from answers
      const { rows: ansCount } = await pgPool.query(
        'SELECT COUNT(*)::int as cnt FROM test_answers WHERE session_id = $1',
        [row.id]
      );

      await d1Query(
        `INSERT INTO test_sessions (
          id, child_id, level, test_type, status, started_at,
          completed_at, time_limit_seconds, total_questions, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.child_id,
          row.level,
          mapTestMode(row.test_mode),
          row.status,
          tsToUnix(row.started_at),
          row.completed_at ? tsToUnix(row.completed_at) : null,
          row.time_limit_seconds || null,
          ansCount[0].cnt,
          tsToUnix(row.created_at),
        ]
      );
      stats.test_sessions.inserted++;
    } catch (e) {
      stats.test_sessions.failed++;
      failed.push({ table: 'test_sessions', id: row.id, error: e.message });
    }
  }
}

async function migrateTestAnswers() {
  initStat('test_answers');
  const { rows } = await pgPool.query('SELECT * FROM test_answers ORDER BY id');
  stats.test_answers.source = rows.length;

  for (let i = 0; i < rows.length; i += config.batchSize) {
    const batch = rows.slice(i, i + config.batchSize);
    const placeholders = [];
    const values = [];
    for (const row of batch) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        row.id,
        row.session_id,
        row.question_id || null,
        row.part,
        row.question_content || null,
        row.selected_answer || null,
        boolToInt(row.is_correct),
        row.reaction_time_ms || null,
        tsToUnix(row.created_at),
      );
    }
    try {
      const sql = `INSERT INTO test_answers (
        id, session_id, question_id, part, question_content,
        selected_answer, is_correct, reaction_time_ms, created_at
      ) VALUES ${placeholders.join(', ')}`;
      await d1Query(sql, values);
      stats.test_answers.inserted += batch.length;
    } catch (e) {
      stats.test_answers.failed += batch.length;
      failed.push({ table: 'test_answers', batch: i, error: e.message });
    }
  }
}

async function migrateTestResults() {
  initStat('test_results');
  const { rows } = await pgPool.query(`
    SELECT r.*, s.completed_at as session_completed_at, s.test_mode as session_test_mode
    FROM test_results r
    JOIN test_sessions s ON s.id = r.session_id
    ORDER BY r.id
  `);
  stats.test_results.source = rows.length;

  for (const row of rows) {
    try {
      // Count from test_answers
      const { rows: ans } = await pgPool.query(
        'SELECT COUNT(*)::int as total, SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::int as correct FROM test_answers WHERE session_id = $1',
        [row.session_id]
      );

      const originalMode = row.test_mode;
      const testType = mapTestMode(row.test_mode);

      // part_breakdown_json stores original_test_mode + breakdown
      const partBreakdown = {
        original_test_mode: originalMode,
        character_score: row.character_score,
        vocab_score: row.vocab_score,
        reading_score: row.reading_score,
        comprehension_score: row.comprehension_score,
      };

      await d1Query(
        `INSERT INTO test_results (
          id, session_id, child_id, level, test_type, status,
          character_score, vocab_score, reading_score, comprehension_score,
          total_score, stable_char_count, stable_vocab_count,
          completion_time_seconds, total_questions, correct_count,
          known_characters_json, weak_characters_json, part_breakdown_json,
          completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          row.id,
          row.session_id,
          row.child_id,
          row.level,
          testType,
          row.character_score,
          row.vocab_score,
          row.reading_score,
          row.comprehension_score,
          row.total_score,
          row.stable_char_count,
          row.stable_vocab_count,
          row.completion_time_seconds,
          ans[0].total,
          ans[0].correct,
          jsonToText(row.known_characters),
          // weak_characters_json = NULL
          JSON.stringify(partBreakdown),
          tsToUnix(row.session_completed_at || row.created_at),
          tsToUnix(row.created_at),
        ]
      );
      stats.test_results.inserted++;
    } catch (e) {
      stats.test_results.failed++;
      failed.push({ table: 'test_results', id: row.id, error: e.message });
    }
  }
}

async function migrateQuickAssessmentResults() {
  initStat('quick_assessment_results');
  const { rows } = await pgPool.query('SELECT * FROM quick_assessment_results ORDER BY id');
  stats.quick_assessment_results.source = rows.length;

  for (const row of rows) {
    try {
      // Calculate recommended_level using upper bound
      const upper = Math.max(
        row.character_level_u || 0,
        row.word_level_u || 0
      );
      let recommendedLevel;
      if (upper <= 100) recommendedLevel = 'SRC100';
      else if (upper <= 300) recommendedLevel = 'SRC300';
      else if (upper <= 500) recommendedLevel = 'SRC500';
      else recommendedLevel = 'SRC800';

      // Try to get total_questions and correct_count from raw_result
      let totalQuestions = null;
      let correctCount = null;
      if (row.raw_result) {
        const r = row.raw_result;
        if (Array.isArray(r.questions)) totalQuestions = r.questions.length;
        // approximate correct count if available
        if (typeof r.correct === 'number') correctCount = r.correct;
      }

      // completed_at from guest session or created_at
      let completedAt = tsToUnix(row.created_at);
      if (row.guest_session_id) {
        const { rows: guest } = await pgPool.query(
          'SELECT completed_at FROM guest_test_sessions WHERE id = $1::text::uuid',
          [row.guest_session_id]
        );
        if (guest.length > 0 && guest[0].completed_at) {
          completedAt = tsToUnix(guest[0].completed_at);
        }
      }

      await d1Query(
        `INSERT INTO quick_assessment_results (
          id, session_id, child_id, guest_session_id,
          character_level_l, character_level_u, word_level_l, word_level_u,
          reading_base, confidence, recommended_level,
          total_questions, correct_count, raw_result_json,
          completed_at, created_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          // session_id = NULL (independent system)
          row.child_id || null,
          row.guest_session_id || null,
          row.character_level_l,
          row.character_level_u,
          row.word_level_l,
          row.word_level_u,
          row.reading_base,
          row.confidence,
          recommendedLevel,
          totalQuestions,
          correctCount,
          jsonToText(row.raw_result),
          completedAt,
          tsToUnix(row.created_at),
        ]
      );
      stats.quick_assessment_results.inserted++;
    } catch (e) {
      stats.quick_assessment_results.failed++;
      failed.push({ table: 'quick_assessment_results', id: row.id, error: e.message });
    }
  }
}

// ---- Phase 5: Custom Books (SKIPPED 2) + Reading Records (empty) ----

async function migrateCustomBooks() {
  initStat('custom_books');
  // Decision: 2 historical custom_books SKIPPED
  // reason: rewrite_id cannot be reliably determined
  stats.custom_books.source = 2;
  stats.custom_books.skipped = 2;
  skipped.push({
    table: 'custom_books',
    count: 2,
    reason: 'rewrite_id cannot be reliably determined. D1 Schema requires NOT NULL rewrite_id.',
    note: 'PG custom_books are self-contained with pages_json. D1 model references rewrite_id.',
  });
  // Insert 0 rows
}

async function createEmptyReadingRecords() {
  initStat('reading_records');
  stats.reading_records.source = 0;
  stats.reading_records.inserted = 0;
  // Table created by schema init, no data to insert
}

// ---- Main ----

async function main() {
  console.log('=== SRC Primary Database — PG → D1 Migration v1.0 ===');
  console.log(`Dry run: ${config.dryRun}`);
  console.log('');

  const steps = [
    ['parents', migrateParents],
    ['subscriptions', migrateSubscriptions],
    ['book_entitlements', migrateBookEntitlements],
    ['question_bank', migrateQuestionBank],
    ['book_episodes', migrateBookEpisodes],
    ['book_episode_pages', migrateBookEpisodePages],
    ['children', migrateChildren],
    ['book_rewrite_versions', migrateRewriteVersions],
    ['guest_test_sessions', migrateGuestTestSessions],
    ['otp_codes', migrateOtpCodes],
    ['test_sessions', migrateTestSessions],
    ['test_answers', migrateTestAnswers],
    ['test_results', migrateTestResults],
    ['quick_assessment_results', migrateQuickAssessmentResults],
    ['custom_books', migrateCustomBooks],
    ['reading_records', createEmptyReadingRecords],
  ];

  for (const [name, fn] of steps) {
    console.log(`Migrating: ${name}...`);
    try {
      await fn();
      console.log(`  done: ${stats[name].inserted} inserted, ${stats[name].skipped} skipped, ${stats[name].failed} failed`);
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      failed.push({ table: name, error: e.message });
    }
  }

  console.log('');
  console.log('=== MIGRATION SUMMARY ===');
  console.table(stats);

  if (skipped.length > 0) {
    console.log('');
    console.log('=== SKIPPED RECORDS ===');
    console.table(skipped);
  }

  if (failed.length > 0) {
    console.log('');
    console.log('=== FAILED RECORDS ===');
    console.table(failed.slice(0, 20));
    if (failed.length > 20) console.log(`... and ${failed.length - 20} more`);
  }

  await pgPool.end();
  console.log('');
  console.log('Migration complete.');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
