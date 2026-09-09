# P0-8 Migration Report

> **Status: MIGRATION SCRIPT READY — AWAITING CLOUDFLARE D1 CREDENTIALS FOR EXECUTION**

---

## 1. Source Database Counts (PostgreSQL)

| 表 | 行数 | 说明 |
|----|------|------|
| parents_profiles | 103 | 家长账户 |
| children | 141 | 孩子档案 |
| question_bank | 5,469 | 题库 |
| test_sessions | 122 | 测试会话 |
| test_answers | 13,065 | 答题记录 |
| test_results | 78 | 测试结果 |
| quick_assessment_results | 61 | 快速测评结果 |
| guest_test_sessions | 76 | 游客测试会话 |
| book_episodes | 2 | 绘本集 (Master) |
| book_episode_pages | 20 | 绘本页 (Master) |
| book_rewrite_versions | 23 | 绘本改写版本 |
| book_rewrite_audits | 10 | 改写审计记录 |
| custom_books | 2 | 定制绘本 |
| otp_codes | 21 | OTP 验证码 |
| otp_rate_limit | 0 | OTP 频控（不迁移） |
| health_check | 1 | 运维表（不迁移） |

### test_sessions Mode Breakdown

| test_mode | status | count | D1 映射 |
|-----------|--------|-------|---------|
| formal | completed | 14 | formal |
| formal | in_progress | 3 | formal |
| full | in_progress | 38 | formal |
| fulltest | completed | 1 | formal |
| sampling | completed | 27 | sampling |
| sampling | in_progress | 39 | sampling |
| **合计** | | **122** | |

归一化后：
- **formal: 56** (17 formal + 38 full + 1 fulltest)
- **sampling: 66** (27 + 39)

### test_results Mode Breakdown

| test_mode | SRC100 | SRC300 | SRC500 | SRC800 | 合计 | D1 映射 |
|-----------|--------|--------|--------|--------|------|---------|
| formal | 2 | 4 | 6 | 2 | 14 | formal |
| full | 9 | 18 | 6 | 7 | 40 | formal |
| fulltest | 1 | 0 | 0 | 0 | 1 | formal |
| sampling | 11 | 8 | 1 | 3 | 23 | sampling |
| **合计** | **23** | **30** | **13** | **12** | **78** | |

归一化后：
- **formal results: 55** (14 + 40 + 1)
- **sampling results: 23**

### book_rewrite_versions Status Breakdown

| status | target_level | count |
|--------|-------------|-------|
| ai_draft | SRC300 | 8 |
| failed | SRC300 | 8 |
| failed | SRC500 | 4 |
| final | SRC300 | 2 |
| rejected | SRC500 | 1 |
| **合计** | | **23** |

---

## 2. Target D1 Expected Counts

| D1 表 | 预期行数 | 来源 | 备注 |
|-------|---------|------|------|
| parents | 103 | parents_profiles | 直接映射 |
| subscriptions | 103 | parents_profiles 派生 | plan_type/status 提取 |
| book_entitlements | 103 | 初始化 | allocated=10, used=0 |
| children | 141 | children + quick_assessment_results | estimated_level 派生 |
| question_bank | 5,469 | question_bank | char_system='SRC', difficulty=NULL |
| test_sessions | 122 | test_sessions | full/fulltest→formal |
| test_answers | 13,065 | test_answers | 直接映射 |
| test_results | 78 | test_results + test_answers | 归一化 + 重建字段 |
| quick_assessment_results | 61 | quick_assessment_results | session_id=NULL, 独立体系 |
| guest_test_sessions | 76 | guest_test_sessions | 直接映射 |
| book_episodes | 2 | book_episodes | level_tier=NULL, series_id=1 |
| book_episode_pages | 20 | book_episode_pages | total_chars/unique_chars 派生 |
| book_rewrite_versions | 23 | book_rewrite_versions + book_rewrite_audits | audits 合并为 JSON 数组 |
| custom_books | **0** | custom_books | **2 条 SKIPPED** |
| reading_records | 0 | — | 空表，不伪造历史 |
| otp_codes | 21 | otp_codes | 直接映射 |
| **合计** | **19,103** | | |

---

## 3. Skipped Records

| 表 | 数量 | 原因 |
|----|------|------|
| custom_books | 2 | rewrite_id 无法可靠确定。D1 Schema 要求 `rewrite_id INTEGER NOT NULL`。2 条历史记录（1 条 child_id=NULL，1 条在 rewrites 中无匹配）均无法建立唯一可靠对应。禁止猜测或伪造关系。 |
| otp_rate_limit | 0 | 临时频控数据，V1.0 不需要迁移（当前 0 条，无影响） |
| health_check | 1 | 运维表，不属于业务数据 |

**Total skipped: 2 records (custom_books)**

---

## 4. Failed Records

| 表 | 数量 | 原因 |
|----|------|------|
| — | 0 | 迁移脚本执行前无失败记录 |

**Total failed: 0 (pending execution)**

---

## 5. Data Mapping Summary

### 类型转换规则

| PostgreSQL 类型 | D1 类型 | 转换方式 |
|----------------|---------|---------|
| UUID | TEXT | 直接字符串 |
| JSONB | TEXT | JSON.stringify() |
| TEXT[] (ARRAY) | TEXT | JSON.stringify() → JSON 数组字符串 |
| TIMESTAMPTZ | INTEGER | Math.floor(new Date(ts).getTime() / 1000) (unix seconds, UTC) |
| BOOLEAN | INTEGER | true→1, false→0 |
| SERIAL / INTEGER | INTEGER | 直接映射 |
| VARCHAR / TEXT | TEXT | 直接映射 |

### 关键字段映射

| D1 字段 | 来源 | 规则 |
|---------|------|------|
| test_sessions.test_type | test_mode | formal/full/fulltest → formal; sampling → sampling |
| test_results.test_type | test_mode | 同上 |
| test_results.part_breakdown_json | part scores + original_test_mode | 保留原始 test_mode 用于溯源 |
| children.estimated_level | quick_assessment_results | MAX(character_level_u, word_level_u) → SRC等级边界 |
| children.confirmed_level | — | NULL（等 Formal Level Decision Algorithm） |
| children.assessment_status | 派生 | not_started / quick_done / formal_in_progress / formal_done |
| question_bank.char_system | — | 'SRC'（全部 SRC 字库） |
| question_bank.difficulty | — | NULL（无历史数据） |
| book_episodes.level_tier | — | NULL（Master Story 未分级） |
| book_episodes.series_id | — | 1（同一系列） |
| book_episodes.total_words | original_text 派生 | 所有页文字长度之和 |
| book_episode_pages.total_chars | original_text | 本页字数 |
| book_episode_pages.unique_chars | original_text | 本页去重字数 |
| book_rewrite_versions.audit_result_json | book_rewrite_audits | 全部 10 条合并为 JSON 数组 |
| book_rewrite_versions.audit_passed | — | 0（占位值，不代表审计失败） |
| book_rewrite_versions.generator_version | — | NULL（无此字段） |
| book_rewrite_versions.total_chars | pages_json 派生 | 全部页字数 |
| book_rewrite_versions.unique_chars | pages_json 派生 | 全部页去重字数 |
| book_rewrite_versions.max_page_chars | pages_json 派生 | 单页最大字数 |
| quick_assessment_results.session_id | — | NULL（独立体系） |
| quick_assessment_results.recommended_level | character_level_u/word_level_u 派生 | 上界 → SRC 等级 |
| book_entitlements.total_books_allocated | — | 10（初始值） |
| book_entitlements.total_books_used | — | 0（初始值，不代表历史实际） |
| subscriptions.plan_type | parents_profiles.plan_type | 默认 'free' |
| subscriptions.status | parents_profiles.subscription_status | 默认 'active' |
| test_sessions.total_questions | test_answers COUNT | 从答题记录重建 |
| test_results.total_questions | test_answers COUNT | 从答题记录重建 |
| test_results.correct_count | test_answers SUM(is_correct) | 从答题记录重建 |

---

## 6. Integrity Verification Checklist

### 执行迁移后，运行 `verify.sql` 验证以下项：

- [ ] **各表 COUNT 匹配** — 16 张表行数与预期一致
- [ ] **test_type 归一化** — 只有 formal/sampling，无 full/fulltest
- [ ] **Quick Assessment 独立** — session_id 全部 NULL
- [ ] **confirmed_level 全 NULL** — 无自动填充
- [ ] **difficulty 全 NULL** — 无默认值 2
- [ ] **book_episodes.level_tier 全 NULL** — Master Story 未分级
- [ ] **audit_passed 全 0** — 占位值，代码无引用
- [ ] **generator_version 全 NULL** — 不使用 audit_engine_version 替代
- [ ] **book_entitlements 初始值** — allocated=10, used=0
- [ ] **FK 完整性** — children→parents, sessions→children, answers→sessions, results→sessions
- [ ] **UNIQUE 约束** — parents.email 不重复
- [ ] **test_results 历史记录** — 78 条全部保留，不覆盖
- [ ] **audit 历史完整** — 10 条 audit 全部合并到 JSON 数组
- [ ] **custom_books 0 条** — 2 条历史明确标记 skipped
- [ ] **question_bank char_system** — 全部为 'SRC'

---

## 7. Remaining Considerations

1. **Cloudflare D1 Query API 限制**
   - 单条 SQL 参数数量有限制，5469 题使用 500 条/批次
   - 大批量插入可能需要调整 batch size

2. **数据一致性保证**
   - 脚本以只读方式读取 PostgreSQL
   - 写入 D1 按依赖顺序，确保 FK 约束满足
   - 所有 skipped/failed 均有明确记录

3. **回滚方案**
   - PostgreSQL 源数据保持不变（只读访问）
   - D1 如出现问题可清空后重新迁移
   - 迁移不删除任何源数据

4. **2 条 custom_books 保留方案**
   - 数据仍在 PostgreSQL 中，可随时查阅
   - 后续如需迁移，需先建立可靠的 rewrite_id 匹配规则
   - 或在 D1 中放宽 rewrite_id 为 NULL（需修改 Schema V2.1）

---

## 8. Migration Artifacts

| 文件 | 说明 |
|------|------|
| `src/storage/database/migrations/pg-to-d1-v1/migrate.mjs` | 迁移脚本（Node.js ESM） |
| `src/storage/database/migrations/pg-to-d1-v1/verify.sql` | 迁移后验证查询集 |
| `src/storage/database/migrations/pg-to-d1-v1/README.md` | 迁移说明文档 |

---

## 9. Execution Prerequisites

执行迁移前必须具备：

- [ ] Cloudflare D1 Database（SRC Primary Database）已创建
- [ ] D1 Schema V2.1 已初始化（16 张表 + 索引 + 约束）
- [ ] Cloudflare API Token（D1 编辑权限）
- [ ] Cloudflare Account ID
- [ ] D1 Database ID
- [ ] PostgreSQL 只读连接凭据
- [ ] Node.js 18+ 环境
- [ ] `pg` npm 包已安装
- [ ] 已执行 DRY_RUN=1 验证无错误

---

**Status: MIGRATION READY (script + docs complete; awaiting D1 credentials for actual execution)**
