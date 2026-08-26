# SRC-2026-09-01-RC1 — Release Freeze 基线

> 版本代号：**SRC-2026-09-01-RC1**
> 冻结日期：2026-09-01
> 状态：**SAFE TO FREEZE**

---

## 1. Git 基线

| 项目 | 值 |
|------|-----|
| 分支 | `main` |
| 代码冻结基线 | `4368ed7`（audit: Time Limit 定向回归） |
| 基线文档版本 | SRC-2026-09-01-RC1 |
| 基线文档 Commit | `a2f6662`（本文件） |
| Package version | `0.1.0` |
| Next.js 版本 | `16.1.1` |
| Node.js | `24` |

**Freeze 之前的关键提交链（最近）：**

```
4368ed7 audit: Time Limit 定向回归 - 全部通过
a775bae fix: 修复 session 创建字段名不匹配导致测试完全不可用
7ceb2c3 audit: 发现 P0 功能阻断 - mode/test_mode 字段名不匹配
5f0a418 audit: Release Candidate 最终安全审计 - 无新P0
078fdeb docs: Release Freeze 最终验收报告 - 9月1日安全冻结确认
b34d907 fix(security): P0安全封口 - growth-map/mastery/admin/books全API鉴权收敛
2ef8f17 fix(security): P0 安全收敛 - 统一 Child 数据访问鉴权边界
```

---

## 2. 数据库 Schema 版本

| 项目 | 值 |
|------|-----|
| Schema 定义文件 | `src/storage/database/shared/schema.ts` |
| 文件大小 | 8,830 bytes |
| 最后修改 | 2026-07-18（Freeze 期间未修改） |
| 迁移状态 | 无迁移文件，schema.ts 为 Drizzle 声明式定义 |

**核心表清单（Freeze 时共 11 张）：**

1. `parents_profiles` — 家长档案
2. `children` — 孩子档案（parent_id 外键）
3. `question_bank` — 题库
4. `test_sessions` — 测试会话
5. `test_answers` — 答题记录
6. `test_results` — 测试结果
7. `quick_assessment_results` — 快速测评结果
8. `guest_test_sessions` — 游客测试会话
9. `book_episodes` — 绘本集
10. `book_episode_pages` — 绘本页
11. `custom_books` — 定制绘本

**Freeze 期间数据库零修改。**

---

## 3. 环境变量版本

| 变量 | 用途 | 状态 |
|------|------|------|
| `COZE_SUPABASE_URL` | Supabase URL | 系统注入 |
| `COZE_SUPABASE_SERVICE_ROLE_KEY` | Service Role Key | 系统注入（仅服务端） |
| `NEXT_PUBLIC_SUPABASE_URL` | 客户端 Supabase URL | 系统注入 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 客户端 Anon Key | 系统注入 |
| `R2_ACCOUNT_ID` | Cloudflare R2 Account | 系统注入 |
| `R2_ACCESS_KEY_ID` | R2 Access Key | 系统注入（仅服务端） |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Key | 系统注入（仅服务端） |
| `R2_BUCKET_NAME` | R2 存储桶名 | 系统注入 |
| `DEPLOY_RUN_PORT` | 部署端口 | 系统注入 |

**安全确认：**
- 无任何 `NEXT_PUBLIC_*SECRET/KEY/TOKEN/PASSWORD` 变量
- Service Role Key 仅服务端使用，不暴露客户端
- 客户端仅使用 Anon Key + URL

---

## 4. API 安全扫描基线

**扫描范围**：28 个 API route 文件

### 4.1 Child 数据 API — 全部有 Ownership 校验

| API | 方法 | 鉴权方式 |
|-----|------|---------|
| `/api/children` | GET/POST | parent_id 过滤 |
| `/api/children/[id]` | PATCH | child ownership |
| `/api/sessions` | GET/POST/PATCH | child + session ownership |
| `/api/answers` | GET/POST | session ownership |
| `/api/results` | GET/POST | child + session ownership |
| `/api/quick-results` | GET | child ownership |
| `/api/growth-map` | GET | child ownership |
| `/api/mastery` | GET/POST | child + session ownership |
| `/api/books/custom` | GET | child ownership |
| `/api/books/custom/[id]` | GET | book → child ownership |
| `/api/books/generate` | POST | child ownership + confirmed_level only |

### 4.2 Admin / Content 写 API — 全部 403 禁用

| API | 方法 | 状态 |
|-----|------|------|
| `/api/admin/users` | GET | 403 |
| `/api/questions` | POST/PUT/DELETE | 403 |
| `/api/books/episodes/[id]/pages` | POST | 403 |
| `/api/books/episodes/[id]/import` | POST | 403 |
| `/api/books/episodes/[id]/import-from-r2` | POST | 403 |

### 4.3 公共 API（无需登录）

| API | 方法 | 说明 |
|-----|------|------|
| `/api/auth/login` | POST | 登录入口 |
| `/api/auth/signup` | POST | 注册入口 |
| `/api/auth/send-otp` | POST | 发送验证码 |
| `/api/auth/verify-otp` | POST | 验证验证码 |
| `/api/guest/test-result` | GET/POST | 游客测试结果 |
| `/api/questions` | GET | 题库公开读取 |
| `/api/books/episodes` | GET | 公共绘本列表 |
| `/api/books/episodes/[id]` | GET/PATCH | 公共绘本详情 |

### 4.4 已知 P1（未修复，待 Admin 体系）

| # | API | 方法 | 风险 |
|---|-----|------|------|
| P1-1 | `/api/books/episodes` | POST | 公共内容可写 |
| P1-2 | `/api/books/episodes/[id]` | PATCH | 公共内容状态可改 |
| P1-3 | `/api/seed` | POST | 题库可重建 |

**P0 数量（Freeze 时）：0**
**P1 数量：3**
**P2 数量：4**

---

## 5. P0 修复报告汇总

Freeze 期间共修复 **11 + 1 = 12 个 P0**（11个安全类 + 1个功能阻断类）：

| # | P0 描述 | 修复方式 | 修复 Commit |
|---|---------|---------|------------|
| 1 | `/api/answers` 无鉴权 | session ownership | `2ef8f17` |
| 2 | `/api/sessions` 无鉴权 | child + session ownership | `2ef8f17` |
| 3 | `/api/results` 无鉴权 | child + session ownership | `2ef8f17` |
| 4 | `/api/books/generate` 无鉴权 | child ownership | `2ef8f17` |
| 5 | `/api/questions` 写无鉴权 | 返回 403 | `2ef8f17` |
| 6 | `/api/growth-map` 无鉴权 | child ownership | `b34d907` |
| 7 | `/api/mastery` 无鉴权 | child + session ownership | `b34d907` |
| 8 | `/api/admin/users` 无鉴权 | 返回 403 | `b34d907` |
| 9 | `/api/books/episodes/[id]/pages` 无鉴权 | 返回 403 | `b34d907` |
| 10 | `/api/books/episodes/[id]/import` 无鉴权 | 返回 403 | `b34d907` |
| 11 | `/api/books/episodes/[id]/import-from-r2` 无鉴权 | 返回 403 | `b34d907` |
| 12 | `mode`/`test_mode` 字段名不匹配 + `time_limit_seconds` 缺失 | 修正字段名 + 补全字段 | `a775bae` |

---

## 6. Time Limit 回归结果

**配置来源**：`src/lib/types.ts` → `LEVEL_CONFIG[level].timeLimitSeconds`

| 等级 | 时间（秒） | 时间（分钟） | sampling | full |
|------|-----------|------------|----------|------|
| SRC100 | 300 | 5 min | ✅ | ✅ |
| SRC300 | 480 | 8 min | ✅ | ✅ |
| SRC500 | 720 | 12 min | ✅ | ✅ |
| SRC800 | 900 | 15 min | ✅ | ✅ |

- 前端倒计时来源：`LEVEL_CONFIG`（与后端一致，无第二套硬编码）
- 全项目 `session.mode` 错误引用：**0 处**

---

## 7. TypeScript / Lint 结果

| 检查项 | 结果 |
|--------|------|
| `pnpm lint --quiet` | ✅ PASS |
| `pnpm ts-check` | ✅ PASS |
| 服务启动 | ✅ Ready |

---

## 8. Level 体系基线

| 规则 | 来源 |
|------|------|
| Level 序列 | `src/lib/level-service.ts` — `LEVEL_SEQUENCE` |
| next_level | `src/lib/level-service.ts` — `getNextLevel()` |
| recommended_test_level | `src/lib/level-service.ts` — `getRecommendedTestLevel()` |
| confirmed_level 来源 | 仅 `test_results.level`（正式测试） |
| estimated_level 来源 | `quick_assessment_results`（快速测评） |
| current_level | = confirmed_level（无正式测试时为 null） |

**前端零 Level 业务计算**，所有 Level 判断均由后端 API 返回。

---

## 9. 核心架构冻结原则回顾

| 原则 | 状态 |
|------|------|
| Child ID 为所有学习数据唯一锚点 | ✅ |
| Parent-Child 归属校验全覆盖 | ✅ |
| Session Ownership 校验全覆盖 | ✅ |
| confirmed_level 仅来自正式测试 | ✅ |
| estimated_level 不冒充 confirmed | ✅ |
| Level Service 单一来源 | ✅ |
| 数据库零迁移 | ✅ |
| UI 零修改 | ✅ |
| 无 Teacher/Class/Admin 功能 | ✅ |

---

## 10. Freeze 之后的变更判定规则

后续如发现问题，按以下方式判定：

```
是 RC1 基线已存在的问题吗？
├── 是 → 记录为 RC1 Known Issue，评估是否需要 Hotfix
└── 否 → 检查 Freeze 之后的变更
    ├── 是 Bug 修复 → 走 Hotfix 流程（更新 RC 版本号）
    └── 是新功能 → 不属于本次 Release
```

**Hotfix 版本命名**：`SRC-2026-09-01-RC1.1`、`RC1.2` ...

---

**正式冻结签名：**
- 版本：SRC-2026-09-01-RC1
- 状态：SAFE TO FREEZE
- 冻结基线 Commit：`d0caa26`
