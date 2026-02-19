---
phase: 08-stream-support-dead-code-cleanup
plan: 01
subsystem: agent
tags: [ai-sdk, streaming, p-queue, timeline, lifecycle]

requires:
  - phase: 05-agent-core
    provides: ThinkActLoop with generateText path and ModelService.call()
  - phase: 03-horizon-context-system
    provides: EventManager with markAsActive, TimelineStage enum

provides:
  - streamCall wrapped in PQueue concurrency control
  - archiveStale method on EventManager for bulk lifecycle transitions
  - archiveThresholdMs config field flowing from Schema to HorizonServiceConfig
  - ThinkActLoop stream branch (streamMode=true uses streamCall, false uses generateText)
  - markAsActive + archiveStale lifecycle calls after agent response

affects: [agent-core, horizon, model-service]

tech-stack:
  added: []
  patterns:
    - "streamCall queue wrap: same this.queue.add pattern as call() for concurrency control"
    - "Lifecycle transitions after response: markAsActive then archiveStale before recordAgentSummary"

key-files:
  created: []
  modified:
    - plugins/core/src/services/model/service.ts
    - plugins/core/src/services/horizon/manager.ts
    - plugins/core/src/services/horizon/config.ts
    - plugins/core/src/services/agent/loop.ts
    - plugins/core/src/index.ts

key-decisions:
  - "streamCall queue slot released when streamText() returns result object (stream lazy — HTTP established, not fully consumed)"
  - "archiveStale uses same as unknown as Query.Expr<TimelineEntry> cast pattern from query()"
  - "archiveThresholdMs default 86400000ms (24h) — matches plan spec"
  - "callParams assembled once before branch — both generateText and streamCall paths share same params object"

patterns-established:
  - "Stream/generate branch: single callParams object, branch only on which SDK function to call"
  - "Lifecycle order: markAsActive → archiveStale → recordAgentSummary"

requirements-completed: [AGENT-03, HORIZON-02]

duration: 3min
completed: 2026-02-19
---

# Phase 8 Plan 01: Stream Support & Timeline Lifecycle Summary

**PQueue-controlled streamCall, archiveStale bulk lifecycle method, and ThinkActLoop stream/generate branch with markAsActive+archiveStale after response**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-19T14:04:38Z
- **Completed:** 2026-02-19T14:07:12Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- streamCall now wrapped in this.queue.add — respects PQueue concurrency limit
- archiveStale added to EventManager — bulk-archives Active entries older than threshold
- ThinkActLoop branches on config.streamMode: streamCall path when true, generateText when false
- markAsActive + archiveStale called after send logic, before recordAgentSummary

## Task Commits

1. **Task 1: Wrap streamCall in PQueue and add archiveStale to EventManager** - `a22c9de` (feat)
2. **Task 2: Add stream branch and lifecycle calls to ThinkActLoop** - `3f67e07` (feat)

## Files Created/Modified
- `plugins/core/src/services/model/service.ts` - streamCall body wrapped in this.queue.add
- `plugins/core/src/services/horizon/manager.ts` - archiveStale method added
- `plugins/core/src/services/horizon/config.ts` - archiveThresholdMs field added
- `plugins/core/src/services/agent/loop.ts` - stream branch + lifecycle calls
- `plugins/core/src/index.ts` - archiveThresholdMs Schema field and HorizonService pass-through

## Decisions Made
- streamCall queue slot released when streamText() returns (stream is lazy — HTTP established, not fully consumed) — matches call() pattern
- archiveStale uses same `as unknown as Query.Expr<TimelineEntry>` cast as query() method
- callParams assembled once before the stream/generate branch — both paths share the same params object

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Stream mode toggle fully wired: config.streamMode=true activates streamText path
- Timeline lifecycle transitions complete: New→Active→Archived after each agent response
- Ready for dead code cleanup tasks in remaining 08 plans

---
*Phase: 08-stream-support-dead-code-cleanup*
*Completed: 2026-02-19*
