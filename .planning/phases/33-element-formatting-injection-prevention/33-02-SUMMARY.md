---
phase: 33-element-formatting-injection-prevention
plan: 02
subsystem: core
tags: [koishi, element-formatter, injection-prevention, pipeline, horizon]

# Dependency graph
requires:
  - phase: 33-01
    provides: ElementFormatterService with handler map, formatQuotePrefix, wrapIfLong utilities
provides:
  - End-to-end element formatting pipeline in EventListener.recordUserMessage()
  - Safe formatObservation() using pre-formatted content from timeline
  - Prompt injection vulnerability (ELEM-04) closed at source
affects: [phase-38-multimodal]

# Tech tracking
tech-stack:
  added: []
  patterns: [format-at-receive-store-safe, pipeline-fix-not-render-fix]

key-files:
  created: []
  modified:
    - core/src/services/horizon/listener.ts
    - core/src/services/horizon/service.ts

key-decisions:
  - "Pipeline fix strategy: format at receive time, store safe content, no escaping at render time"
  - "HorizonService declares element-formatter as inject dependency for startup ordering"

patterns-established:
  - "Format-at-receive pattern: user content processed through ElementFormatterService before timeline storage"
  - "Safety invariant: obs.content in formatObservation() is always pre-formatted — never re-escape"

requirements-completed: [ELEM-03, ELEM-04]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 33 Plan 02: Pipeline Integration Summary

**Element formatting pipeline wired into EventListener with quote prefix, unverified wrapping, and injection-safe formatObservation() via pre-formatted timeline content**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T12:27:43Z
- **Completed:** 2026-02-27T12:29:41Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- recordUserMessage() calls formatter.format(session.elements) instead of storing raw session.content
- Quote prefix [回复 Name: preview] prepended when session.quote exists
- Long messages wrapped in <unverified> tags before timeline storage
- formatObservation() injection vulnerability closed — obs.content is now always pre-formatted
- horizon/message event payload uses formatted content consistently

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire formatter into EventListener.recordUserMessage()** - `aef6226` (feat)
2. **Task 2: Add element-formatter to HorizonService inject and verify formatObservation safety** - `9a60431` (feat)

## Files Created/Modified

- `core/src/services/horizon/listener.ts` - recordUserMessage() now runs full formatting pipeline (elements -> format -> quote prefix -> wrapIfLong -> store)
- `core/src/services/horizon/service.ts` - Added element-formatter to inject array, safety invariant comments on formatObservation()

## Decisions Made

- Pipeline fix strategy: format content at receive time in EventListener, store safe output in timeline, no additional escaping in formatObservation() — avoids double-escaping
- HorizonService declares yesimbot.element-formatter as inject dependency so it waits for the service before starting

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 33 is fully complete (both plans shipped)
- Phase 38 can override the img handler via register("img", multimodalHandler) for multimodal support
- The formatting pipeline is extensible — any plugin can register custom element handlers

## Self-Check: PASSED

- All 2 modified files exist on disk
- Commit aef6226 found (Task 1)
- Commit 9a60431 found (Task 2)
- TypeScript compiles with zero errors

---

_Phase: 33-element-formatting-injection-prevention_
_Completed: 2026-02-27_
