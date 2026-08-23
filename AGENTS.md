# AGENTS.md - SRC-C 中文成长评估系统

## 项目概览

SRC-C (Stable Reading Chinese & Culture) 是面向海外华人青少年的中文识字量测评系统。目标用户为5-14岁、中文为第二语言或弱母语的华人青少年。

当前版本 V1.0，核心模块为"稳定识字量测评"，包含两种测试模式、双字库体系、智能抽样算法和成长地图。

### 版本演进
- **V1.0**：智能抽样算法、双字库体系（SRC+人教版）、成长地图、个人测字历史
- **V1.1**：基于v1.2字库，四级递进（SRC100/300/500/800），智能三分池抽样

### 测试模式
1. **逐字测试（full）**：智能抽选字库中重点字/词，动态调整测试内容（支持SRC100/SRC300/SRC500/SRC800四级字库）
2. **抽测闯关（sampling）**：限时抽样测试，快速评估识字量水平

### 测试部分（抽测闯关模式）
1. 字形识别（30%权重）
2. 词汇识别（30%权重）
3. 句子识别（20%权重）
4. 理解测试（20%权重）

### V1.0 核心功能
- **双字库体系**：SRC字库（阅读高频）+ 人教版识字表（课标对照）
- **智能抽样算法**：三分池（复测池45% + 新题池45% + 稳定性复测池10%）+ 去聚集机制
- **四级测字比例**：SRC100全测 / SRC300约30% / SRC500约25% / SRC800约20%
- **成长地图**：三维度进度（SRC识字量 + 人教版对照 + 词汇量）+ 成长趋势 + 优势/弱项分析
- **掌握度状态**：6级状态（未测/初测/掌握中/基本掌握/稳定掌握/需复习）
- **个人测字历史**：character_mastery + vocabulary_mastery 两张表（数据库表结构已设计）
- **直接测试（快速测评）V2.0**：无需注册，自适应分级探测，双水位测量，Reading Base ≤ Word Level，i+1推荐，3-5分钟快速评估
  - 算法：`src/lib/quick-assessment.ts`（V2.0 自适应分级 + 边界确认 + Confidence Booster）
  - 页面：`/quicktest`、`/quickresult`
  - 每级6单字+3词语=9题，单字最多30题、词语最多15题、总题≤45
  - 三核心指标：Character Level / Word Level / Reading Base Level
  - 置信度：高/中/低
  - 题池：基于 Assessment Item Pool（minimum_src_level + 核心/补充分层）
  - 全部参数集中于 `ASSESSMENT_CONFIG` 可配置

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
│   │   ├── admin/page.tsx      # 管理后台（含绘本工坊）
│   │   ├── book-select/page.tsx # 绘本系列选择页
│   │   ├── book/[id]/page.tsx   # 绘本阅读翻页页
│   │   ├── api/                # API 路由
│   │   │   ├── children/       # 孩子档案 CRUD
│   │   │   ├── questions/      # 题库 CRUD
│   │   │   ├── sessions/       # 测试会话管理
│   │   │   ├── answers/        # 答案提交
│   │   │   ├── results/        # 测试结果计算与查询
│   │   │   ├── seed/           # 题库初始化
│   │   │   └── books/          # 绘本相关 API
│   │   │       ├── episodes/   # 绘本集 CRUD + 页上传
│   │   │       ├── custom/     # 定制绘本查询
│   │   │       └── generate/   # 绘本生成（i+1 改写）
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
| book_episodes | 绘本集 | id, series_name, episode_number, episode_title, page_count, status |
| book_episode_pages | 绘本页 | id, episode_id, page_number, image_url, original_text |
| custom_books | 定制绘本 | id, child_id, episode_id, level_tier, initial_char_count, pages_json, new_chars, cumulative_chars, version |

## API 接口

| 路径 | 方法 | 功能 |
|------|------|------|
| /api/children | GET/POST | 查询/创建孩子档案 |
| /api/questions | GET/POST/PUT/DELETE | 题库 CRUD |
| /api/sessions | GET/POST/PATCH | 测试会话管理 |
| /api/answers | GET/POST | 答案提交与查询 |
| /api/results | GET/POST | 结果计算与查询 |
| /api/seed | POST | 初始化题库数据 |
| /api/books/episodes | GET/POST | 绘本集列表/创建 |
| /api/books/episodes/[id] | GET/PATCH | 绘本集详情/更新 |
| /api/books/episodes/[id]/pages | POST | 上传绘本页（图片+文本） |
| /api/books/generate | POST | 为孩子生成定制绘本（i+1 改写） |
| /api/books/custom | GET | 查询孩子的定制绘本列表 |
| /api/books/custom/[id] | GET | 获取单本定制绘本详情 |

## 测评等级

### SRC 字库（阅读高频体系）
| 等级 | 时间限制 | 题库字数 | 词汇倍率 | 词汇量 | 单字测比 |
|------|---------|---------|---------|--------|---------|
| SRC100 | 5分钟 | 114字 | 2.86x | 128词 | 100% |
| SRC300 | 8分钟 | 317字 | 2.86x | 346词 | 30% |
| SRC500 | 12分钟 | 528字 | 2.86x | 558词 | 25% |
| SRC800 | 15分钟 | 813字 | 2.86x | 820词 | 20% |

### 人教版识字表（课标对照体系）
| 等级 | 说明 | 字数 | 对应SRC |
|------|------|------|---------|
| RJB100 | 一年级上册 | 100字 | SRC100 |
| RJB300 | 一年级 | 300字 | SRC300 |
| RJB500 | 二年级 | 499字 | SRC500 |
| RJB800 | 三年级 | 799字 | SRC800 |

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

## V1.0 更新说明

### 字库升级（v1.2）
- **SRC字库**：SRC100(114字) / SRC300(317字) / SRC500(528字) / SRC800(813字)
- **人教版字库**：RJB100(100字) / RJB300(300字) / RJB500(499字) / RJB800(799字)
- 来源：Cloudflare R2 `ziciku/v1.2/` 和 `ziciku/renjiaoban/`

### 四级测字比例
| 等级 | 单字测试比例 | 词组测试比例 | 估算单字题数 |
|------|------------|------------|------------|
| SRC100 | 100%（全测） | 30% | 114 |
| SRC300 | 30% | 15% | ~95 |
| SRC500 | 25% | 12% | ~132 |
| SRC800 | 20% | 10% | ~163 |

### 智能抽样算法 (`src/lib/item-selection.ts`)
- **三分池策略**：复测池45% + 新题池45% + 稳定性复测池10%
- **去聚集机制**：避免相同部首/同音字连续出现，保证汉字覆盖面
- **分层随机**：难度分布（双字词80% / 三字词15% / 四字词5%）
- **掌握状态**：6级（untested / first_test / learning / basic_mastery / stable_mastery / needs_review）
- **独立模块**：纯数据输入输出，未来可替换为IRT/CAT/Bayesian

### 成长地图页面 (`/growth-map`)
- 三维度进度：SRC识字量 + 人教版对照 + 词汇量
- 成长趋势图（近6个月）
- 优势/弱项分析
- 下一步建议（AI绘本、分级读物、每日练习）
- 未来模块预留（写作、文化、表达）

### 新API接口
| 路径 | 方法 | 功能 |
|------|------|------|
| /api/growth-map | GET | 成长地图数据（三维度+趋势+建议） |
| /api/mastery | GET | 个人掌握度明细（单字/词汇） |
| /api/results | GET/POST | 结果计算（双体系交叉验证） |

### 数据库表结构（待建表）
- `character_mastery`：单字掌握度历史（id, child_id, character, level, system, total_tests, correct_count, mastery_status, ...）
- `vocabulary_mastery`：词汇掌握度历史
- `test_history`：测试会话历史记录
- 注：当前V1.0版本使用前端内存+API模拟数据，数据库表结构已定义在 types.ts 中
