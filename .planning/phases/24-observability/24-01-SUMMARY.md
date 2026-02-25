---
phase: 24-observability
plan: 01
subsystem: observability
tags: [tracing, logging, debug, koishi]

requires:
  - phase: 23-agent-loop
    provides: AgentCore service, ThinkActLoop, willingness system
provides:
  - traceId field on Percept for end-to-end message tracing
  - 5 namespace loggers in AgentCore (willingness, loop, model, parser, tool)
  - 4 namespace loggers in ThinkActLoop (loop, model, parser, tool)
  - debugLevel config (0-3) gating structured debug output
  - Per-message summary line with traceId, decision, latency, tokens, tools
affects: [24-02, observability, debugging]

tech-stack:
  added: []
  patterns: [namespace-logger, debugLevel-gating, traceId-threading]

key-files:
  created: []
  modified:
    - core/src/services/shared/types.ts
    - core/src/services/agent/service.ts
    - core/src/services/agent/loop.ts

key-decisions:
  - "Used nanoid(8) with msg- prefix for traceId generation"
  - "debugLevel 0=off (default), 2=detailed, 3=full — matches common verbosity conventions"
  - "Computed totalTokens as inputTokens+outputTokens since LanguageModelUsage lacks totalTokens property"

patterns-established:
  - "Namespace logger pattern: ctx.logger('agent.willingness') for KOISHI_DEBUG filtering"
  - "debugLevel gating: all structured debug logs gated by (this.config.debugLevel ?? 0) >= N"
  - "traceId threading: generated once in handleEvent, passed through Percept to all subsystems"

requirements-completed: [OBS-01, OBS-02, OBS-03]

duration: 12min
completed: 2026-02-25
---

# Plan 24-01: TraceId + Structured Debug Logging Summary

**End-to-end traceId threading through message pipeline with debugLevel-gated namespace loggers for willingness, model, parser, and tool stages**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-02-25
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Percept.traceId field with `msg-XXXXXXXX` format for per-message tracing
- 9 namespace loggers total (5 in AgentCore, 4 in ThinkActLoop) enabling KOISHI_DEBUG filtering
- debugLevel config (0-3) in AgentCoreConfigSchema gating all structured debug output
- Per-round model latency/tokens, parser outcome, tool results at debugLevel>=2
- Prompt sizes and raw callParams at debugLevel>=3
- Single summary line per message at info level: traceId + decision + latency + tokens + tools

## Task Commits

1. **Task 1: Add traceId to Percept, namespace loggers, debugLevel config** - `482c782` (feat)
2. **Task 2: Instrument ThinkActLoop with per-round structured debug logs** - `6502ca2` (feat)

## Files Created/Modified
- `core/src/services/shared/types.ts` - Added traceId: string to Percept interface
- `core/src/services/agent/service.ts` - TraceId generation, 5 namespace loggers, debugLevel config, summary line
- `core/src/services/agent/loop.ts` - 4 namespace loggers, per-round model/parser/tool debug logs, stats return

## Decisions Made
- Used nanoid(8) with `msg-` prefix for compact but unique traceIds
- Computed totalTokens manually (inputTokens + outputTokens) since ai SDK's LanguageModelUsage lacks a totalTokens property
- Kept existing info-level round counter log but added traceId prefix

## Deviations from Plan

### Auto-fixed Issues

**1. [Type Fix] LanguageModelUsage property names**
- **Found during:** Task 2 (ThinkActLoop instrumentation)
- **Issue:** Plan used `promptTokens`/`completionTokens`/`totalTokens` but ai SDK uses `inputTokens`/`outputTokens` with no `totalTokens`
- **Fix:** Changed to correct property names, computed total manually
- **Files modified:** core/src/services/agent/loop.ts
- **Verification:** yarn typecheck passes
- **Committed in:** `6502ca2`

---

**Total deviations:** 1 auto-fixed (type mismatch)
**Impact on plan:** Necessary for correctness. No scope creep.

## Issues Encountered
None beyond the type property name mismatch.

## Next Phase Readiness
- traceId and namespace loggers ready for plan 24-02 to add persona-aware judgment logging
- debugLevel gating infrastructure in place for future debug instrumentation

---
*Phase: 24-observability*
*Completed: 2026-02-25*
