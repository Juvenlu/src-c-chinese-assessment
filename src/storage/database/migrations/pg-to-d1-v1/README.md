# SRC Primary Database — PG → D1 Migration v1.0

## 概述

将现有 PostgreSQL (Supabase) 数据迁移到 Cloudflare D1 (SRC Primary Database V2.1 LOCKED)。

## 迁移范围

16 张业务表（D1 Schema V2.1 LOCKED）：

| # | 表名 | 源数据量 | 目标数据量 | 说明 |
|---|------|---------|-----------|------|
| 1 | parents | 103 | 103 | 家长账户 |
| 2 | subscriptions | 103 | 103 | 订阅状态 |
| 3 | book_entitlements | 103 | 103 | 免费绘本额度 (allocated=10, used=0) |
| 4 | children | 141 | 141 | 孩子档案 |
| 5 | question_bank | 5469 | 5469 | 题库 |
| 6 | test_sessions | 122 | 122 | 测试会话 |
| 7 | test_answers | 13065 | 13065 | 答题记录 |
| 8 | test_results | 78 | 78 | 测试结果 |
| 9 | quick_assessment_results | 61 | 61 | 快速测评结果 |
| 10 | guest_test_sessions | 76 | 76 | 游客测试会话 |
| 11 | book_episodes | 2 | 2 | 绘本集 (Master) |
| 12 | book_episode_pages | 20 | 20 | 绘本页 (Master) |
| 13 | book_rewrite_versions | 23 | 23 | 绘本改写版本 |
| 14 | custom_books | 2 | **0** | **2 条 SKIPPED** |
| 15 | reading_records | 0 | 0 | 阅读记录 (空表) |
| 16 | otp_codes | 21 | 21 | OTP 验证码 |

**不迁移：** `otp_rate_limit` (0条)、`health_check` (运维表)

## 关键决策

| 项目 | 决策 | 原因 |
|------|------|------|
| test_mode: full/fulltest | → formal | 代码事实确认，归一化 |
| test_mode: sampling | → sampling | 保持抽测独立 |
| original_test_mode | 存入 part_breakdown_json | 保留历史溯源 |
| custom_books 2条 | SKIPPED | rewrite_id 无法可靠确定，D1 NOT NULL |
| confirmed_level | NULL | 无 Formal Level Decision Algorithm |
| estimated_level | 从最新 Quick Assessment 推导 | 有数据依据 |
| question_bank.difficulty | NULL | 无历史数据，无推导规则 |
| question_bank.char_system | 'SRC' | 全部 SRC 字库 |
| book_episodes.level_tier | NULL | Master Story 难度不确定 |
| book_episodes.series_id | 1 | 同一系列 |
| generator_version | NULL | 无此字段，不能用 audit_engine_version 替代 |
| audit_passed | 0 (占位值) | 代码无引用，不代表审计失败 |
| book_entitlements.used | 0 (初始值) | 无法从历史数据确定 |
| reading_records | 空表 | 不得伪造历史记录 |
| Quick session_id | NULL | 独立体系，不创建人工 session |

## 使用方法

### 前置条件

1. 目标 D1 数据库已创建，Schema V2.1 已初始化
2. 已获取以下凭据：
   - `PG_DATABASE_URL`：源 PostgreSQL 连接串
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账号 ID
   - `CLOUDFLARE_D1_TOKEN`：Cloudflare API Token (D1 编辑权限)
   - `CLOUDFLARE_D1_DATABASE_ID`：目标 D1 数据库 ID
3. Node.js 18+ 环境
4. 已安装 `pg` 包：`pnpm add pg`

### 执行步骤

```bash
# 1. 先 DRY RUN 验证脚本逻辑
DRY_RUN=1 \
PG_DATABASE_URL=postgres://... \
CLOUDFLARE_ACCOUNT_ID=... \
CLOUDFLARE_D1_TOKEN=... \
CLOUDFLARE_D1_DATABASE_ID=... \
node src/storage/database/migrations/pg-to-d1-v1/migrate.mjs

# 2. 确认无误后实际执行
PG_DATABASE_URL=postgres://... \
CLOUDFLARE_ACCOUNT_ID=... \
CLOUDFLARE_D1_TOKEN=... \
CLOUDFLARE_D1_DATABASE_ID=... \
node src/storage/database/migrations/pg-to-d1-v1/migrate.mjs

# 3. 执行验证
# 在 Cloudflare D1 控制台或 wrangler 中运行 verify.sql 中的查询
```

### 迁移顺序（依赖关系）

```
Phase 1: 家长/基础
  parents → subscriptions → book_entitlements → question_bank

Phase 2: 绘本/孩子
  book_episodes → book_episode_pages → children

Phase 3: 改写版本/游客/OTP
  book_rewrite_versions → guest_test_sessions → otp_codes

Phase 4: 测试体系
  test_sessions → test_answers → test_results → quick_assessment_results

Phase 5: 定制绘本/阅读记录
  custom_books (0条) → reading_records (0条)
```

## 迁移后验证

运行 `verify.sql` 中的所有查询。核心验证项：

1. ✅ 各表 COUNT 匹配预期
2. ✅ test_type 只有 formal/sampling（无 full/fulltest）
3. ✅ Quick Assessment session_id 全部 NULL
4. ✅ children.confirmed_level 全部 NULL
5. ✅ question_bank.difficulty 全部 NULL
6. ✅ book_episodes.level_tier 全部 NULL
7. ✅ audit_passed 全部 0（占位值）
8. ✅ generator_version 全部 NULL
9. ✅ book_entitlements 分配正确
10. ✅ FK 完整性（无孤儿记录）
11. ✅ UNIQUE 约束（parents.email 不重复）
12. ✅ test_results 历史记录完整性

## 已知数据损失

| 项目 | 影响范围 | 原因 | 补救方式 |
|------|---------|------|---------|
| custom_books 2条 | 2个孩子的历史定制绘本 | rewrite_id 无法可靠匹配 | 保留在 PG 中备查，D1 不迁移 |
| book_entitlements.used | 全部 103 条 | 无法确定历史消耗数量 | 标记为初始值 0，可能多给额度 |
| difficulty | 5469 题 | 无历史数据 | 后续可补充标注 |
| level_tier | 2本绘本 | Master Story 未分级 | 后续可补充 |
| generator_version | 23条改写 | 无此字段 | 不影响功能 |
| reading_records | 无真实数据 | 历史未收集 | 从迁移日起重新收集 |

## 风险

1. **D1 Query API 限制**：单条 SQL 语句复杂度和参数数量有限制，大批量分批处理
2. **JSON 序列化**：JSONB → TEXT(JSON) 可能丢失类型信息（全部 JSON.stringify 处理）
3. **时区**：TIMESTAMPTZ → unix seconds，UTC 标准转换
4. **UUID 大小写**：D1 TEXT 存储，保留原大小写
