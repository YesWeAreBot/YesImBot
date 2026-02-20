# Phase 3: Horizon Context System - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

为 AgentCore 提供框架无关的上下文抽象。包括 Environment/Entity/Event 实体建模、Timeline 持久化存储、Horizon 视图生成（简单格式化）、Percept 触发语义。不包含复杂的 Observation 转换层、chat-mode 选择逻辑、意愿判断。

</domain>

<decisions>
## Implementation Decisions

### 架构方向

- 不做复杂的 Observation 转换层，v4 先用简单的消息历史拼接
- Environment/Entity/Event 不是对 Koishi session 的重复抽象，而是 session 的"富化缓存"——持久化存储 Koishi 不直接保存的信息（群名、公告、用户昵称、头衔等）
- Prompt 构建采用混合方案：Horizon 视图（聚合群聊上下文）+ 标准多轮格式（工具调用）

### 实体建模

- Environment = channel（1:1 映射），一个群聊/私聊 = 一个 Environment，保持频道隔离
- Entity = 用户，承载跨频道连续性（同一用户在不同 Environment 中是同一个 Entity）
- Entity 默认按平台隔离（platform + userId），支持手动关联不同平台账号
- Event 类型 v4 只覆盖：消息（message）和 Bot 自身消息（含工具调用摘要）

### Timeline 存储策略

- 使用 Koishi 数据库服务持久化存储 Timeline
- 检索方式：时间窗口 + 数量上限，兼顾对话节奏和 token 控制
- Environment 和 Entity 元数据也持久化存储到数据库
- 元数据更新策略：定期批量刷新，减少 API 调用

### 消息流与 Prompt 构建

- 一次触发 = 一次完整 think-act 循环，期间不注入新消息
- 必要时（响应过慢、积累太多消息、用户明确 @）可插入 [system] 更新
- Agent 响应过程（思考、工具调用、结果、最终回复）压缩为单个摘要 Event 存入 Timeline
- 第二轮触发时，Horizon 视图更新，包含上一轮 agent 行为摘要，保持连贯性

### Observation 生成（Horizon 视图）

- v4 先用聊天记录式逐条列出（带时间戳和发送者），后续迭代加摘要压缩
- Horizon 视图包含四部分：Environment 信息、Entity 信息、消息历史、触发上下文
- Phase 3 只提供触发上下文数据，chat-mode 选择逻辑留给 Phase 4/5

### Percept 触发语义

- v4 支持四种触发类型：@提及/回复、关键词匹配、随机触发、私聊消息
- Percept 只提供数据，不做"是否应该回复"的判断（留给 Phase 6 意愿系统）
- Percept 携带：触发类型、触发消息引用、Environment/Entity 引用
- 群聊消息聚合后触发（防止连续消息导致 bot 刷屏）

### Claude's Discretion

- Timeline 数据库表结构设计
- Environment/Entity 元数据的具体字段
- 消息聚合的时间窗口和策略
- Horizon 视图的具体文本格式
- 元数据批量刷新的周期

</decisions>

<specifics>
## Specific Ideas

- Environment/Entity/Event 是 Koishi channel/user/message 的"展开视图"——agent 直接看 session.channelId 不理解含义，Environment 包含群名、公告、背景等具体信息
- v3/dev 的 Horizon 视图方案（只有 system + user 两条消息）导致 agentic 能力降低且无法利用提示缓存，v4 改为混合方案
- Agent 响应存入 Timeline 解决了跨轮次的工具调用关联性和时间流动性问题
- chat-mode 概念（根据触发原因选择不同聊天模式和提示词）是好的架构方向，Phase 3 提供数据基础，Phase 4/5 实现选择逻辑

</specifics>

<deferred>
## Deferred Ideas

- chat-mode 选择逻辑 — Phase 4（PromptService）
- 意愿判断系统 — Phase 6
- 成员变更事件、群信息变更事件 — 未来版本
- 跨平台账号自动关联 — 未来版本
- Observation 摘要压缩（分组摘要式） — 未来迭代
- 多 agent 协同（chat-mode 演化为独立 agent） — 未来版本
- 记忆系统 / 用户画像 — 未来版本

</deferred>

---

_Phase: 03-horizon-context-system_
_Context gathered: 2026-02-18_
