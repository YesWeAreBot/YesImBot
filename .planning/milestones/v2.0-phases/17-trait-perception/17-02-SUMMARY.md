---
phase: 17-trait-perception
plan: 02
subsystem: agent
tags: [trait-detectors, scene-awareness, conversation-heat, event-driven-state]

requires:
  - phase: 17-trait-perception
    provides: TraitAnalyzer service with detector registry, state API, parallel dispatch
provides:
  - SceneTrait detector (scene + attention dimensions)
  - HeatTrait detector (heat + heat-trend dimensions)
  - Built-in detector registration in TraitAnalyzer.start()
affects: [phase-18, agent-core, skill-system]

tech-stack:
  added: []
  patterns: [event-driven-state-update, sliding-window-rate, lazy-init-bot-name]

key-files:
  created:
    - core/src/services/trait/detectors/scene.ts
    - core/src/services/trait/detectors/heat.ts
  modified:
    - core/src/services/trait/service.ts
    - core/src/services/trait/index.ts

key-decisions:
  - "SceneTrait lazy-inits bot name from first detect() call's view.self.name"
  - "HeatTrait uses 5-minute sliding window with 8/2 msgs-per-minute thresholds for high/medium"
  - "Trend detection splits window at midpoint with 1.3x/0.7x ratio thresholds"

patterns-established:
  - "Detector state pattern: event handler writes state, detect() reads pre-computed state"
  - "Channel key format: platform:channelId for per-channel state isolation"
  - "Detector logger: created once in start() as ctx.logger('trait:<name>')"

requirements-completed: [TRAIT-02, TRAIT-03]

duration: 2min
completed: 2026-02-22
---

# Phase 17 Plan 02: Built-in Trait Detectors Summary

**SceneTrait (group/private + mentioned/ignored) and HeatTrait (low/medium/high + heating/cooling/stable) detectors with event-driven state via horizon/message**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T14:31:56Z
- **Completed:** 2026-02-22T14:33:36Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- SceneTrait outputs scene dimension (group-chat/private-chat) and attention dimension (mentioned/ignored)
- HeatTrait outputs heat dimension (low/medium/high) and heat-trend dimension (heating/cooling/stable)
- Both detectors registered automatically in TraitAnalyzer.start()

## Task Commits

Each task was committed atomically:

1. **Task 1: SceneTrait and HeatTrait detector implementations** - `e267ad0` (feat)
2. **Task 2: Register built-in detectors in TraitAnalyzer.start()** - `9075bc5` (feat)

## Files Created/Modified
- `core/src/services/trait/detectors/scene.ts` - SceneTrait: scene + attention signals with event-driven mention/ignore tracking
- `core/src/services/trait/detectors/heat.ts` - HeatTrait: sliding-window message rate + trend detection
- `core/src/services/trait/service.ts` - Registers SceneTrait and HeatTrait in start()
- `core/src/services/trait/index.ts` - Re-exports detector classes

## Decisions Made
- SceneTrait lazy-inits bot name from view.self.name on first detect() call (avoids config dependency)
- HeatTrait uses 5-minute window, 8 msgs/min high threshold, 2 msgs/min medium threshold
- Trend detection: 1.3x ratio = heating, 0.7x ratio = cooling, comparing recent vs older half of window

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both built-in trait detectors operational and producing signals
- TraitAnalyzer.analyze() dispatches to both detectors in parallel via Promise.allSettled
- Ready for Phase 18: Skill system consuming TraitSignal arrays for behavior adaptation

## Self-Check: PASSED

All 4 files verified present. Both task commits (e267ad0, 9075bc5) verified in git log.

---
*Phase: 17-trait-perception*
*Completed: 2026-02-22*
