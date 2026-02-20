---
phase: 13-non-stream-path-fallback-wiring
plan: 01
subsystem: model
tags: [retry, fallback, error-classification, model-service]

requires:
  - phase: 02-model-service-provider
    provides: ModelService with PQueue, fallback chains, provider registry
  - phase: 09-dynamic-schema-linkage
    provides: parseModelId in shared-model, ModelSelector type
provides:
  - resolveModel helper eliminating duplicated model-string parsing
  - withRetry helper for transient error retry before fallback
  - per-call fallbackModel parameter on call() and streamCall()
  - 503 classified as TRANSIENT in classifyError
  - executeStreamCall extracted for shared stream logic
affects: [13-02, agent-loop, model-service-consumers]

tech-stack:
  added: []
  patterns: [retry-before-fallback, per-call-fallback-parameter, shared-resolve-helper]

key-files:
  created: []
  modified:
    - packages/shared-model/src/types/errors.ts
    - plugins/core/src/services/model/service.ts

key-decisions:
  - "1 retry before fallback (not 2) — sufficient for transient errors without excessive latency"
  - "executeStreamCall extracted as private method parallel to executeCall — enables shared use by streamCall and handleStreamFallback"

patterns-established:
  - "resolveModel: single parsing point for string|ModelSelector input"
  - "withRetry: generic retry wrapper checking classifyError category"
  - "Fallback chain order: primary (with retry) -> per-call fallback -> global chain -> throw"

requirements-completed: [MODEL-01, MODEL-04, MODEL-05]

duration: 2min
completed: 2026-02-20
---

# Phase 13 Plan 01: Retry-before-fallback & 503 Classification Summary

**ModelService hardened with withRetry wrapper (1 retry), 503 TRANSIENT classification, per-call fallbackModel parameter, and resolveModel helper eliminating duplicated parsing**

## Performance

- **Duration:** 107s (~2 min)
- **Started:** 2026-02-20T13:58:58Z
- **Completed:** 2026-02-20T14:00:45Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- classifyError now returns TRANSIENT for 503 status codes
- resolveModel helper eliminates 3x duplicated model-string parsing across call/streamCall/getModel
- withRetry generic helper retries once on transient/rate-limit errors before fallback
- call() and streamCall() accept optional fallbackModel parameter (primary -> retry -> per-call fallback -> global chain)
- executeStreamCall extracted as private method, shared by streamCall and handleStreamFallback
- Warn-level logs emitted on every fallback switch

## Task Commits

Each task was committed atomically:

1. **Task 1: Add 503 to classifyError and harden ModelService with retry + fallback parameter** - `06918c4` (feat)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `packages/shared-model/src/types/errors.ts` - Added 503 as TRANSIENT in classifyError
- `plugins/core/src/services/model/service.ts` - Added resolveModel, withRetry, executeStreamCall; updated call/streamCall/getModel signatures

## Decisions Made
- 1 retry (not 2) before fallback — balances reliability vs latency for transient errors
- executeStreamCall extracted as private method parallel to executeCall for DRY stream fallback handling

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ModelService now provides complete retry + fallback gateway for both stream and non-stream paths
- Ready for Plan 02 to rewire loop.ts to use modelService.call() instead of direct generateText

## Self-Check: PASSED

- [x] Commit 06918c4 exists
- [x] packages/shared-model/src/types/errors.ts exists
- [x] plugins/core/src/services/model/service.ts exists
- [x] .planning/phases/13-non-stream-path-fallback-wiring/13-01-SUMMARY.md exists

---
*Phase: 13-non-stream-path-fallback-wiring*
*Completed: 2026-02-20*
