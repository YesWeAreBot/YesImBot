---
phase: 40-data-structure-render-optimization
plan: "03"
subsystem: agent
tags: [trimmer, multimodal, observations, loop, ai-sdk, UserContent]

requires:
  - phase: 40-02
    provides: XML render pipeline, formatObservation for all observation types

provides:
  - trimObservations() function operating on Observation[] before rendering
  - ObservationTrimConfig interface for observation-level budget control
  - LoopMessage.content typed as string | UserContent for multimodal
  - hardClearToolResult() handles XML tool-results format with JSON fallback
  - Observation trimming integrated into loop.ts before formatHorizonText

affects: [phase-38-multimodal, loop, trimmer]

tech-stack:
  added: []
  patterns:
    - "Observation-level trimming before rendering — eliminates XML corruption risk"
    - "Image strip layer scaffolded as Phase 38 extension point"
    - "trimObservations returns new array (immutable); trimMessages mutates in-place (round-level)"

key-files:
  created: []
  modified:
    - core/src/services/agent/trimmer.ts
    - core/src/services/agent/loop.ts

key-decisions:
  - "trimObservations is immutable (returns new array); trimMessages keeps mutation pattern for round-level messages"
  - "ObservationTrimConfig.keepLastCount derived from keepLastRounds * 2 + 1 in loop.ts"
  - "hardClearToolResult tries XML format first, falls back to legacy JSON format for in-flight messages"
  - "messages cast to ModelMessage[] for CallParams — all actual values are strings, cast is safe"
  - "trimConfig moved before observation trim block so obsTrimConfig can reference it"

patterns-established:
  - "Observation trim before render: trimObservations(view.history) → view = {...view, history: result}"
  - "Layer order: image-strip → softTrim (remove whole observations) → hardClear (replace content)"

requirements-completed: []

duration: 5min
completed: 2026-02-28
---

# Phase 40 Plan 03: Observation-Level Trimmer Summary

**Structured Observation[] trimmer with image-strip/softTrim/hardClear layers, multimodal LoopMessage type, and XML-aware round trimmer integrated before formatHorizonText**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28T10:56:33Z
- **Completed:** 2026-02-28T11:01:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- New `trimObservations()` function trims Observation[] before rendering — no XML corruption risk
- `LoopMessage.content` widened to `string | UserContent` for Phase 38 multimodal readiness
- `hardClearToolResult()` updated to parse XML `<tool-results>` format with legacy JSON fallback
- `trimConfig` hoisted before observation trim block; `trimObservations` called in loop before `formatHorizonText`

## Task Commits

1. **Task 1: Create trimObservations and update LoopMessage type** - `0de42f0` (feat)
2. **Task 2: Integrate trimObservations into loop.ts** - `e9e5179` (feat)

## Files Created/Modified

- `core/src/services/agent/trimmer.ts` - Added trimObservations, ObservationTrimConfig, estimateObservationChars; updated LoopMessage, hardClearToolResult, totalChars, trimMessages
- `core/src/services/agent/loop.ts` - Hoisted trimConfig, added observation trim before formatHorizonText, cast messages to ModelMessage[]

## Decisions Made

- `trimObservations` is immutable (returns new array); `trimMessages` keeps its mutation pattern — different call sites with different requirements
- `hardClearToolResult` tries XML first, falls back to JSON — handles messages already in-flight from before Plan 02
- Cast `messages as ModelMessage[]` in callParams — all actual values are strings at runtime, cast is structurally safe

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved trimConfig declaration before observation trim block**

- **Found during:** Task 2 (loop.ts integration)
- **Issue:** Plan placed observation trim before `formatHorizonText` but `trimConfig` was declared after that block — forward reference compile error
- **Fix:** Hoisted `trimConfig` declaration to before the observation trim block
- **Files modified:** core/src/services/agent/loop.ts
- **Verification:** TypeScript compiles cleanly
- **Committed in:** e9e5179 (Task 2 commit)

**2. [Rule 3 - Blocking] Added ModelMessage cast for CallParams compatibility**

- **Found during:** Task 2 (TypeScript check)
- **Issue:** `LoopMessage[]` with `content: string | UserContent` not assignable to `ModelMessage[]` (ai-sdk expects `UserModelMessage.content: UserContent`, not `string`)
- **Fix:** Cast `messages as ModelMessage[]` in callParams — plan explicitly anticipated this: "If there's a type error, cast the messages array"
- **Files modified:** core/src/services/agent/loop.ts
- **Verification:** TypeScript compiles cleanly
- **Committed in:** e9e5179 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking)
**Impact on plan:** Both fixes were anticipated or trivial. No scope creep.

## Issues Encountered

None beyond the two blocking issues documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Observation-level trimming in place — Phase 38 multimodal can add image-strip logic to the scaffolded Layer 1 in `trimObservations`
- `LoopMessage.content: string | UserContent` ready for Phase 38 image message construction
- Phase 40 all 4 plans complete

---

_Phase: 40-data-structure-render-optimization_
_Completed: 2026-02-28_
