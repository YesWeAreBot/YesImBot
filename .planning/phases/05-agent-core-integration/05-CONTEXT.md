# Phase 5: Agent Core & Integration - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Orchestrate the complete agent loop from stimulus to response. AgentCore accepts Percept input from Phase 3's Horizon system, executes a think-act loop (context build → LLM call → tool execution → response generation), and integrates with Koishi for message send/receive. Willingness calculation is Phase 6 scope.

</domain>

<decisions>
## Implementation Decisions

### Think-Act 循环策略

- 使用原生 tool call（ai-sdk），不再使用 JSON 结构化文本协议
- 只支持具备 tool call 能力的模型
- `toolChoice: "required"` 强制每轮必须调用工具
- 显式 finish tool 作为终止信号——agent 调用 finish 表示循环结束
- 最大循环轮次默认 3 轮，可配置
- LLM 输出的 content 字段直接丢弃（或可选记录为内心独白）
- 允许静默完成（不强制文本回复，工具执行即可作为最终动作）
- 终止判断：每轮检查 tool calls，包含 tool 类调用则结果回流继续循环；只有 action 类调用且无 tool 类调用时，也视为终止（finish tool 是显式兜底）

### 响应生成与输出

- send_message 是唯一与用户交流的方式，content 使用 Koishi Element 格式
- send_message 支持 target 参数（`platform:id` 格式），默认当前频道，可跨平台跨频道发送
- 支持 `<sep/>` 分割长消息为多条自然发送
- 调用 send_message 时即时发送，不等循环结束
- LLM 调用方式可配置：流式（streamText）或完整（generateText）
- 流式模式下，单个完整 tool call 作为最小分割原子，生成一个就执行一个
- agent 响应压缩为单条 AgentSummary Event 存入 Timeline（与 Phase 3 设计一致）
- 不再单独记录 bot 发送的消息事件，AgentSummary 已隐含

### 工具调用行为

- 同一轮多个 tool calls 顺序执行，保证可预测性
- 工具执行失败时，错误信息作为 tool result 返回给 LLM 自行决策
- 双层超时：单工具超时 + 全局循环超时
- 工具返回结果过长时截断，并提示 LLM 结果被截断

### 消息触发与 Koishi 集成

- Percept 直接驱动 AgentCore（Phase 5 不含 willingness 过滤）
- 复用 Phase 3 的 EventListener → Percept → AgentCore 完整链路
- 会话级隔离：同一会话（Entity/Environment）串行处理，不同会话并行
- send_message 工具内部直接调用 Koishi bot.sendMessage API
- 队列堆积处理：当前 Percept 处理中时，新到达的 Percept 合并处理，避免连续回复过时话题

### Claude's Discretion

- finish tool 的具体 schema 设计
- 流式解析器的具体实现方式
- 单工具超时和全局超时的默认值
- AgentSummary 的压缩策略细节
- Percept 合并的具体合并逻辑

</decisions>

<specifics>
## Specific Ideas

- v3 的 send_message 实现作为参考：支持 `<at>`、`<quote>`、`<img>`、`<sep/>` 等平台消息元素
- v3 的 StreamParser 作为流式解析参考（但 v4 用原生 tool call 后可直接用 ai-sdk 的流式事件）
- 文档 "4. 标准工具调用.md" 中的设计讨论：所有 agent 输出都必须是 tool call，send_message 是唯一交流方式
- 不同模型对"一轮多个 tool call vs 分轮调用"行为不一致，finish tool 解决了这个可靠性问题

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 05-agent-core-integration_
_Context gathered: 2026-02-18_
