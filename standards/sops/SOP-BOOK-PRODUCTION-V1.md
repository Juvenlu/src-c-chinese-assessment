# SRC 个性化绘本 AI 生产与发布标准 SOP｜V1.0

## 适用范围与证据
适用于 Master 已发布、孩子有真实阅读画像、管理员审核的个性化绘本。实证样本：Sean《西游记》第3集 Master episode_id=4，Rewrite #31，Custom Book #7；2026-10-26 Production 验证。第2集 Rewrite #30 为辅助对照。不同故事、等级和环境必须重新核验，不得复制 ID。

## 状态与权限边界
Master published → 生成 rewrite(status=review) → 人工编辑保存(status=review) → Finalize(status=final) → Activate(创建/激活 custom_book) → 孩子端阅读 → 末页完成事件持久化 → 可选阅读反馈。推送置新为独立授权操作；Finalize 不自动 Activate；Activate 不自动推送。

## 标准步骤与验收
1. **准备**：核验 child ID、SRC 等级、已知字词/frontier、Master episode_id、页数、图片和 D1 记录；只读检查重复 rewrite、未完成名额与环境。
2. **内容创作**：Agent 依据 Master 创作，故事自然性优先，i+1 以已知字词为主；已知字组合新词优先；避免为凑字数机械扩写。10页目标：SRC100 100–150 CJK；SRC300 300–380；SRC500 500–600。8页版本需按批准目标单独审定，不机械套用10页指标。
3. **审核**：人工逐页对照 Master、图片、情节、语言难度、frontier。语言难度启发式 FAIL 不得隐瞒，人工决定是否接受并记录理由。
4. **创建草稿**：管理员单独授权后，通过已核验 Admin/同源代理提交一次；密码只在管理员受控浏览器输入，不传给 Agent；Production D1 只读核验唯一性、8页 JSON、Master 图文锁、溯源、状态 review、表计数。禁止重试未知成功的 POST，先查库。
5. **人工修改保存**：Admin 绘本工坊点「✏️ 编辑」仅进入编辑模式；修改后必须点独立「💾 保存」；该 PATCH 写 pages_json 并重算 total_chars、unique_chars、max_page_chars，status 仍 review。保存后 Agent 只读 diff、字数、Master Lock、frontier、溯源、状态。注意 validation_result_json 不自动重算，旧快照不得冒充新稿验证结果。
6. **Finalize**：管理员确认最终文本并单独授权；点「✅ 发布 Final」并确认；只更改 status/finalized_at/finalized_by，不携带未保存编辑。Agent 只读核验正文、统计、Master、custom_books 不变。
7. **Activate**：先核验孩子未完成名额（最多2本；未开始/阅读中占用；真实 completed=1 持久化才释放；历史已完成资格保留）、同集旧版、API 守卫。管理员单独授权点「设为正式版」；Agent 核验新 custom_book 唯一、active、rewrite 关联正确、旧书未受影响、pushed_at=NULL。
8. **推送置新（可选）**：必须另行授权，不能视为 Activate 的一部分。
9. **孩子端验收**：实际登录孩子账号，核对书架、8页图文、翻页、末页完成按钮；不得让 Agent 代替孩子制造完成事件。
10. **完成持久化核验**：D1 查 reading_records 中真实 completed=1、pages_read=总页数、完成时间、时长；重新计算未完成名额。反馈与完成事件独立，未提交反馈不阻塞完成。
11. **反馈（可选）**：孩子自主反馈故事喜好与难度；反馈用于下一本调整，不自动修改当前绘本或 confirmed_level。

## 第3集验证基线（历史证据，非未来固定预期）
Rewrite #31：SRC500，8页，576 CJK；DB total_chars/unique_chars/max_page_chars=707/225/117；Finalized by admin。Custom Book #7 active、未推送；阅读 rr#7：8/8、completed=1、187秒；完成后 Sean 未完成名额0/2。反馈当时未提交。所有未来任务必须使用当时最新 Production 数据重新计算。

## 异常与停机规则
- 401：先检查认证/会话，不重复提交。
- 保存后 validation 快照过期：标记 STALE；不得伪称 PASS。
- 写入结果不确定：先 D1 只读查询，不盲目重复 POST。
- 名额不足：停止，不得伪造完成记录。
- 图文不匹配、重复 rewrite、错误 child、Preview 误连生产：停止，先调查。
- UI 显示来源 unknown：可能为 UI 字段映射问题；需核验 generation_params_json，不可直接推断溯源丢失。

## 角色
Agent：代码核验、内容初稿、只读审计、差异分析、受权范围内可执行操作；管理员：人工审核、秘密输入、真实浏览器交互、每次生产写入授权；孩子：真实阅读与反馈。
