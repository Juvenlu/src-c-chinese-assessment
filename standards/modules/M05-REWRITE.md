# M05 AI 改写与人工审核
**状态：Sean ep3 实证。**
Rewrite draft/review 与人工编辑分离。管理员编辑模式的「✏️ 编辑」不是保存；「💾 保存」PATCH pages_json 并重算字数统计，不自动重算 validation_result。保留 generation_params_json 的模型/工具/审计溯源。人工审核须对照每页图文、语言难度与 frontier；不以启发式 PASS/FAIL 取代人工决定。详细见 `../sops/SOP-BOOK-PRODUCTION-V1.md`。
