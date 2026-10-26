# M10 部署与生产安全
**状态：目标规范，实际守卫状态待核验。**
GitHub main→Vercel Production→Worker→D1；Preview 与 Production 严格隔离。每次部署前检查 branch/commit、环境变量、硬编码域名、API 代理、D1 binding、迁移风险、回滚；部署需单独授权。生产只读审计不得顺带部署或修库。Secrets 不写日志、文档或对话。
