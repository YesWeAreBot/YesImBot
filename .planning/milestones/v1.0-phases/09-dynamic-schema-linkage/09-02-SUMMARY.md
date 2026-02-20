---
phase: 09-dynamic-schema-linkage
plan: 02
subsystem: model
tags: [koishi, schema, dynamic-schema, agent-config, model-provider]

requires:
  - phase: 09-01
    provides: refreshSchemas() wiring registry.chatModels dynamic schema

provides:
  - Schema.dynamic('registry.chatModels') dropdowns for model/fallbackModel/willingnessModel in core Config
  - parseModelId() utility in shared-model for splitting provider:model strings
  - ThinkActLoop fallback logic: tries config.fallbackModel when config.model parse fails
  - WillingnessCalculator llmJudge uses parseModelId on willingnessModel ?? model

affects: [any phase reading AgentCoreConfig.provider or willingnessProvider]

tech-stack:
  added: []
  patterns:
    - "Schema.dynamic('registry.chatModels') for config fields that reference registered model providers"
    - "parseModelId(fullId) splits provider:model string — returns null for invalid input"
    - "Fallback chain in loop.ts: parse primary, warn and try fallbackModel if null"

key-files:
  created: []
  modified:
    - packages/shared-model/src/utils/model-id.ts
    - plugins/core/src/services/agent/config.ts
    - plugins/core/src/services/agent/loop.ts
    - plugins/core/src/services/agent/willingness.ts
    - plugins/core/src/index.ts

key-decisions:
  - "parseModelId added to shared-model alongside createModelId — single source of truth, no duplication across loop/willingness"
  - "AgentCoreConfig removes provider/willingnessProvider; model field now holds provider:model string"
  - "Fallback in loop.ts is parse-time: if config.model is missing/invalid, try config.fallbackModel before giving up"

patterns-established:
  - "provider:model string as single config field — parseModelId splits at first colon"

requirements-completed: [MODEL-04, MODEL-05]

duration: 4min
completed: 2026-02-20
---

# Phase 9 Plan 02: Dynamic Schema Linkage — Config UI and Agent Loop Wiring Summary

**Schema.dynamic dropdowns for model/fallbackModel/willingnessModel in core Config, with parseModelId() parsing provider:model strings in agent loop and willingness judge**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-02-19T16:46:37Z
- **Completed:** 2026-02-19T16:50:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Replaced agentProvider/agentModel/willingnessProvider static string fields with Schema.dynamic('registry.chatModels') dropdowns
- Added parseModelId() to shared-model utils; imported in loop.ts and willingness.ts
- Agent loop parses provider:model from config.model, falls back to config.fallbackModel with warning log

## Task Commits

1. **Task 1: Replace static model fields with dynamic schema dropdowns** - `49ad6b7` (feat)
2. **Task 2: Update agent loop and willingness to parse provider:model strings** - `43629db` (feat)

## Files Created/Modified
- `packages/shared-model/src/utils/model-id.ts` - Added parseModelId() alongside createModelId()
- `plugins/core/src/services/agent/config.ts` - Removed provider/willingnessProvider; added fallbackModel
- `plugins/core/src/index.ts` - Schema.dynamic dropdowns for model/fallbackModel/willingnessModel; updated apply()
- `plugins/core/src/services/agent/loop.ts` - parseModelId on config.model, fallback to config.fallbackModel
- `plugins/core/src/services/agent/willingness.ts` - parseModelId on willingnessModel ?? model

## Decisions Made
- parseModelId placed in shared-model (not duplicated in loop/willingness) — single source of truth
- Fallback logic is parse-time in loop.ts: if config.model is absent or has no colon, try fallbackModel before returning
- AgentCoreConfig.provider and willingnessProvider removed entirely — model field is now the full provider:model string

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Turbo cache served stale shared-model typecheck output after adding parseModelId — forced rebuild with `--force` and explicit `build` step to regenerate .d.ts before core plugin typecheck (same pattern as Plan 01)

## Next Phase Readiness
- Config UI now shows dynamic model dropdowns populated by registered providers
- Agent loop and willingness both resolve models via parseModelId — no more separate provider fields
- Phase 09 complete — dynamic schema linkage fully wired end-to-end

---
*Phase: 09-dynamic-schema-linkage*
*Completed: 2026-02-20*
