# Phase 4: Prompt & Tool Services - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

为 AgentCore 提供 prompt 模板渲染和工具注册/执行基础设施。PromptService 管理系统 prompt 的模板化渲染与人格配置注入；PluginService（原 ToolService）管理工具的注册、分组和分发执行。不包含 AgentCore 循环本身（Phase 5）。

</domain>

<decisions>
## Implementation Decisions

### Prompt 模板机制

- 模板引擎：继续使用 Mustache（v3 已验证可用，轻量成熟）
- 存储方式：内置默认模板 + 配置项可覆盖（优先级：配置 > 内置）
- 模板粒度：分片组合——人设、规则、记忆等为独立模板片段，固定顺序拼接成 system prompt
- 插件 prompt 注入：插件通过 PromptService API 注册额外规则片段（带名称和优先级），插入规则片段区域内
- 混合 prompt 方案已确定（见 HORIZON-DESIGN.md）：[system] 人设+规则+记忆 → [user] Horizon 视图 → [assistant/tool] 标准多轮
- 参考实现：dev 版 `services/prompt/` — PromptService + MustacheRenderer + Snippet/Injection 机制

### 工具注册模式（PluginService）

- 命名：ToolService 更名为 PluginService，作为未来框架扩展点
- 注册风格：Decorator 装饰器为主（`@Tool()` / `@Action()`），保留函数式注册方法（`defineTool()` / `defineAction()`）
- Schema 验证：使用 Koishi Schema 定义参数，自动转换为 JSON Schema 供 LLM 使用
- 命名空间：工具按插件分组管理，PluginService 维护分组信息
- LLM 格式转换：注册时声明工具描述，PluginService 自动转为 ai-sdk tool 格式
- 运行时上下文注入：部分工具需要 session/view/percept 等运行时上下文，通过 FunctionContext 注入
- 参考实现：dev 版 `services/plugin/` — decorators + types + base-plugin + service

### 工具分类：Tool vs Action

- Tool（工具）：获取信息类，如 get_time、get_weather，返回结果传回 LLM 继续循环
- Action（行动）：执行操作类，如 send_message、ban_member，成功时静默不触发下一轮 LLM 调用（节省 API 成本）
- Action 失败处理：成功静默 + 失败回传错误信息给 LLM，让 agent 决定是否重试

### 工具执行与安全

- 超时策略：全局默认超时 + 工具可覆盖
- 权限控制：无权限分级，所有工具平等
- 错误处理：错误信息返回 agent，由 agent 自行判断下一步
- 结果格式：工具返回结构化对象，PluginService 序列化后传给 LLM
- 异步扩展：统一 async handler，未来异步工具返回 `{ taskId }` 不需要改接口

### 内置工具选择

- send_message：核心包内置，agent 发送消息到当前会话的基本能力
- get_session_info：作为独立工具插件示范，验证第三方工具注册流程和运行时上下文注入

### Claude's Discretion

- Mustache 渲染器的具体实现细节（可参考 dev 版 MustacheRenderer）
- 全局默认超时的具体数值
- PluginService 内部分组数据结构
- get_session_info 返回的具体字段

</decisions>

<specifics>
## Specific Ideas

- 参考 dev 版 `services/plugin/` 和 `services/prompt/` 的架构设计，v4 精简沿用
- dev 版的 Snippet（动态数据片段）+ Injection（插件注入）机制已验证可用
- dev 版的 `withInnerThoughts` 辅助函数为工具参数添加内心独白字段，可考虑保留
- 异步任务系统（`books/02_异步任务系统.md`）不在 v4 scope，但统一 async handler 设计保证未来可平滑扩展

</specifics>

<deferred>
## Deferred Ideas

- 异步任务系统（submit_task / get_task_status / get_task_result）— 未来版本
- 工具权限分级（safe/dangerous 标记）— 如有需要在后续版本添加
- Slot 插槽机制替代固定顺序拼接 — 如固定顺序不够灵活时再考虑

</deferred>

---

_Phase: 04-prompt-tool-services_
_Context gathered: 2026-02-18_
