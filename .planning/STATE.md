---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Multimodal & Rich Interaction
status: unknown
last_updated: "2026-02-27T17:37:31.817Z"
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 10
  completed_plans: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。
**Current focus:** v2.5 — Phase 37 complete, ready for Phase 38

## Current Position

Phase: 40 (in progress)
Plan: 04 complete (4/4 plans)
Status: Phase 40 Plan 02 complete — render pipeline unification
Last activity: 2026-02-28 — unified XML render pipeline, removed working-memory block, eliminated wmLines, XML formatToolResults

Progress: v1.0 ✅ | v2.0 ✅ | v2.1 ✅ | v2.2 ✅ | v2.3 ✅ | v2.4 ✅ | v2.5 ◆

```
Phase 33 [==========] 100% (2/2 plans)
Phase 34 [==========] 100% (2/2 plans)
Phase 35 [==========] 100% (2/2 plans)
Phase 36 [==========] 100% (2/2 plans)
Phase 37 [==========] 100% (2/2 plans)
Phase 38 [          ] 0%
Phase 39 [          ] 0%
Phase 40 [==========] 100% (4/4 plans)
```

## Performance Metrics

**Velocity:**

- v1.0: 15 phases, 29 plans, ~4 days
- v2.0: 8 phases, 16 plans, ~6 days
- v2.1: 3 phases, 6 plans, ~2 days
- v2.2: 3 phases, 8 plans, ~2 days
- v2.3: 3 phases, 6 plans, ~1 day
- v2.4: 4 phases, 8 plans, ~2 days

**By Phase:** See MILESTONES.md for breakdown.

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.
v2.0–v2.4 decisions archived to milestones/ and PROJECT.md.

- [Phase 40-01]: AgentResponseData.assistantText renamed to rawText; old field kept optional for backward compat with existing DB rows
- [Phase 40-01]: toObservations() expands old agent.response rows with actions into both AgentResponseObservation and AgentActionObservation — seamless migration without DB backfill
- [Phase 40-01]: Bot messages recorded with Random.id() as synthetic messageId; content split on <sep/> before recording

- [Phase 40-02]: agent.response observations with no error return empty string from formatObservation — actions already rendered via AgentActionObservation
- [Phase 40-02]: esc() helper defined inline in formatObservation — escapes &, ", <, > in dynamic XML attribute values
- [Phase 40-02]: formatToolResults switched to XML <tool-result name status> tags — consistent with unified XML prompt format
- [Phase 40-02]: wmLines block removed from loop.ts entirely — working memory flows through AgentAction observations in history

- [Phase 40-03]: trimObservations is immutable (returns new array); trimMessages keeps mutation pattern for round-level messages
- [Phase 40-03]: hardClearToolResult tries XML format first, falls back to legacy JSON format for in-flight messages
- [Phase 40-03]: messages cast to ModelMessage[] for CallParams — all actual values are strings, cast is structurally safe
- [Phase 40-03]: ObservationTrimConfig.keepLastCount derived from keepLastRounds \* 2 + 1 in loop.ts

- [Phase 40-04]: EnvironmentManager takes cacheTtl in constructor — avoids coupling to HorizonServiceConfig shape
- [Phase 40-04]: JsonDB import removed from service.ts — only EnvironmentManager owns the DB instance now

- [Phase 37]: Entities passed as-is from view.entities into toolCtxWithPercept — index signature on ToolExecutionContext already supports arbitrary keys
- [Phase 37]: All three QManager tools use requireBotRole('admin'), NOT requirePlatform('onebot') — standard Koishi Bot API is cross-platform
- [Phase 37]: Safety intercept blocks bot self and admin/owner targets before any destructive platform API call

### v2.5 Key Design Decisions

- **Prompt injection fix is Phase 33 priority** — `formatObservation()` embeds user content in XML tags without escaping; must land before any rich content flows through the pipeline
- **Image eager download** — CDN URLs expire in 5-30 min; base64 conversion happens at receive time in EventListener, not at LLM call time
- **Hidden tool contract** — all builtins except `send_message` get `hidden: true` in Phase 35; Interactions/QManager plugins depend on this
- **Plugin pattern** — Interactions and QManager follow the `persona` plugin pattern exactly (declare module, ctx.on dispose hook)
- **ElementFormatterService uses handler map pattern** — Map<string, ElementHandler> with register() for extensibility, <unsupported> fallback for unknown types
- **<unverified> threshold = 200 chars** — text-only length; more permissive than dev version's 100 to reduce false positives
- **Pipeline fix strategy** — format at receive time in EventListener, store safe content in timeline, no escaping at render time in formatObservation()
- **Search tool uses ctx.http** — no Tavily SDK; configurable endpoint, thin wrapper
- **Bot role cache uses silent degradation** — getGuildMember failure caches null for TTL to avoid repeated failed API calls
- **classifyRole two-tier system** — owner/admin/administrator/moderator mapped to "owner" | "admin"; regular members get no role attribute
- **Reverse short-ID map synced eviction** — forward and reverse maps evicted in lockstep to prevent stale lookups
- **Search tool conditional registration** — SearchPlugin only registered when searchApiKey is provided; no tool exists if unconfigured
- **Entity ID uses session.userId** — stable platform account ID instead of session.author.id; nickname omitted when identical to username to reduce token noise

### Pending Todos

- REQ-04 模型组与负载均衡 — v2.4 推迟，继续推迟到 v2.6+
- Phase 38 (Multimodal) needs research-phase before implementation — GIF library choice (jimp vs sharp), per-provider image format constraints

### Roadmap Evolution

- v2.5 roadmap: 7 phases (33-39), 28 requirements
- Phase ordering: 33 → 34 → 35 → 36+37 (parallel) → 38 → 39
- Phase 38 has research flag (GIF processing library decision)
- Phase 40 added: 数据结构和渲染格式优化

### Blockers/Concerns

- Phase 38: GIF first-frame extraction library not yet decided (jimp vs sharp vs canvas vs reject-GIFs)

### Quick Tasks Completed

| #            | Description                                                                     | Date       | Commit  | Status   | Directory                                                                                         |
| ------------ | ------------------------------------------------------------------------------- | ---------- | ------- | -------- | ------------------------------------------------------------------------------------------------- |
| 1            | 优化类型定义和接口：统一Percept类型，简化buildView参数                          | 2026-02-21 | 3977997 |          | [1-percept-buildview](./quick/1-percept-buildview/)                                               |
| 2            | 使用gray-matter替换js-yaml和自定义解析实现。与memory_block模块和skill模块集成。 | 2026-02-23 | bc8184a | Verified | [2-gray-matter-js-yaml-memory-block-skill](./quick/2-gray-matter-js-yaml-memory-block-skill/)     |
| 3            | Fix agent JSON output drift: unify format spec, improve raw-text fallback       | 2026-02-23 | b030d54 | Verified | [3-fix-unexpected-agent-outputs-agent-stops](./quick/3-fix-unexpected-agent-outputs-agent-stops/) |
| Phase 37 P01 | 1min                                                                            | 2 tasks    | 2 files |

### v2.5 Execution Metrics

| Phase | Plan | Duration | Tasks | Files |
| ----- | ---- | -------- | ----- | ----- |
| 33    | 01   | 3min     | 2     | 4     |
| 33    | 02   | 2min     | 2     | 2     |
| 34    | 01   | 2min     | 2     | 3     |
| 34    | 02   | 3min     | 2     | 2     |
| 35    | 01   | 3min     | 2     | 5     |
| 35    | 02   | 4min     | 2     | 9     |
| 36    | 01   | 2min     | 2     | 6     |
| 36    | 02   | 3min     | 2     | 1     |
| 37    | 01   | 1min     | 2     | 2     |
| 37    | 02   | 3min     | 2     | 1     |

| 40 | 01 | 5min | 2 | 4 |
| 40 | 02 | 3min | 2 | 4 |
| 40 | 03 | 5min | 2 | 2 |
| 40 | 04 | 4min | 1 | 2 |

## Session Continuity

Last session: 2026-02-28
Stopped at: Phase 40 Plan 03 complete
Resume file: .planning/phases/40-data-structure-render-optimization/40-03-SUMMARY.md
Next action: Phase 40 complete (all 4 plans done)
