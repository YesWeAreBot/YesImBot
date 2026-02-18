# Phase 6: Willingness & Polish - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Add intelligent reply decision-making (willingness system) and production-ready error handling to the agent. The agent currently responds to all percepts that pass channel filtering — this phase makes it decide WHEN to participate and ensures stability under failure conditions. Memory systems, knowledge graphs, and schedule-based behavior are out of scope.

</domain>

<decisions>
## Implementation Decisions

### 回复决策架构

- 统一评分系统：所有触发类型（@mention、reply、keyword、random）走同一套评分流程
- 双层架构：规则初筛 + LLM 精判
- 规则层：多因子轻量评分（触发类型权重 + 冷却衰减 + 消息长度/频率等简单信号），类似 v3 但精简
- 双阈值衔接：规则层输出 0-1 分数，低于下限直接拒绝，高于上限直接通过，中间模糊地带交给 LLM 判断

### LLM 意愿判断

- 可配置模型：默认用轻量模型（如 deepseek-chat），允许用户指定意愿判断专用模型
- 仅模糊地带调用：规则层明确拒绝/通过的不走 LLM，只有模糊地带才调用，控制成本
- 二值输出：LLM 输出 yes/no，不需要分数或理由
- 上下文：触发消息 + 话题摘要（非完整历史），平衡信息量和 token 消耗

### 自然感表现

- 硬冷却 + 软衰减：硬冷却防止连续回复，软衰减控制整体频率
- 冷却双条件：消息条数 + 时间，取较长者（适应不同活跃度的群聊）
- 确定性触发穿透冷却：@mention 和 reply 无视冷却直接回复（为未来日程系统预留接口）
- 回复延迟：长度相关延迟 + 考虑推理耗时的动态调整，保持对话节奏自然
- 消息拆分：LLM 通过多次 send_message 工具调用自主决定拆分，多条消息间加延迟模拟打字间隔

### 错误处理策略

- 用户侧静默失败：API 调用失败时不向用户发送错误消息
- 重试 + fallback：利用 ModelService 已有的 fallback chain，自动重试后尝试备用模型
- 工具失败 LLM 自主处理：工具执行错误信息传回 LLM，由其决定重试或换方式
- 日志 + 可选频道上报：默认用 Koishi logger 记录，配置了上报频道 ID 则同时发送错误摘要

### Claude's Discretion

- 规则层具体因子权重和阈值数值
- LLM 意愿判断的 prompt 设计
- 回复延迟的具体算法和参数
- 消息间延迟的具体时间范围
- 错误重试的退避策略和次数

</decisions>

<specifics>
## Specific Ideas

- v3 的意愿系统核心问题：公式+随机数模拟的"兴趣"与实际内容脱节，"模拟了兴趣但兴趣没有和真正内容挂钩"
- v2 曾用 LLM 输出 nextReplyIn 控制冷却条数，v3 用加权求和+概率相乘+自然衰减
- 用户引用的社区讨论核心观点：@就回复是 assistant 思路，真正的生命体应该模拟网友的全部在线行为（有在线/离线时段、主动浏览聊天记录、基于兴趣参与）
- 现阶段先实现基础意愿系统，为未来日程系统和主动行为预留扩展点

</specifics>

<deferred>
## Deferred Ideas

- 日记系统 + 自我反思能力：LLM 输出关键词和相关概念，构建知识图谱作为长期记忆引擎
- 日程系统：配置不同时间段/状态下的响应规则，模拟真实在线/离线行为
- 主动浏览行为：agent 主动翻阅聊天记录，找感兴趣的话题参与
- 兴趣与内容挂钩：基于知识库的真正兴趣匹配，而非随机数模拟

</deferred>

---

_Phase: 06-willingness-polish_
_Context gathered: 2026-02-19_
