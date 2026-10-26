# SRC 唯一生产架构与边界｜V1.0

## 已知生产目标架构（需在每次变更前核对现状）
GitHub main → Vercel Production (Next.js) → Cloudflare Worker `src-primary-api` → Cloudflare D1 `src-primary-database`；绘本图片来自 Cloudflare R2。Production 入口：https://src-c-chinese-assessment.vercel.app/ 。

## 不变量
- Production 唯一业务数据库：Cloudflare D1 `src-primary-database`。不得擅自恢复 Supabase 作为生产数据源。
- Next API 代理、Worker API、D1 表结构、R2 图片分别有清晰责任边界。
- 孩子数据访问必须经过会话与 child 归属校验。
- Preview 不得访问生产 Worker；该约束必须用部署环境/代码只读证据验证，不可只凭文档断言。
- 未经授权不得新建平行生产数据库、替换认证机制、硬编码秘密或生产域名兜底。

## 当前已知待核验事项
Formal Test 全链路迁移完成度、Books 旧路由残留、Preview 守卫线上部署情况，均应以最新代码和生产证据为准。历史摘要不可替代当前核验。
