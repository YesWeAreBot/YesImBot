# Phase 3: Durable Recovery and Replay - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

让 session 把每个关键运行时事件持久化下来，并能在失败或重启后被 inspect、abort、resume、replay。此阶段只澄清 durability / recovery / replay / observability 的行为边界，不扩展新的业务能力，不改写前两阶段已经锁定的 turn、tool、direct output 语义。

</domain>

<decisions>
## Implementation Decisions

### 事件落盘粒度

- Durable log 以稳定里程碑为主，不把所有流式增量都当成必须持久化的恢复事实。
- Assistant 文本以“用户最终所见”为准落盘，记录最终实际发送的文本段与段序，而不是只保留模型原始流式片段。
- 关键控制事件必须落盘，包括 turn/session/tool 级控制节点，以及 abort、resume、turn boundary、queue/backlog 观察这类恢复与排障需要的事件。
- 持久化事件必须采用分层标识，至少稳定保留 `sessionId`、`turnId`、`toolCallId`、`correlationId` / `causeId` 一类链路字段。

### 中断与恢复语义

- 运行时来源的中断都应形成可恢复状态，包括 timeout、显式 abort、以及进程重启或崩溃后的恢复场景。
- 恢复触发按中断来源区分：重启恢复可以在 session 重新装载时自动接续；timeout 和手动 abort 更适合等下一次事件或明确恢复指令再续跑。
- 中断前已经提交的事实不回滚：已发出的文本、已成功执行的工具效果、已写入的事件都视为历史真相，恢复只从未完成部分继续。
- 如果中断后 backlog 已有新的用户输入，恢复必须允许新输入改写后续方向，而不是机械地先把旧 turn 完整跑完。

### 快照与摘要节奏

- 结构化 snapshot 是主恢复锚点；summary 主要服务长会话压缩、阅读和上下文提炼，不承担唯一恢复真相。
- Snapshot / summary 采用混合触发策略：结合事件数量、空闲时机、以及明确运维触发，而不是只靠单一固定周期。
- Summary 只总结语义内容，不替代 tool/control/recovery 的精确事实来源；这些必须仍由事件与 snapshot 承担。
- 长会话默认从最新 snapshot 加后续事件增量恢复；完整 replay 主要用于测试、审计和疑难排障。

### 回放与排障视图

- Replay 默认按 turn/tool 叙事展开，先给人读的时间线，再允许下钻到原始 durable events。
- 开发复现与运营 inspect 共享同一份持久化事实源，只做双视图呈现，不维护两套真相。
- 默认排障输出应直接可见关键链路 ID，包括 `sessionId`、`turnId`、`toolCallId`、`correlationId` / `causeId`，以及 abort / resume 原因。
- Replay 以当时持久化的 tool/model 结果为准，不在默认复现流程里重新调用外部副作用或实时模型请求。

### Claude's Discretion

- 具体 JSONL envelope 字段名、版本字段名、以及 typed event 的最终命名。
- snapshot / summary 的精确阈值、批处理策略、以及人工触发入口形态。
- replay / inspect 的具体命令、测试 harness 形式、以及 raw-event drill-down 的展示格式。
- 哪些流式细节进入可选 debug trace 层，而不进入主 durable recovery log。

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and locked requirements

- `.planning/PROJECT.md` — vNext 的全局硬约束：greenfield `vnext/`、session-first runtime、append-only persistence、listener 只做 ingress。
- `.planning/REQUIREMENTS.md` — Phase 3 对应的 `TURN-02`、`TURN-03`、`PERS-01` ~ `PERS-05`、`OPER-01`、`OPER-02`。
- `.planning/ROADMAP.md` — Phase 3 的固定目标与 success criteria，定义本阶段只做 durable recovery / replay hardening。
- `.planning/STATE.md` — 当前阶段顺序说明：先完成 Phase 2 的原生 turn loop，再进入 Phase 3 durability hardening。
- `.planning/phases/01-session-runtime-boundaries/01-CONTEXT.md` — 继承 Phase 1 边界：listener ingress-only、session 自持 mailbox/busy/lifecycle、turn_end 后观察 backlog。
- `.planning/phases/02-native-turn-and-tool-execution/02-CONTEXT.md` — 继承 Phase 2 边界：direct visible output、terminal tool、tool failure、model fallback 的锁定语义。
- `vnext/AGENTS.md`

### Runtime direction and recovery posture

- `docs/ideas/01-session-centric-runtime.md` — append-only session event 流、abort / continue / resume 思路、summary/snapshot 的方向约束。
- `docs/ideas/02-session-centric-runtime-greenfield-plan.md` — vNext 目录分层建议，history/store/summary/archive 边界，以及“runtime 管中断恢复、history 管持久化查询”的纪律。
- `docs/ideas/03-session-centric-runtime-tech-stack-selection.md` — `pi-agent` / `pi-ai` 作为底座的原因，以及其与 interrupt/resume/event-stream 的契合点。

### Library behavior references

- `references/pi-agent.md` — `agent_start` / `turn_start` / `tool_execution_*` / `turn_end` / `agent_end` 事件流，`abort()`、`continue()`、`waitForIdle()`、steering/follow-up 语义。

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `vnext/src/mailbox/session-actor.ts` — 已有 `turn_end` 观察点和 backlog flush 行为，是 Phase 3 挂接 control events、abort/resume 观察、恢复入口的直接基础。
- `vnext/src/types/runtime.ts` — 已定义 `InboundEvent` / `SessionSnapshot` 的最小运行时对象，可向 typed durable event 和恢复 snapshot 演进。
- `vnext/src/session/contracts.ts` — 当前 session manager contract 还很薄，适合作为持久化会话状态与 recovery API 的扩展点。
- `core/src/services/horizon/compressor.ts` — 提供 count/inactivity 混合触发压缩经验，可迁移思路到 snapshot / summary 节奏，但不应直接复用旧 Horizon 骨架。
- `core/src/services/hook/service.ts` — 已有 hook trace、事件发射、超时记录经验，可借鉴 traceability 和 inspect 字段设计。

### Established Patterns

- `vnext/` 目前只有 session identity、mailbox、Koishi ingress 边界，说明 durability/replay 仍是绿地区域，不存在必须兼容的旧实现。
- Phase 1 已锁 listener 不做 orchestration，Phase 3 也不能把 recovery/replay 逻辑塞回 ingress 侧。
- Phase 2 已锁 direct output 与 terminal tool 语义，因此 durable events 必须能表达“用户最终所见文本”和“已提交副作用”，不能回退到旧 `send_message` / action loop 模型。
- `references/pi-agent.md` 的事件流天然适合映射成 typed persisted events，尤其是 turn/tool 边界和 abort/continue 控制点。

### Integration Points

- 新的 event store、snapshot、replay、inspect 能力应继续落在 `vnext/` 子系统，而不是回接到 `core/src/services/agent/`。
- Session manager / actor 需要从纯内存状态提升为“内存运行态 + durable history / snapshot”的组合恢复入口。
- Replay 测试需要消费同一份 durable events，而不是重新依赖 live model/tool 执行路径。
- Observability 字段需要贯穿 Koishi ingress、session runtime、tool execution 与 recovery/replay 工具链。

</code_context>

<specifics>
## Specific Ideas

- assistant 文本应以“用户最终所见”为准，而不是以模型流式增量为准。
- 恢复必须尊重新鲜用户输入；旧 turn 的未完成计划可以被新输入改写。
- replay 默认先给人读的 turn/tool 时间线，再允许查看 raw events。
- 开发复现与运营 inspect 应共享同一份 durable facts，只做不同视图。

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 03-durable-recovery-and-replay_
_Context gathered: 2026-03-20_
