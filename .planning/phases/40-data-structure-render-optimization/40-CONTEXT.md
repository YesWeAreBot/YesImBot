# Phase 40: 数据结构和渲染格式优化 - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

重构 timeline 数据结构（AgentResponseRecord 拆分、bot 消息记录）、统一渲染格式（XML 标签）、合并 working memory 与 history 为统一时间线、语义化 trimmer（操作 Observation 数组）、Entity 表规范化。为 Phase 38（多模态）和 Phase 39（富文本输出）打好数据层和渲染层基础。

</domain>

<decisions>
## Implementation Decisions

### AgentResponseRecord 拆分

- 当前 AgentResponseRecord 拆为两个独立的 TimelineEventType：
  - `AgentResponse` — LLM 原始响应记录（含 rawText 或 error，记录网络错误等失败情况）
  - `AgentAction` — 响应成功后执行的 Action 数组（含 params 和执行结果）
- 两者通过 round 字段关联

### Bot 消息记录

- bot 通过 send_message 发送的消息也作为 MessageRecord 记录到 timeline（sender 标记为 bot）
- 这样 bot 发言和用户发言使用相同的 `<msg>` 渲染逻辑，格式完全一致

### 统一时间线

- 合并 working memory 和 history 为统一时间线，延续 v3 做法
- history 按时间顺序包含 Message、AgentAction、AgentResponse（错误）等所有条目
- 移除 horizon-view.mustache 中单独的 `<working-memory>` 区块
- formatObservation() 统一处理所有条目类型，loop.ts 不再手动拼接 wmLines

### 渲染格式统一

- 所有 timeline 条目统一用 XML 标签渲染：
  - 用户/bot 消息：`<msg id="3" sender="Alice" time="14:30">content</msg>`
  - Agent action：`<bot-action round="1" trigger="#3">search({q:"test"}) -> ok</bot-action>`
- 用户消息增加 `time` 属性（HH:MM 格式），解决当前缺少时间戳标记的问题
- agent.response 不再用 `[HH:MM] [Bot]:` 纯文本格式

### Tool Results 序列化

- tool results 从 JSON.stringify 改为 XML 格式：`<tool-results><tool-result name="search" status="ok">...</tool-result></tool-results>`
- send_message 的 result 精简渲染（省略 content param，只显示 `sent`），保持 OPT-04 优化

### 消息内容类型

- LoopMessage.content 变为 `string | UserContent`（复用 ai-sdk 类型），支持多模态
- MessageEventData.content 保持 `string`（存储层不变）
- ElementFormatterService 负责序列化/反序列化，以及资源持久化（图片存文件系统，formatter 输出纯文本描述）
- 图片数据不存数据库

### Trimmer 语义化

- trimmer 操作对象从渲染后的 string 改为渲染前的 Observation 数组
- 新增 image strip 层级：超预算时先移除 image parts，再 softTrim，再 hardClear
- 渲染在裁剪之后发生（先裁剪 Observation[]，再 formatObservation）
- 裁剪按整条 observation 移除，不切割单条内容

### Entity 表规范化

- 单表 + type 字段区分 user/member，不拆双表
- Environment 保持 JsonDB 文件存储，但从 Entity 管理逻辑中解耦，独立管理

### Claude's Discretion

- AgentResponse/AgentAction 的具体字段设计细节
- trimmer 的预算分配策略（charBudget 是否需要调整）
- formatObservation 中 bot-action 的具体内容格式
- Entity 表解耦的具体实现方式

</decisions>

<specifics>
## Specific Ideas

- 延续 v3 的统一时间线做法——history 接收 agent action、user message 和 system event 数据条目，使用统一的渲染管线和裁剪逻辑
- bot 发言记录为 MessageRecord 后，formatObservation 中 bot 和用户消息走完全相同的 `<msg>` 渲染路径，通过 sender 属性区分
- trimmer 在渲染前操作原始数据结构，避免切割 XML 标签导致 LLM 解析混乱

</specifics>

<code_context>

## Existing Code Insights

### Reusable Assets

- `ElementFormatterService` (`core/src/services/horizon/listener.ts`): 已有 handler map 模式，可扩展序列化/反序列化和资源持久化功能
- `MustacheRenderer` (`core/src/services/prompt/renderer.ts`): 模板渲染引擎，horizon-view.mustache 需要更新
- `JsonParser` (`core/src/services/agent/json-parser.ts`): agent response 解析器，拆分后仍可复用

### Established Patterns

- Timeline 使用 `BaseTimelineEntry<Type, Data>` 泛型模式，新增 AgentAction 类型遵循同一模式
- `EventManager` 负责 timeline CRUD，新增条目类型需要扩展 query/record 方法
- `formatObservation()` 使用 type 判断分支渲染，新增类型需要新分支

### Integration Points

- `ThinkActLoop.run()` — 主消费者，需要适配统一时间线和新 trimmer 接口
- `horizon-view.mustache` — 模板需要移除 working-memory 区块
- `EventManager.recordAgentResponse()` — 需要拆分为 recordAgentResponse + recordAgentAction
- `PromptService.render()` — Section[] 输出不变，但 scope 中的 history 数据结构变化

</code_context>

<deferred>
## Deferred Ideas

- History 缓存分块（前部基本不变，可标记 cacheable）— 需要 provider 层配合，复杂度较高，单独 phase
- System event 条目类型（guild-member-added 等）— v2.6

</deferred>

---

_Phase: 40-data-structure-render-optimization_
_Context gathered: 2026-02-28_
