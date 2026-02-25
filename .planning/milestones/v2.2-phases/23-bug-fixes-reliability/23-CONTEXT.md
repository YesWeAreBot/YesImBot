# Phase 23: Bug Fixes & Reliability - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

修复 snippet 模板变量渲染 bug，补全 JSON parser 的 vitest 测试套件（复刻 v3 的 18 个用例），让私聊场景具备消息聚合窗口和 per-user 速率限制，使 DM 回复行为自然可控。

</domain>

<decisions>
## Implementation Decisions

### DM 聚合窗口行为
- 自适应超时：根据用户发送节奏动态调整等待时间，范围 3-8 秒
- 每收到新消息重置计时器，但设最大聚合上限（防止无限等待）
- 聚合后的多条消息保留多条结构传给模型，不合并为单条文本
- 模型能看到用户是分段发送的，保留对话的自然节奏感

### DM 速率限制策略
- Token bucket 算法，允许短时突发但长期平均受控
- 全场景 per-user 限制（私聊和群聊都生效），私聊和群聊参数可独立配置
- 参数可配置，提供合理默认值（桶容量、补充速率由研究阶段确定）
- 触发限制后静默忽略，不回复也不提示

### Snippet 渲染修复范围
- 修复现有变量（`{{date.now}}`、`{{bot.name}}` 等）的渲染 bug，同时补充新的模板变量
- 重新设计 renderFn 的 `currentScope` 上下文参数结构：采用嵌套对象（`{ bot: { name }, date: { now }, percept: { ... } }`），模板中用点号路径访问
- 变量不可用时保留原始模板标记（如 `{{bot.name}}`），不输出空字符串
- 渲染失败时输出 debug 级别日志，方便排查哪些变量未解析

### JSON Parser 测试边界
- 严格复刻 v3 的 18 个测试用例，不新增 v4 特有边界场景
- 从 v3 代码直接迁移测试 fixture 和数据，保证一致性
- v4 parser 接口与 v3 一致，迁移无需适配
- 解析失败的用例（截断字符串、悬空键等）期望容错返回 null，不抛异常

### Claude's Discretion
- 自适应超时的具体算法（节奏检测逻辑）
- 最大聚合上限的具体数值
- Token bucket 的默认参数（桶容量、补充速率）
- currentScope 中具体包含哪些新变量（基于 Percept 字段分析）

</decisions>

<specifics>
## Specific Ideas

- dev 时期尝试从 session 和 Percept 提取字段，但某些场景不提供 session，不同类型 Percept 可用字段也不同。v4 统一了 Percept，需要合理设计 currentScope 的上下文参数结构
- 某些平台暴露了单聊用户输入状态（"正在输入"），未来可用于精确控制回复时机（本期不实现）
- 有用户反馈因速率限制或 LLM 输出格式错误、工具调用失败等原因导致循环异常中断时，希望能收到提醒消息（留到未来实现，提供配置开关）

</specifics>

<deferred>
## Deferred Ideas

- "正在输入"状态检测：某些平台暴露单聊用户输入状态，可用于精确控制聚合窗口的回复时机 — 未来增强
- 异常中断提醒：速率限制、LLM 输出格式错误、工具调用失败等导致循环中断时，发消息提醒用户 — 未来实现，提供配置开关

</deferred>

---

*Phase: 23-bug-fixes-reliability*
*Context gathered: 2026-02-25*
