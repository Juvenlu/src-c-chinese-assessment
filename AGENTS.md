# AGENTS.md - SRC-C 中文成长评估系统

## 项目概览

SRC-C (Stable Reading Chinese & Culture) 是面向海外华人青少年的中文识字量测评系统。目标用户为5-14岁、中文为第二语言或弱母语的华人青少年。

当前版本 V1 仅开发"稳定识字量测评"模块，包含两种测试模式和四个测试部分。

### 测试模式
1. **逐字测试（full）**：字库逐个展示，不限时，全面检测每个字/词的掌握情况（支持SRC300/SRC500/SRC800三级字库）
2. **抽测闯关（sampling）**：限时抽样测试，快速评估识字量水平

### 测试部分（抽测闯关模式）
1. 字形识别（30%权重）
2. 词汇识别（30%权重）
3. 句子识别（20%权重）
4. 理解测试（20%权重）

### 技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **Database**: Supabase (PostgreSQL)
- **Charts**: Recharts
- **Icons**: Lucide React

### 目录结构

```
├── public/                     # 静态资源
├── src/
│   ├── app/                    # 页面路由
│   │   ├── page.tsx            # 首页（双模式选择+分享入口）
│   │   ├── profile/page.tsx    # 用户信息+等级选择（支持mode参数）
│   │   ├── fulltest/page.tsx   # 逐字测试页面（300字/词逐个测试）
│   │   ├── test/page.tsx       # 抽测闯关核心页面（四部分测试流程）
│   │   ├── result/page.tsx     # 测试结果页
│   │   ├── report/page.tsx     # 家长成长报告
│   │   ├── history/page.tsx    # 历史记录+成长曲线
│   │   ├── admin/page.tsx      # 管理后台
│   │   ├── api/                # API 路由
│   │   │   ├── children/       # 孩子档案 CRUD
│   │   │   ├── questions/      # 题库 CRUD
│   │   │   ├── sessions/       # 测试会话管理
│   │   │   ├── answers/        # 答案提交
│   │   │   ├── results/        # 测试结果计算与查询
│   │   │   └── seed/           # 题库初始化
│   │   └── layout.tsx          # 根布局
│   ├── components/ui/          # shadcn/ui 组件
│   ├── lib/
│   │   ├── types.ts            # 类型定义+常量配置
│   │   ├── questions.ts        # 题库种子数据（SRC300:67题+SRC500:20题+SRC800:20题=107题，三级字表词表）
│   │   ├── scoring.ts          # 评分算法+游戏化反馈
│   │   └── utils.ts            # 通用工具
│   └── storage/database/
│       ├── supabase-client.ts  # Supabase 客户端
│       └── shared/schema.ts    # Drizzle ORM schema
├── DESIGN.md                   # 设计规范
├── AGENTS.md                   # 本文件
├── next.config.ts
├── package.json
└── tsconfig.json
```

## 构建和测试命令

- **开发**: `pnpm run dev`
- **构建**: `pnpm run build`
- **启动**: `pnpm run start`
- **类型检查**: `pnpm ts-check`
- **Lint**: `pnpm lint`
- **包管理**: 仅使用 `pnpm`

## 数据库结构

5张核心表（Supabase PostgreSQL）：

| 表名 | 说明 | 关键字段 |
|------|------|---------|
| children | 孩子档案 | id, name, age, grade, country, language_env |
| question_bank | 题库 | id, level, character, word, sentence, options, answer, story_* |
| test_sessions | 测试会话 | id, child_id, level, status, started_at, completed_at |
| test_answers | 答案记录 | id, session_id, question_id, part, is_correct, reaction_time_ms |
| test_results | 测试结果 | id, session_id, child_id, level, *_score, stable_char/vocab_count |

## API 接口

| 路径 | 方法 | 功能 |
|------|------|------|
| /api/children | GET/POST | 查询/创建孩子档案 |
| /api/questions | GET/POST/PUT/DELETE | 题库 CRUD |
| /api/sessions | GET/POST/PATCH | 测试会话管理 |
| /api/answers | GET/POST | 答案提交与查询 |
| /api/results | GET/POST | 结果计算与查询 |
| /api/seed | POST | 初始化题库数据 |

## 测评等级

| 等级 | 时间限制 | 题库字数 | 词汇倍率 | 题目数 |
|------|---------|---------|---------|--------|
| SRC300 | 8分钟 | 300字 | 2.86x | 67题 |
| SRC500 | 12分钟 | 500字 | 2.86x | 87题(67+20) |
| SRC800 | 15分钟 | 800字 | 2.86x | 107题(87+20) |

## 评分算法

- 四部分权重：字形识别30%、词汇识别30%、句子识别20%、理解测试20%
- 稳定识字量 = 综合得分率 × 等级字数 + 反应时间信心加成
- 稳定词汇量 = 稳定识字量 × 词汇倍率(2.86)
- 游戏化：XP经验值、星星评级、徽章系统

## 代码风格

- TypeScript strict 模式，禁止隐式 any
- Supabase 使用 service_role_key 客户端（无 Auth）
- 使用 CSS 自定义属性（--color-src-*）实现品牌色彩
- 字体：ZCOOL KuaiLe（标题）、Noto Sans SC（正文）
- 动画：自定义 keyframes（bounce-in, float-up, star-spin 等）

## V1 暂不开发

- AI自动出题、AI批改作文、AI对话
- 文化指数、阅读推荐系统
