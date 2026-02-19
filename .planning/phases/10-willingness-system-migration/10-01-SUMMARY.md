---
phase: 10-willingness-system-migration
plan: 01
subsystem: agent
tags: [willingness, decay, sigmoid, fatigue, koishi-schema]

requires: []
provides:
  - WillingnessEngine class with per-channel state, exponential decay, sigmoid gain, fatigue penalty
  - WillingnessConfig interface and WillingnessSchema for Koishi nested config groups
affects: [10-02, agent-core-integration]

tech-stack:
  added: []
  patterns:
    - Pure algorithmic willingness engine with no LLM dependency
    - Module-level pure helper functions for testability
    - Pre-compiled keyword regexes cached on engine instance

key-files:
  created:
    - plugins/core/src/services/agent/willingness-config.ts
    - plugins/core/src/services/agent/willingness.ts
  modified:
    - plugins/core/src/services/agent/service.ts
    - plugins/core/src/services/agent/index.ts

key-decisions:
  - "WillingnessEngine replaces WillingnessCalculator — pure algorithmic, no LLM judge"
  - "processMessage() is synchronous — returns { probability, shouldReply } immediately"
  - "service.ts uses hardcoded defaults for WillingnessEngine until full integration in 10-02"
  - "Keyword regexes pre-compiled in constructor, not per-message"

requirements-completed: [WILLING-01, WILLING-02, WILLING-03]

duration: 2min
completed: 2026-02-20
---

# Phase 10 Plan 01: Willingness System Migration Summary

**WillingnessEngine with exponential decay, four-tier heat detection, smooth sigmoid gain, sliding-window fatigue, and regex keyword matching — replacing LLM-judge WillingnessCalculator**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-19T19:37:46Z
- **Completed:** 2026-02-19T19:39:26Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `WillingnessConfig` interface with nested decay/gain/sigmoid/fatigue sub-groups and `WillingnessSchema` for Koishi
- `WillingnessEngine` with per-channel state isolation, `tick()`, `processMessage()`, `recordBotReply()`
- All four helper functions: `computeDecayFactor`, `sigmoidGainMultiplier`, `computeFatiguePenalty`, `applyMentionBoost`

## Task Commits

1. **Task 1: WillingnessConfig interface and Koishi Schema** - `8e152c2` (feat)
2. **Task 2: WillingnessEngine class with all algorithms** - `a28babe` (feat)

## Files Created/Modified

- `plugins/core/src/services/agent/willingness-config.ts` - WillingnessConfig interface + WillingnessSchema
- `plugins/core/src/services/agent/willingness.ts` - WillingnessEngine replacing WillingnessCalculator
- `plugins/core/src/services/agent/service.ts` - Updated to use WillingnessEngine API (auto-fix)
- `plugins/core/src/services/agent/index.ts` - Updated export from WillingnessCalculator to WillingnessEngine (auto-fix)

## Decisions Made

- `processMessage()` is synchronous — no async LLM call, returns `{ probability, shouldReply }` directly
- `service.ts` wired with hardcoded default config values for now; full config integration deferred to 10-02
- Keyword regexes pre-compiled in constructor to avoid per-message compilation cost

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed broken imports in service.ts and index.ts**
- **Found during:** Task 2 (WillingnessEngine implementation)
- **Issue:** Removing `WillingnessCalculator` broke `service.ts` (import + usage) and `index.ts` (re-export)
- **Fix:** Updated `service.ts` to import and instantiate `WillingnessEngine` with default config; updated `gateAndEnqueue` to call `processMessage()` and `runLoop` to call `recordBotReply()`; updated `index.ts` export
- **Files modified:** `plugins/core/src/services/agent/service.ts`, `plugins/core/src/services/agent/index.ts`
- **Verification:** `tsc --noEmit` passes with no errors
- **Committed in:** `a28babe` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to keep the build passing. service.ts integration is minimal/temporary — full wiring with WillingnessConfig from AgentCoreConfig is deferred to 10-02.

## Issues Encountered

None.

## Next Phase Readiness

- `WillingnessEngine` and `WillingnessConfig` are self-contained and ready for integration
- 10-02 should: add `willingness: WillingnessConfig` to `AgentCoreConfig`, wire `WillingnessEngine` from config in `AgentCore`, remove old willingness fields from config, add decay timer via `ctx.setInterval`

---
*Phase: 10-willingness-system-migration*
*Completed: 2026-02-20*
