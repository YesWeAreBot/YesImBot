---
phase: 40-data-structure-render-optimization
plan: 02
subsystem: horizon
tags: [mustache, xml, rendering, formatObservation, formatHorizonText, loop]

requires:
  - phase: 40-01
    provides: AgentActionObservation type and toObservations() expansion logic

provides:
  - Unified XML render pipeline for all three observation types in formatObservation
  - formatHorizonText with simplified (view, percept?) signature
  - horizon-view.mustache without working-memory block
  - loop.ts without wmLines construction, XML formatToolResults

affects: [agent-loop, horizon-service, prompt-rendering]

tech-stack:
  added: []
  patterns:
    - "XML-escape helper esc() for dynamic attribute values in formatObservation"
    - "formatObservation returns empty string for successful agent.response (filtered at call site)"
    - "formatToolResults uses <tool-results>/<tool-result> XML tags instead of JSON"

key-files:
  created: []
  modified:
    - core/src/services/horizon/service.ts
    - core/resources/templates/partials/horizon-view.mustache
    - core/src/services/agent/loop.ts
    - core/src/services/horizon/__tests__/format-horizon-text.test.ts

key-decisions:
  - "agent.response observations with no error return empty string from formatObservation — actions already rendered via AgentActionObservation"
  - 'esc() helper defined inline in formatObservation — escapes &, ", <, > in dynamic XML attribute values'
  - "formatToolResults switched to XML <tool-result name status> tags — consistent with unified XML prompt format"
  - "wmLines block removed from loop.ts entirely — working memory now flows through AgentAction observations in history"

patterns-established:
  - "All timeline observations render through formatObservation with consistent XML tags"
  - "Empty formatObservation results filtered with if (!formatted) continue in formatHorizonText"

requirements-completed: []

duration: 3min
completed: 2026-02-28
---

# Phase 40 Plan 02: Render Pipeline Unification Summary

**Unified observation render pipeline: XML tags for all three types, working-memory block removed, wmLines eliminated, formatToolResults switched to XML**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T10:51:11Z
- **Completed:** 2026-02-28T10:53:53Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `formatObservation` now handles message/agent.action/agent.response with unified XML rendering; messages gain `time="HH:MM"` attribute and XML-escaped dynamic values
- `<bot-action>` and `<bot-error>` XML tags replace legacy `[HH:MM] [Bot]:` plain-text rendering
- `working-memory` block removed from mustache template; `formatHorizonText` signature simplified to `(view, percept?)`
- `wmLines` construction block (~40 lines) removed from `loop.ts`; `formatToolResults` outputs `<tool-results>` XML

## Task Commits

1. **Task 1: Update formatObservation for all three types and add time attribute** - `dd0d20f` (feat)
2. **Task 2: Remove working-memory, simplify formatHorizonText, update loop.ts and template** - `b164ebe` (feat)

## Files Created/Modified

- `core/src/services/horizon/service.ts` - Updated formatObservation (XML tags, esc helper, time attr), simplified formatHorizonText signature
- `core/resources/templates/partials/horizon-view.mustache` - Removed working-memory block
- `core/src/services/agent/loop.ts` - Removed wmLines block, simplified formatHorizonText call, XML formatToolResults
- `core/src/services/horizon/__tests__/format-horizon-text.test.ts` - Removed hasWorkingMemory/workingMemory from buildFixedScope

## Decisions Made

- `agent.response` observations with no error return `""` from `formatObservation` — the actions are already captured by the `AgentActionObservation` emitted by `toObservations()` in Plan 01
- `esc()` defined inline at the top of `formatObservation` — simple, no extra abstraction needed
- `formatToolResults` XML format keeps `name` and `status` as attributes, content as element body — consistent with the rest of the XML prompt format

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 40 render pipeline unification complete
- All observations flow through unified XML format in the LLM prompt
- Working memory plain-text path fully eliminated
- TypeScript compiles cleanly, all tests pass

---

_Phase: 40-data-structure-render-optimization_
_Completed: 2026-02-28_
