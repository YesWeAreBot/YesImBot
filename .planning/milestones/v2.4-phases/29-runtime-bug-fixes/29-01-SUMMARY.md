---
phase: 29-runtime-bug-fixes
plan: 01
subsystem: agent
tags: [queue, burst-messages, backlog-merge, koishi-service]

requires:
  - phase: none
    provides: none
provides:
  - "Array-based pending queue replacing single-slot Map in AgentCore"
  - "mergeBacklog helper combining burst messages into single LoopPayload"
  - "isBacklogDrain metadata flag for merged payloads"
affects: [agent-loop, horizon-view, willingness]

tech-stack:
  added: []
  patterns: [array-queue-pending, immutable-backlog-merge]

key-files:
  created: []
  modified:
    - core/src/services/agent/service.ts

key-decisions:
  - "Used plain array (LoopPayload[]) for pending queue — sufficient at chat scale"
  - "First message timestamp preserved in merged percept for correct timeline ordering"
  - "isBacklogDrain flag set on merged metadata for downstream loop awareness"

patterns-established:
  - "Array-push pending pattern: get ?? [] -> push -> set for all queue sites"

requirements-completed: [REQ-01]

duration: 3min
completed: 2026-02-26
---

# Phase 29 Plan 01: Pending Queue Array Summary

**Array-based pending queue replacing single-slot Map to prevent burst message loss during in-flight response generation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-26T13:23:14Z
- **Completed:** 2026-02-26T13:26:31Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Converted `pending` field from `Map<string, LoopPayload>` to `Map<string, LoopPayload[]>`
- Updated all 5 call sites (1 group path + 4 DM path) to array-push pattern
- Added `mergeBacklog` helper that immutably combines backlogged payloads
- Updated enqueue drain to merge all accumulated payloads before re-enqueue
- Build and typecheck pass clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert pending Map to array queue and update all call sites** - `a4e4101` (feat)
2. **Task 2: Verify build and validate all pending.set sites** - verification only, no file changes

## Files Created/Modified

- `core/src/services/agent/service.ts` - Changed pending type, added mergeBacklog, updated all 5 set sites and enqueue drain

## Decisions Made

- Used plain `LoopPayload[]` array for queue — no need for linked list at chat message scale
- First backlogged message's timestamp used for merged percept (per CONTEXT.md decision)
- `isBacklogDrain: true` and `backlogCount` set on merged metadata for loop awareness
- Spread operator used throughout mergeBacklog for immutability

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- REQ-01 fix complete, pending queue now accumulates burst messages
- REQ-02 and REQ-03 fixes ready to proceed in plan 02

## Self-Check: PASSED

- FOUND: commit a4e4101
- FOUND: core/src/services/agent/service.ts
- FOUND: 29-01-SUMMARY.md

---

_Phase: 29-runtime-bug-fixes_
_Completed: 2026-02-26_
