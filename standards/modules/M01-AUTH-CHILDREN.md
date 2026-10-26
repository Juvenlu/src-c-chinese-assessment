# M01 认证与孩子档案
**状态：DRAFT（部分历史事实已知，完整代码契约待只读核验）。**
Production 认证经 Worker/D1；会话使用 HMAC cookie `src_auth_session`；密码 Argon2id。父母与孩子归属必须在服务端校验。核验 signup/login/me/logout、children GET/POST/PATCH、错误状态、会话生命周期、归属与隐私；不得以浏览器传参代替权限判断。更改认证必须单独批准、测试回滚。

## 认证双轨事实（接入时核验补记，02B 已审）
- **Worker 新链路（现行）**：`/v1/auth/login` 等 → D1 `parents` 表 → `verifyPassword` 优先校验 `$argon2id$` 哈希 → `createSessionCookie` 签发 HMAC HttpOnly cookie `src_auth_session`。
- **旧 Next 链路（仍存在，未删除）**：`/api/auth/*`（login/signup/me/logout 等）使用 bcryptjs + `localStorage(src_session)` Token + 旧数据访问路径（`parents_profiles` 等）。
- 旧路径的 Production 实际可达性与认证迁移完成度 **UNKNOWN**，未经专项只读核验不得宣布"迁移已完成"。
- **禁止**借标准化之名删除旧代码或改动认证行为；任何认证变更须单独授权、影响分析与回滚方案。
