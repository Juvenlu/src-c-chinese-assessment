-- ============================================================
-- SRC Primary Database — D1 Post-Migration Verification Suite
-- ============================================================
-- Run these queries against the target D1 database after migration.
-- Expected counts based on PostgreSQL source (2025-01).

-- ---- 1. Table Count Verification ----
SELECT 'parents' as tbl, COUNT(*) as cnt FROM parents
UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions
UNION ALL SELECT 'book_entitlements', COUNT(*) FROM book_entitlements
UNION ALL SELECT 'children', COUNT(*) FROM children
UNION ALL SELECT 'question_bank', COUNT(*) FROM question_bank
UNION ALL SELECT 'test_sessions', COUNT(*) FROM test_sessions
UNION ALL SELECT 'test_answers', COUNT(*) FROM test_answers
UNION ALL SELECT 'test_results', COUNT(*) FROM test_results
UNION ALL SELECT 'quick_assessment_results', COUNT(*) FROM quick_assessment_results
UNION ALL SELECT 'guest_test_sessions', COUNT(*) FROM guest_test_sessions
UNION ALL SELECT 'book_episodes', COUNT(*) FROM book_episodes
UNION ALL SELECT 'book_episode_pages', COUNT(*) FROM book_episode_pages
UNION ALL SELECT 'book_rewrite_versions', COUNT(*) FROM book_rewrite_versions
UNION ALL SELECT 'custom_books', COUNT(*) FROM custom_books
UNION ALL SELECT 'reading_records', COUNT(*) FROM reading_records
UNION ALL SELECT 'otp_codes', COUNT(*) FROM otp_codes
ORDER BY tbl;

-- Expected:
-- parents: 103
-- subscriptions: 103
-- book_entitlements: 103
-- children: 141
-- question_bank: 5469
-- test_sessions: 122
-- test_answers: 13065
-- test_results: 78
-- quick_assessment_results: 61
-- guest_test_sessions: 76
-- book_episodes: 2
-- book_episode_pages: 20
-- book_rewrite_versions: 23
-- custom_books: 0 (2 SKIPPED)
-- reading_records: 0
-- otp_codes: 21

-- ---- 2. test_mode Normalization Check ----
-- Should be: formal | sampling (no full/fulltest)
SELECT DISTINCT test_type FROM test_sessions;
SELECT DISTINCT test_type FROM test_results;

-- formal count should match full+formal+fulltest
SELECT test_type, COUNT(*) as cnt FROM test_sessions GROUP BY test_type;
-- Expected: formal=18 (14+3+1), sampling=66 (27+39)
-- Note: in_progress included

SELECT test_type, COUNT(*) as cnt FROM test_results GROUP BY test_type;
-- Expected: formal=48 (14+19+1+14? verify), sampling=23

-- ---- 3. Quick Assessment Independence ----
-- All session_id should be NULL
SELECT COUNT(*) as quick_with_session FROM quick_assessment_results WHERE session_id IS NOT NULL;
-- Expected: 0

-- ---- 4. confirmed_level Check ----
-- All children should have confirmed_level = NULL
SELECT COUNT(*) as confirmed_not_null FROM children WHERE confirmed_level IS NOT NULL;
-- Expected: 0

-- ---- 5. difficulty NULL Check ----
SELECT COUNT(*) as difficulty_not_null FROM question_bank WHERE difficulty IS NOT NULL;
-- Expected: 0

-- ---- 6. level_tier NULL Check (master story) ----
SELECT COUNT(*) as level_tier_not_null FROM book_episodes WHERE level_tier IS NOT NULL;
-- Expected: 0

-- ---- 7. audit_passed All 0 ----
SELECT audit_passed, COUNT(*) as cnt FROM book_rewrite_versions GROUP BY audit_passed;
-- Expected: all 0 (placeholder, NOT audit failure)

-- ---- 8. generator_version All NULL ----
SELECT COUNT(*) as generator_ver_not_null FROM book_rewrite_versions WHERE generator_version IS NOT NULL;
-- Expected: 0

-- ---- 9. book_entitlements Values ----
SELECT plan_type, total_books_allocated, total_books_used, COUNT(*) as cnt
FROM book_entitlements
GROUP BY plan_type, total_books_allocated, total_books_used;
-- Expected: free/10/0 = 103 (used=0 is initial value, not historical fact)

-- ---- 10. test_results Historical Record Integrity ----
-- Each completed formal session should have exactly one result
SELECT s.id as session_id, s.status, s.test_type, COUNT(r.id) as result_count
FROM test_sessions s
LEFT JOIN test_results r ON r.session_id = s.id
WHERE s.test_type = 'formal'
GROUP BY s.id, s.status, s.test_type
HAVING COUNT(r.id) != 1;
-- Should return 0 rows for completed sessions

-- ---- 11. FK Integrity: children → parents ----
SELECT COUNT(*) as orphan_children
FROM children c
LEFT JOIN parents p ON p.id = c.parent_id
WHERE p.id IS NULL;
-- Expected: 0

-- ---- 12. FK Integrity: test_sessions → children ----
SELECT COUNT(*) as orphan_sessions
FROM test_sessions s
LEFT JOIN children c ON c.id = s.child_id
WHERE c.id IS NULL;
-- Expected: 0

-- ---- 13. FK Integrity: test_answers → test_sessions ----
SELECT COUNT(*) as orphan_answers
FROM test_answers a
LEFT JOIN test_sessions s ON s.id = a.session_id
WHERE s.id IS NULL;
-- Expected: 0

-- ---- 14. FK Integrity: test_results → test_sessions ----
SELECT COUNT(*) as orphan_results
FROM test_results r
LEFT JOIN test_sessions s ON s.id = r.session_id
WHERE s.id IS NULL;
-- Expected: 0

-- ---- 15. FK Integrity: custom_books → book_rewrite_versions ----
SELECT COUNT(*) as orphan_custom_books
FROM custom_books cb
LEFT JOIN book_rewrite_versions brv ON brv.id = cb.rewrite_id
WHERE brv.id IS NULL;
-- Expected: 0 (but there are 0 custom_books anyway)

-- ---- 16. UNIQUE Check: parents.email ----
SELECT email, COUNT(*) as cnt FROM parents GROUP BY email HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- ---- 17. question_bank char_system ----
SELECT char_system, COUNT(*) as cnt FROM question_bank GROUP BY char_system;
-- Expected: all SRC

-- ---- 18. book_rewrite_versions Audit JSON count ----
-- Should have audits for rewrites that had them in PG
SELECT
  id,
  CASE WHEN audit_result_json IS NULL THEN 0
       ELSE json_array_length(audit_result_json)
  END as audit_count
FROM book_rewrite_versions
ORDER BY id;
-- Total audit count across all rewrites should match PG (10)
