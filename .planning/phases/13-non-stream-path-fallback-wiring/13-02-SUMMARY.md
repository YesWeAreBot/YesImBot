---
phase: 13-non-stream-path-fallback-wiring
plan: 02
subsystem: agent
tags: [model-service, fallback, non-stream, tool-collision-guard]

requires:
  - phase: 13-non-stream-path-fallback-wiring
    provides: ModelService with retry, fallback, resolveModel, per-call fallbackModel parameter
  - phase: 05-agent-core-loop
    provides: ThinkActLoop with buildAiSdkTools and finishTool
provides:
  - Non-stream path routed through ModelService.call() with fallbackModel
  - Stream path passes fallbackModel to ModelService.streamCall()
  - finishTool collision guard — always appended last, cannot be overwritten by plugins
affects: [agent-loop-consumers, plugin-tool-authors]

tech-stack:
  added: []
  patterns: [modelservice-gateway-complete, finish-tool-last-wins]

key-files:
  created: []
  modified:
    - plugins/core/src/services/agent/loop.ts
    - plugins/core/src/services/agent/tools.ts

key-decisions:
  - "No defaultParams in loop.ts — ModelService merges provider defaults internally via executeCall/executeStreamCall"
  - "finishTool appended after plugin tool loop (last-wins) instead of pre-seeded (first-loses)"

patterns-established:
  - "ModelService as sole gateway: no direct generateText/streamText in consumer code"
  - "Reserved tool names appended last to prevent plugin collision"

requirements-completed: [AGENT-01, AGENT-03]

duration: 2min
completed: 2026-02-20
---

# Phase 13 Plan 02: Non-stream Path Rewire & finishTool Guard Summary

**Non-stream path routed through modelService.call() with fallbackModel, finishTool collision guard ensures reserved tool always wins over plugins**

## Performance

- **Duration:** 105s (~2 min)
- **Started:** 2026-02-20T14:03:22Z
- **Completed:** 2026-02-20T14:05:07Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Non-stream path in ThinkActLoop now uses modelService.call() instead of direct generateText
- Both stream and non-stream paths pass config.fallbackModel for per-call fallback chain
- Removed defaultParams extraction/spread from loop.ts — ModelService handles internally
- finishTool cannot be shadowed by plugin tools (appended last)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewire non-stream path to modelService.call() and pass fallbackModel** - `f57088e` (feat)
2. **Task 2: Fix finishTool collision guard in buildAiSdkTools** - `d0e10b3` (fix)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `plugins/core/src/services/agent/loop.ts` - Removed generateText/parseModelId imports, removed getModel/defaultParams, uses modelService.call() and passes fallbackModel
- `plugins/core/src/services/agent/tools.ts` - finishTool appended after plugin tool loop instead of pre-seeded

## Decisions Made
- No defaultParams in loop.ts — ModelService merges provider defaults internally via executeCall/executeStreamCall
- finishTool appended after plugin tool loop (last-wins) instead of pre-seeded (first-loses)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ModelService gateway pattern is now complete — both stream and non-stream paths go through it
- No raw ai-sdk calls remain in loop.ts
- Ready for Phase 14+ work

## Self-Check: PASSED

- [x] Commit f57088e exists
- [x] Commit d0e10b3 exists
- [x] plugins/core/src/services/agent/loop.ts exists
- [x] plugins/core/src/services/agent/tools.ts exists
- [x] .planning/phases/13-non-stream-path-fallback-wiring/13-02-SUMMARY.md exists

---
*Phase: 13-non-stream-path-fallback-wiring*
*Completed: 2026-02-20*
