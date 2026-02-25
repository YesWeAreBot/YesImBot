# Phase 24: Observability - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

每条消息处理流程端到端可追踪（traceId 贯穿全链路），结构化 debug 日志覆盖关键节点，Judge 提示词升级为包含人设摘要和结构化输出格式。不涉及性能优化、prompt cache、working memory 改进（属于 Phase 25）。

</domain>

<decisions>
## Implementation Decisions

### TraceId 设计
- nanoid 短 ID 格式，前缀 `msg-`（如 `msg-a3f8b2c1`），简短好读
- 入口层（listener 收到消息时）生成，封装为 context 对象逐层传递
- 显式传递 context 对象（包含 traceId + 其他元数据），不挂在 session 上
- 日志前缀自动注入 traceId，格式：`[msg-xxxxxxxx] namespace key=value`

### 日志命名空间与粒度
- `agent.*` 层级结构，用点号分层
  - `agent` — 顶层通用日志
  - `agent.willingness` — 意愿值判断
  - `agent.loop` — agent 循环（工具调用等）
  - `agent.model` — 模型调用（延迟、token）
  - `agent.parser` — JSON 解析结果
  - `agent.tool` — 工具执行结果
- key=value 结构化格式输出 debug 日志
- 各命名空间自定义字段，不强制统一 schema
- 完全依赖 Koishi 原生 Logger，不做额外封装

### Judge 提示词改进
- JSON 结构化输出替代裸 yes/no，字段：`decision`(bool)、`confidence`(number)、`reasoning`(string)、`factors`(object)
- 精简人设摘要注入 prompt（角色名、性格关键词、擅长话题、说话风格，几句话）
- 枚举具体判断因子：mention（直接提及）、topic_relevance（话题相关性）、silence_awkwardness（沉默尴尬度）等
- confidence 仅作为日志记录用途，不参与实际回复决策逻辑

### 调试体验
- 插件配置项 `debugLevel` 单一总开关控制所有 agent.* 日志
- 数字等级 0-3：0=关闭, 1=基础(traceId+决策结果), 2=详细(+breakdown+latency+tokens), 3=全量(+prompt sizes+raw output)
- 每条消息处理完后输出一行汇总摘要：traceId + 决策结果 + 耗时 + token 用量 + 工具调用数

### Claude's Discretion
- traceId context 对象的具体字段设计
- 各命名空间各自输出哪些具体 key=value 字段
- debugLevel 各等级的精确输出内容边界
- Judge prompt 中人设摘要的具体措辞和长度

</decisions>

<specifics>
## Specific Ideas

- 日志前缀风格参考示例：`[msg-a3f8b2c1] agent.willingness score=0.82 breakdown={mention:0.3, topic:0.5, decay:0.02}`
- 汇总摘要参考：`[msg-a3f8b2c1] decision=RESPOND latency=1.2s tokens=1650 tools=2`
- Judge JSON 输出参考：`{"decision": true, "confidence": 0.85, "reasoning": "...", "factors": {"mention": 0.3, "topic_relevance": 0.4, "silence_awkwardness": 0.15}}`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 24-observability*
*Context gathered: 2026-02-25*
