---
phase: 03-horizon-context-system
plan: 02
subsystem: context
tags: [koishi, middleware, event-listener, percept, timeline, aggregation]

requires:
  - phase: 03-01
    provides: EventManager.recordMessage(), types (UserMessagePercept, TriggerType, PerceptType, TimelineStage)

provides:
  - EventListener class with Koishi middleware for message capture
  - Trigger classification (mention/reply/keyword/random/direct)
  - Group chat message aggregation with debounce
  - Percept emission via ctx.emit('horizon/percept')

affects: [03-03-horizon-service, agent-core]

tech-stack:
  added: []
  patterns:
    - "Declaration merging for Koishi Events interface (after-send, horizon/percept)"
    - "ctx.setTimeout for dispose-safe timers in Koishi plugins"
    - "Disposer array pattern for cleanup in start()/stop()"

key-files:
  created:
    - plugins/core/src/services/horizon/listener.ts
  modified: []

key-decisions:
  - "Declaration merging extends Koishi Events for after-send and horizon/percept type safety"
  - "ctx.setTimeout (not raw setTimeout) used for aggregation timers — Koishi auto-cancels on dispose"
  - "TRIGGER_PRIORITY map preserves highest-priority trigger across aggregation window"
  - "Direct messages bypass aggregation and emit Percept immediately"

patterns-established:
  - "Listener pattern: start()/stop() with disposer array for Koishi middleware lifecycle"
  - "Aggregation pattern: Map<channelKey, {timer, percept}> with priority preservation"

requirements-completed: [HORIZON-04]

duration: 5min
completed: 2026-02-18
---

# Phase 3 Plan 02: EventListener Summary

**Koishi middleware pipeline capturing messages to Timeline and emitting Percepts with 5-type trigger classification and group chat debounce aggregation**

## Performance

- **Duration:** ~5 min
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- EventListener captures user messages via Koishi middleware and bot messages via after-send hook
- Trigger classification covers all 5 types: direct, reply, mention, keyword, random
- Group chat messages aggregated with 1500ms debounce, preserving highest-priority trigger
- ctx.setTimeout used for dispose-safe timers (auto-cancelled on plugin dispose)

## Task Commits

1. **Task 1: EventListener with trigger classification and message aggregation** - `7dbc2ef` (feat)

## Files Created/Modified

- `plugins/core/src/services/horizon/listener.ts` - EventListener class: middleware, after-send hook, trigger classification, message aggregation, Percept emission

## Decisions Made

- Declaration merging extends Koishi `Events` interface for `after-send` and `horizon/percept` — required for type-safe `ctx.on`/`ctx.emit` calls
- `ctx.setTimeout` instead of raw `setTimeout` — Koishi auto-cancels on dispose, preventing timer leaks
- Direct messages bypass aggregation window and emit immediately

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added Koishi Events declaration merging for after-send and horizon/percept**

- **Found during:** Task 1 (typecheck)
- **Issue:** `ctx.on('after-send')` and `ctx.emit('horizon/percept')` failed typecheck — events not declared in Koishi's Events interface
- **Fix:** Added `declare module 'koishi' { interface Events { ... } }` in listener.ts
- **Files modified:** plugins/core/src/services/horizon/listener.ts
- **Verification:** `npx tsc --noEmit` passes with no errors
- **Committed in:** 7dbc2ef (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 type error)
**Impact on plan:** Required for type safety. No scope creep.

## Issues Encountered

None beyond the type errors resolved above.

## Next Phase Readiness

- EventListener ready to be instantiated by HorizonService (Plan 03)
- `horizon/percept` event ready for AgentCore to subscribe to

---

_Phase: 03-horizon-context-system_
_Completed: 2026-02-18_
