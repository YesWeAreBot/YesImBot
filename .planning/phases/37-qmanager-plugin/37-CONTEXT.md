# Phase 37: QManager Plugin - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Bot 拥有管理员权限时，可执行群管操作（撤回消息、禁言、踢人）。三个管理工具通过 Skill 激活机制暴露给 LLM，仅在 bot 持有 admin/owner 角色时可见。插件结构遵循 Interactions Plugin (Phase 36) 的模式。

</domain>

<decisions>
## Implementation Decisions

### 工具行为设计

- 三个工具均为 Action 类型（有副作用，成功时默认不触发心跳，失败时请求心跳）
- `delmsg`: 接受 messageId 数组，支持批量撤回
- `ban`: duration 参数以秒为单位，0 = 解除禁言
- `kick`: 移除用户出群
- 工具层拦截：禁止操作 bot 自身、禁止操作管理员/群主（不调用平台 API，直接返回错误）

### 权限激活机制

- 角色检测来源：读取 Phase 34 ENV-03 enriched entities 中的 bot 角色信息
- 角色判定标准：owner 或 admin 均视为"管理员角色"
- 激活粒度：全有全无——bot 有管理员角色时 Skill 激活，三个工具全部可见；无角色时全部隐藏
- 角色变更响应：实时——bot 被提升/降级管理员时，工具可见性立即更新

### LLM 调用引导

- 工具 description：中性描述，不含"谨慎使用"等警告语
- Skill description：包含典型使用场景示例（如违规发言、刷屏骚扰等）
- 执行方式：LLM 决定调用后直接执行，不需要向用户确认
- 描述语言：工具描述和 Skill 描述均使用中文

### 错误处理与反馈

- 成功反馈：中文自然语言确认（如"已禁言用户 @Alice 10分钟"）
- 错误反馈：中文自然语言错误信息（如"禁言失败：目标用户是管理员"）
- 平台 API 错误：包装成友好中文信息后返回，不透传原始错误
- 重试策略：不自动重试，失败直接返回错误让 LLM 判断

### Claude's Discretion

- 具体的 Skill 场景示例措辞
- delmsg 批量操作的数组上限（如有必要）
- 工具参数的具体命名风格（与现有 Action 保持一致即可）

</decisions>

<specifics>
## Specific Ideas

- 插件结构参照 Phase 36 Interactions Plugin 的模式：独立插件包 + 自带 Skill 定义
- Action 类型遵循现有架构：成功时默认不触发心跳，仅失败或显式指定时请求心跳
- 工具层安全拦截在调用平台 API 之前完成，避免不必要的网络请求

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 37-qmanager-plugin_
_Context gathered: 2026-02-28_
