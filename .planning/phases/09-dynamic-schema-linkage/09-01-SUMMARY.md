---
phase: 09-dynamic-schema-linkage
plan: 01
subsystem: model
tags: [koishi, schema, dynamic-schema, model-provider]

requires:
  - phase: 02-model-service
    provides: ModelService, IModelProvider, IModelService interfaces

provides:
  - IModelProvider.listModels() returning Record<string, ModelInfo>
  - ModelInfo.description optional field
  - ModelService.refreshSchemas() setting registry.chatModels dynamic schema
  - Auto-cleanup dispose hook on provider registration

affects: [10-agent-config, any phase using registry.chatModels schema]

tech-stack:
  added: []
  patterns:
    - "Schema.union with typed Schema<string>[] array for mixed const/string options"
    - "Context.current for caller-context dispose hooks in Service methods"

key-files:
  created: []
  modified:
    - packages/shared-model/src/types/model.ts
    - plugins/core/src/services/model/service.ts
    - providers/provider-deepseek/src/index.ts
    - providers/provider-openai/src/index.ts

key-decisions:
  - "Schema<string>[] typed array allows mixing Schema.const and Schema.string in union without type errors"
  - "Context.current gives caller context for dispose hook — auto-unregisters provider on plugin unload"
  - "listModels() added to both provider implementations to satisfy updated IModelProvider interface"

patterns-established:
  - "refreshSchemas pattern: iterate providers, call listModels(), build Schema.union, call ctx.schema.set"
  - "Dispose hook via this[Context.current].on('dispose', ...) for service method caller cleanup"

requirements-completed: [MODEL-04, MODEL-05]

duration: 3min
completed: 2026-02-20
---

# Phase 9 Plan 01: Dynamic Schema Linkage — Model Provider Engine Summary

**IModelProvider.listModels() + ModelService.refreshSchemas() wiring provider lifecycle to ctx.schema.set('registry.chatModels')**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-20T07:41:26Z
- **Completed:** 2026-02-20T07:44:24Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `description?: string` to `ModelInfo` and `listModels(): Record<string, ModelInfo>` to `IModelProvider`
- Implemented `refreshSchemas()` in ModelService building `Schema.union` from all registered providers
- Provider register/unregister both trigger schema refresh; dispose hook auto-unregisters on plugin unload

## Task Commits

1. **Task 1: Extend IModelProvider and ModelInfo types** - `f35d618` (feat)
2. **Task 2: Implement refreshSchemas() in ModelService** - `3deb754` (feat)

## Files Created/Modified
- `packages/shared-model/src/types/model.ts` - Added `description?` to ModelInfo, `listModels()` to IModelProvider
- `plugins/core/src/services/model/service.ts` - Added refreshSchemas(), updated register/unregister, dispose hook
- `providers/provider-deepseek/src/index.ts` - Implemented listModels() to satisfy interface
- `providers/provider-openai/src/index.ts` - Implemented listModels() to satisfy interface

## Decisions Made
- `Schema<string>[]` typed array used for union options — allows mixing `Schema.const` and `Schema.string()` without TypeScript inference errors
- `this[Context.current]` used in `registerProvider` to get caller's context for dispose hook
- `listModels()` implemented in both providers as `Object.fromEntries(this.models.map(m => [m.id, m]))` — minimal, uses existing `models` array

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added listModels() to DeepSeekProvider and OpenAIProvider**
- **Found during:** Task 2 (implementing refreshSchemas in ModelService)
- **Issue:** Both providers implement IModelProvider; adding listModels() to the interface made them fail typecheck
- **Fix:** Added `listModels(): Record<string, ModelInfo>` to both provider classes using existing `models` array
- **Files modified:** providers/provider-deepseek/src/index.ts, providers/provider-openai/src/index.ts
- **Verification:** `npx turbo run typecheck` passes for all 4 packages
- **Committed in:** 3deb754 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (blocking — interface compliance)
**Impact on plan:** Required for typecheck to pass. No scope creep.

## Issues Encountered
- Turbo cache served stale shared-model typecheck output — forced rebuild with `--force` and explicit `build` step to regenerate .d.ts before core plugin typecheck

## Next Phase Readiness
- `registry.chatModels` dynamic schema is now populated on provider registration
- Plan 02 can reference `Schema.dynamic('registry.chatModels')` in agent config
- No blockers

---
*Phase: 09-dynamic-schema-linkage*
*Completed: 2026-02-20*
