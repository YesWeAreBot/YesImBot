---
phase: 15-llm-deferred-judgment-config
plan: 02
subsystem: agent
tags: [deferred-judgment, willingness, llm-judge, timer, model-service]

requires:
  - phase: 15-llm-deferred-judgment-config
    provides: DeferredJudgmentConfig type and per-module fallbackChain in WillingnessConfig
provides:
  - AgentCore with deferred LLM judgment — borderline SKIPs get delayed second-opinion via ModelService
affects: [willingness-system, agent-loop]

tech-stack:
  added: []
  patterns: [deferred-timer-map, inverse-proportional-delay, binary-llm-judgment]

key-files:
  created: []
  modified:
    - plugins/core/src/services/agent/service.ts

key-decisions:
  - "ctx.setTimeout for deferred timers — auto-cancelled on Koishi dispose"
  - "LLM judgment failure defaults to SKIP (no reply) — safe fallback"
  - "Judgment model resolution chain: deferred.judgmentModel > willingness.judgmentModel > config.model"

patterns-established:
  - "Deferred timer map: Map<channelKey, cancelFn> for per-channel pending judgment tracking"
  - "Inverse-proportional delay: higher probability = shorter wait before LLM judgment"

requirements-completed: [AGENT-02]

duration: 1min
completed: 2026-02-21
---

# Phase 15 Plan 02: Deferred LLM Judgment Summary

**Deferred LLM judgment in AgentCore — borderline SKIP decisions get delayed yes/no second opinion via ModelService.call with inverse-proportional delay**

## Performance

- **Duration:** 89s (~1.5 min)
- **Started:** 2026-02-20T17:00:10Z
- **Completed:** 2026-02-20T17:01:39Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- deferredTimers map tracks pending judgments per channel
- New messages cancel pending deferred timers before willingness processing
- Borderline SKIP (probability >= threshold) schedules delayed LLM judgment
- Delay inversely proportional to probability (higher P = shorter delay via linear interpolation)
- LLM judgment uses ModelService.call with minimal binary yes/no prompt
- YES triggers full agent loop via enqueue; NO or error silently drops

## Task Commits

Each task was committed atomically:

1. **Task 1: Add deferred judgment to AgentCore** - `935dd29` (feat)

## Files Created/Modified
- `plugins/core/src/services/agent/service.ts` - Added JUDGMENT_PROMPT, deferredTimers map, cancelDeferred, scheduleDeferredJudgment, executeDeferredJudgment; modified gateAndEnqueue to cancel timers and schedule deferred on borderline SKIP

## Decisions Made
- ctx.setTimeout for deferred timers — auto-cancelled on Koishi dispose
- LLM judgment failure defaults to SKIP (no reply) — safe fallback per user decision
- Judgment model resolution chain: deferred.judgmentModel > willingness.judgmentModel > config.model

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Deferred LLM judgment is fully wired into AgentCore
- Phase 15 complete — both config refactor and implementation delivered

## Self-Check: PASSED

All 1 modified file verified present. Task commit (935dd29) verified in git log.

---
*Phase: 15-llm-deferred-judgment-config*
*Completed: 2026-02-21*
