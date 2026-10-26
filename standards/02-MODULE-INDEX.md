# SRC 功能模块标准目录｜V1.0

每个模块均应维护：职责/边界、数据模型、API 契约、鉴权、状态机、失败处理、只读核验 SQL、测试、发布/回滚、证据、已知缺陷。

| 模块 | 标准文件 | 当前状态 |
|---|---|---|
| 认证与孩子档案 | modules/M01-AUTH-CHILDREN.md | **DRAFT**（双轨事实已补记，完整契约待代码核验） |
| 测评与评分 | modules/M02-ASSESSMENT.md | **DRAFT**（迁移完成度 UNKNOWN，待代码核验） |
| 等级与成长地图 | modules/M03-GROWTH.md | **DRAFT**（基线草案，待代码核验） |
| Master 故事与图片 | modules/M04-MASTER-ASSETS.md | **VERIFIED**（限 ep4 Master Lock 实证；其他故事待核验） |
| AI 改写与人工审核 | modules/M05-REWRITE.md | **VERIFIED**（Sean ep2/ep3 实证） |
| Finalize/Activate/推送 | modules/M06-VERSIONING.md | **VERIFIED**（Sean ep3 实证） |
| 孩子书架与阅读 | modules/M07-READER.md | **VERIFIED**（Sean ep3 实际 UI 验证） |
| 阅读完成与反馈 | modules/M08-COMPLETION-FEEDBACK.md | **VERIFIED**（Sean ep3 D1 实证） |
| 管理后台 | modules/M09-ADMIN.md | **DRAFT**（部分页面实证，其余待核验） |
| 部署、环境与数据安全 | modules/M10-DEPLOYMENT.md | **DRAFT**（目标规范，实际守卫状态待核验） |
| 游戏与课堂/老师模式 | modules/M11-FUTURE.md | **PLANNED**（规划，不得视为已上线） |

原则：VERIFIED 的模块可作为 SOP；DRAFT 模块只能作为待核验规范，不得标记为已实施；PLANNED 不得视为已上线。状态升级须经 Production/代码只读证据 + 管理员批准。
