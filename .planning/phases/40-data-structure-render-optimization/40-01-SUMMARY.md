---
phase: 40-data-structure-render-optimization
plan: 01
subsystem: database
tags: [timeline, horizon, agent-loop, types, koishi]

requires:
  - phase: 37-qmanager-plugin
    provides: loop.ts with recordAgentResponse call sites

provides:
  - AgentAction type system (TimelineEventType.AgentAction, AgentActionData, AgentActionRecord, AgentActionObservation)
  - EventManager.recordAgentAction() method
  - Backward-compatible toObservations() handling old and new row shapes
  - Split recording in loop.ts (recordAgentResponse + recordAgentAction)
  - Bot message recording as MessageRecord after successful send_message

affects:
  - 40-02 (rendering — consumes AgentActionObservation from toObservations)
  - 40-03 (schema — AgentAction type must be in DB schema)

tech-stack:
  added: []
  patterns:
    - "Split timeline recording: LLM output (AgentResponse) and execution results (AgentAction) as separate entries"
    - "Backward-compat observation expansion: old agent.response rows with actions emit both AgentResponseObservation and AgentActionObservation"
    - "Bot message recording: successful send_message results recorded as MessageRecord with synthetic ID"

key-files:
  created: []
  modified:
    - core/src/services/horizon/types.ts
    - core/src/services/horizon/manager.ts
    - core/src/services/horizon/service.ts
    - core/src/services/agent/loop.ts

key-decisions:
  - "AgentResponseData.assistantText renamed to rawText; old field kept optional for backward compat with existing DB rows"
  - "actions/toolResults made optional on AgentResponseData — old rows still deserialize correctly"
  - "toObservations() emits AgentActionObservation from old agent.response rows that have actions, enabling seamless migration without DB backfill"
  - "Bot messages recorded with Random.id() as synthetic messageId — no platform message ID available at send time"
  - "Content split on <sep/> before recording — each part becomes a separate MessageRecord"

patterns-established:
  - "Split recording pattern: one recordAgentResponse (rawText) + one recordAgentAction (actions+toolResults) per loop round"

requirements-completed: []

duration: 5min
completed: 2026-02-28
---

# Phase 40 Plan 01: AgentResponse/AgentAction Type Split Summary

**Split AgentResponseRecord into AgentResponse (rawText) + AgentAction (actions+toolResults) with backward-compatible toObservations() and bot message recording in loop.ts**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28T10:35:51Z
- **Completed:** 2026-02-28T10:40:38Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `TimelineEventType.AgentAction`, `AgentActionData`, `AgentActionRecord`, `AgentActionObservation` to the type system
- Slimmed `AgentResponseData` (rawText + optional backward-compat fields), expanded `TimelineEntry` and `Observation` unions
- Added `EventManager.recordAgentAction()` and updated `toObservations()` to handle both old and new row shapes
- Rewired loop.ts to record split entries (AgentResponse + AgentAction) and bot messages as `MessageRecord`

## Task Commits

1. **Task 1: Extend type system with AgentAction and slim AgentResponseData** - `e301a7c` (feat)
2. **Task 2: Rewire loop.ts to record split entries and bot messages** - `153baab` (feat)

## Files Created/Modified

- `core/src/services/horizon/types.ts` - Added AgentAction enum value, AgentActionData/Record/Observation types, slimmed AgentResponseData, expanded unions
- `core/src/services/horizon/manager.ts` - Added recordAgentAction(), updated toObservations() for three-type handling
- `core/src/services/horizon/service.ts` - buildView query includes AgentAction; formatObservation guards optional actions
- `core/src/services/agent/loop.ts` - Split recording calls, bot message recording, Random/TimelineStage imports

## Decisions Made

- `assistantText` renamed to `rawText` with old field kept optional — avoids DB migration for existing rows
- `toObservations()` expands old `agent.response` rows with actions into both observation types — seamless migration without backfill
- Bot messages use `Random.id()` as synthetic messageId since no platform ID is available at send time
- `<sep/>` split applied before recording so each message part is a distinct `MessageRecord`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed formatObservation() accessing now-optional actions field**

- **Found during:** Task 1 (type system changes)
- **Issue:** `service.ts` `formatObservation()` accessed `obs.data.actions` directly; after making `actions` optional on `AgentResponseData`, TypeScript reported TS18048
- **Fix:** Added `?? []` fallback: `const actions = obs.data.actions ?? []`
- **Files modified:** `core/src/services/horizon/service.ts`
- **Verification:** `tsc --noEmit` passes cleanly
- **Committed in:** e301a7c (Task 1 commit)

**2. [Rule 1 - Bug] Fixed wmLines loop accessing now-optional d.actions/d.toolResults**

- **Found during:** Task 2 (loop.ts rewire)
- **Issue:** `loop.ts` wmLines construction iterated `d.actions` and called `d.toolResults.find()` directly; both are now optional
- **Fix:** Changed to `d.actions ?? []` and `(d.toolResults ?? []).find()`
- **Files modified:** `core/src/services/agent/loop.ts`
- **Verification:** `tsc --noEmit` passes cleanly
- **Committed in:** 153baab (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs introduced by type narrowing)
**Impact on plan:** Both fixes necessary for TypeScript correctness after making fields optional. No scope creep.

## Issues Encountered

None — TypeScript errors from optional field changes were caught immediately and fixed inline.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Type system ready for Plan 02 (rendering format changes — `formatObservation` and `formatHorizonText` consume new observation types)
- `AgentActionObservation` available in history for Plan 02 to render action blocks separately from LLM text
- Plan 03 (schema) should ensure `AgentAction` type string is handled in DB schema declarations

---

_Phase: 40-data-structure-render-optimization_
_Completed: 2026-02-28_
