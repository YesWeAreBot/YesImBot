---
phase: 15-llm-deferred-judgment-config
plan: 01
subsystem: agent
tags: [model-service, fallback-chain, deferred-judgment, willingness, config]

requires:
  - phase: 13-non-stream-path-fallback-wiring
    provides: ModelService with retry and fallback chain execution
provides:
  - ModelService with per-call fallbackChain parameter (no global model config)
  - AgentCoreConfig with fallbackChain array replacing single fallbackModel
  - DeferredJudgmentConfig type and WillingnessConfig with deferred/judgmentModel/fallbackChain
  - Root Config/Schema cleaned of global model fields
affects: [15-02-deferred-judgment-implementation, willingness-system]

tech-stack:
  added: []
  patterns: [per-module-fallback-chain, model-service-as-pure-execution-layer]

key-files:
  created: []
  modified:
    - plugins/core/src/services/model/service.ts
    - plugins/core/src/services/agent/config.ts
    - plugins/core/src/services/agent/willingness-config.ts
    - plugins/core/src/services/agent/loop.ts
    - plugins/core/src/index.ts

key-decisions:
  - "ModelService becomes pure execution layer — no global defaultModel or fallbackChains in its config"
  - "Per-module fallbackChain arrays replace single fallbackModel string"
  - "DeferredJudgmentConfig added to WillingnessConfig for Plan 02 foundation"

patterns-established:
  - "Per-call fallback chain: callers pass fallbackChain[] to ModelService instead of global config"
  - "Module-owned model selection: each module (agent, willingness) controls its own model and fallback policy"

requirements-completed: [AGENT-02]

duration: 3min
completed: 2026-02-21
---

# Phase 15 Plan 01: Config Refactor Summary

**Per-module fallbackChain arrays replacing global model config, with DeferredJudgmentConfig type for willingness system**

## Performance

- **Duration:** 169s (~3 min)
- **Started:** 2026-02-20T16:54:14Z
- **Completed:** 2026-02-20T16:57:03Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- ModelServiceConfig reduced to only `concurrency` — no global model selection
- call() and streamCall() accept per-call fallbackChain parameter
- AgentCoreConfig uses fallbackChain[] instead of single fallbackModel
- WillingnessConfig extended with DeferredJudgmentConfig, judgmentModel, and fallbackChain
- Root Config/Schema cleaned of defaultModel, fallbackChains, fallbackModel

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor ModelService to accept fallbackChain as parameter** - `69f80a5` (feat)
2. **Task 2: Update AgentCoreConfig, WillingnessConfig, loop.ts, and root Config/Schema** - `d64bf1f` (feat)

## Files Created/Modified
- `plugins/core/src/services/model/service.ts` - Removed global model config; added fallbackChain param to call/streamCall/handleFallback
- `plugins/core/src/services/agent/config.ts` - Replaced fallbackModel with fallbackChain[]
- `plugins/core/src/services/agent/willingness-config.ts` - Added DeferredJudgmentConfig interface and new schema fields
- `plugins/core/src/services/agent/loop.ts` - Passes fallbackChain to ModelService instead of fallbackModel
- `plugins/core/src/index.ts` - Cleaned root Config/Schema; passes only concurrency to ModelService

## Decisions Made
- ModelService becomes pure execution layer — no global defaultModel or fallbackChains in its config
- Per-module fallbackChain arrays replace single fallbackModel string
- DeferredJudgmentConfig added to WillingnessConfig as foundation for Plan 02

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DeferredJudgmentConfig type is ready for Plan 02 to implement deferred LLM judgment logic
- WillingnessConfig schema exposes deferred judgment settings in Koishi UI
- ModelService signature supports per-call fallback chains from any module

## Self-Check: PASSED

All 5 modified files verified present. Both task commits (69f80a5, d64bf1f) verified in git log.

---
*Phase: 15-llm-deferred-judgment-config*
*Completed: 2026-02-21*
