# Phase 15: LLM Deferred Judgment & Model Config Refactor - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

为边界 SKIP 决策添加 LLM 延迟判断机制；重构模型配置，删除全局 defaultModel/fallbackModel，各模块内部配置主模型和 fallbackChain 数组，配合 Schema.dynamic 渲染。

</domain>

<decisions>
## Implementation Decisions

### 延迟判断触发条件
- 固定阈值触发：willingness 结果为 SKIP 但基础分数超过可配置阈值时触发延迟判断
- 反比延迟：willingness 越高延迟越短，线性映射到配置的时间范围
- 同会话消息取消：延迟期间同一会话/频道收到新消息时取消当前延迟计时器，新消息走自己的 willingness 流程（可能再次进入延迟判断）
- LLM 判断为 no 时直接终止，等待下一条消息触发新流程

### LLM 判断行为
- 输入：当前对话上下文 + willingness 分数，让 LLM 有充分信息判断
- 输出：二元 yes/no 判断，不需要返回理由
- 模型：单独配置 judgment 专用模型（轻量级即可）
- 失败处理：调用失败（超时、模型错误等）时默认保持 SKIP

### fallbackChain 配置体验
- 各模块独立配置：AgentCoreConfig 和 WillingnessConfig 各自配置主模型 + fallbackChain
- 删除全局字段：移除顶层 defaultModel / fallbackModel
- 空数组 = 无 fallback：fallbackChain 为空时主模型失败直接失败
- 直接删除旧字段：不做自动迁移，用户需重新配置
- 统一处理逻辑：未来所有模型配置均添加 fallbackChain，统一 fallback 处理

### 判断结果的回复行为
- 走正常心跳流程：LLM 判断 yes 后走完整 AgentCore 心跳循环，和普通回复一致
- 用原始触发时上下文：因为新消息会重置延迟状态，所以延迟判断触发时的上下文就是最新的
- 自然过渡风格：回复内容自然体现延迟感（如"刚才想了想"），不暴露内部机制
- 详细日志：记录触发原因、延迟时长、LLM 判断结果等调试信息

### Claude's Discretion
- 延迟时间的具体映射范围和算法
- judgment prompt 的具体设计
- 日志格式和级别
- fallbackChain Schema.dynamic 的具体实现方式

</decisions>

<specifics>
## Specific Ideas

- 延迟判断的核心场景：收到最后一条消息后 willingness 判定 SKIP，但话题可能没结束，用户可能在等待回应。LLM 辅助判断避免错过这种情况，增强用户体验和留存度
- 每条新消息都会重置延迟状态——终止上一条的前置延迟，重新计算意愿，重新判断是否需要 LLM 辅助判断
- 先用固定阈值实现，未来可迭代为更复杂的动态算法

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-llm-deferred-judgment-config*
*Context gathered: 2026-02-21*
