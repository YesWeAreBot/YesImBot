# Phase 8: Stream Support & Dead Code Cleanup - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Activate streaming response path in ThinkActLoop, wrap streamCall() in PQueue concurrency control, activate TimelineStage lifecycle transitions (markAsActive + auto-archive), and update REQUIREMENTS.md traceability table to accurately reflect implementation status. This is gap closure from v1 audit.

</domain>

<decisions>
## Implementation Decisions

### markAsActive 处置
- **不是死代码** — TimelineStage 是消息生命周期管理的核心机制
- 生命周期：New（未读/未处理）→ Active（已读/历史背景）→ Archived（排除出上下文）→ Deleted（软删除）
- **激活时机**：Agent 响应完成后，将本次处理的 New 消息标记为 Active
- **范围**：仅标记当前 scope（当前频道）的 New 消息，不跨频道
- **自动归档**：同时实现 Active → Archived 转换，响应后同步检查超出时间窗口的 Active 消息并归档
- 未来还有 Summarized 状态（上下文压缩），但 v4 暂不实现

### 需求追踪更新
- 全面核实所有 14 个需求的实际实现状态，不仅限于 Phase 8 相关的
- 保持三级状态：Complete / Partial / Pending
- 增加备注列，说明每个需求的实际实现情况（如 "streamMode config exists but unused"）

### Claude's Discretion
- 流式响应行为：streamText 输出如何传递给用户、流式中断/错误处理
- streamCall 并发控制：是否与普通请求共享队列、超时策略
- 归档时间窗口的具体阈值

</decisions>

<specifics>
## Specific Ideas

- TimelineStage 设计理念：越远的消息在上下文中权重逐渐降低，避免硬截断带来的上下文割裂
- markAsActive 不是清理死代码，而是激活已有设计的关键一环

</specifics>

<deferred>
## Deferred Ideas

- Summarized stage（上下文自动压缩）— 未来迭代
- 消息权重渐变机制的完整实现 — 依赖记忆系统

</deferred>

---

*Phase: 08-stream-support-dead-code-cleanup*
*Context gathered: 2026-02-19*
