---
phase: 30-provider-architecture
plan: 01
subsystem: model
tags: [abstract-class, schema-factory, call-settings, koishi-plugin, ai-sdk]

requires:
  - phase: 29-runtime-bug-fixes
    provides: stable ModelService with registerProvider/dispose lifecycle
provides:
  - AbstractProvider abstract class with auto-registration and getModel/listModels/getDefaultParams
  - createProviderSchema() factory with parameterized defaults and Schema.intersect extra support
  - BaseProviderConfig and ProviderSchemaOptions interfaces
  - CallSettings re-export from shared-model (replaces deleted ModelDefaultParams)
affects: [30-02-provider-migration]

tech-stack:
  added: []
  patterns: [abstract-provider-pattern, schema-factory-pattern, advancedOverride-merge]

key-files:
  created:
    - packages/shared-model/src/providers/abstract-provider.ts
    - packages/shared-model/src/providers/schema-factory.ts
  modified:
    - packages/shared-model/src/types/model.ts
    - packages/shared-model/src/index.ts
    - packages/shared-model/package.json
    - core/src/services/model/service.ts

key-decisions:
  - "Used 'as never' cast for Schema.array().default() to satisfy Koishi Schema's strict resolved-type requirement without using explicit 'any'"
  - "DefaultModelEntry type exported for callers to use Pick<ModelInfo, 'id'> + Partial for schema defaults"
  - "advancedOverride merges into defaultParams at construction time via shallow spread; per-call params always win via ModelService's { ...defaults, ...params }"

patterns-established:
  - "AbstractProvider pattern: subclasses only implement createClient(), constructor auto-registers with ModelService"
  - "createProviderSchema pattern: parameterized factory with extra field composition via Schema.intersect"
  - "advancedOverride pattern: textarea JSON with parse-error-as-warning graceful degradation"

requirements-completed: [REQ-05]

duration: 5min
completed: 2026-02-26
---

# Phase 30 Plan 01: Provider Architecture Foundation Summary

**AbstractProvider base class and createProviderSchema() factory in shared-model, replacing ModelDefaultParams with ai-sdk CallSettings**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-26T16:03:07Z
- **Completed:** 2026-02-26T16:08:58Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Deleted ModelDefaultParams interface; IModelProvider now uses Partial<CallSettings> from ai-sdk
- Created AbstractProvider abstract class with auto-registration, getModel, listModels, getDefaultParams, and advancedOverride merge
- Created createProviderSchema() factory with parameterized defaults and Schema.intersect for extra fields
- Updated ModelService to compile without ModelDefaultParams references
- Both shared-model and core typecheck pass cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Update model.ts — delete ModelDefaultParams, use CallSettings** - `14b6eee` (refactor)
2. **Task 2: Create AbstractProvider and schema factory** - `a8713ab` (feat)
3. **Task 3: Update ModelService to use CallSettings** - `e8d5b99` (refactor)

## Files Created/Modified
- `packages/shared-model/src/providers/abstract-provider.ts` - AbstractProvider abstract class, BaseProviderConfig interface
- `packages/shared-model/src/providers/schema-factory.ts` - createProviderSchema() factory, ProviderSchemaOptions, DefaultModelEntry
- `packages/shared-model/src/types/model.ts` - Deleted ModelDefaultParams, updated IModelProvider to use CallSettings
- `packages/shared-model/src/index.ts` - Added re-exports for providers/abstract-provider and providers/schema-factory
- `packages/shared-model/package.json` - Added koishi as optional peer dependency
- `core/src/services/model/service.ts` - Removed ModelDefaultParams import, updated getModel() return type

## Decisions Made
- Used `as never` cast for Schema.array().default() — Koishi Schema expects the fully-resolved type but callers pass partial ModelInfo entries; `as never` avoids explicit `any` per project rules
- Exported `DefaultModelEntry` type so Plan 02 callers can use the correct type for defaultModels arrays
- advancedOverride merges into resolvedDefaultParams at construction time; per-call params always win via ModelService's spread pattern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Schema.array().default() type mismatch in schema-factory.ts**
- **Found during:** Task 2 (Create AbstractProvider and schema factory)
- **Issue:** `ModelInfo[]` has optional fields (`tool_call?`, `reasoning?`, `modalities?`) but Koishi Schema `.default()` expects the fully-resolved type with all fields required
- **Fix:** Added `DefaultModelEntry` type alias and used `as never` cast at the `.default()` call site to satisfy the Schema API boundary
- **Files modified:** packages/shared-model/src/providers/schema-factory.ts
- **Verification:** `npx tsc --noEmit` passes cleanly
- **Committed in:** a8713ab (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Type-level fix only, no behavioral change. Required for compilation.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- AbstractProvider and createProviderSchema() are ready for Plan 02 to migrate all three providers (OpenAI, DeepSeek, Anthropic)
- Provider packages will temporarily fail typecheck until Plan 02 migrates them off ModelDefaultParams
- shared-model and core both typecheck cleanly

---
*Phase: 30-provider-architecture*
*Completed: 2026-02-26*

## Self-Check: PASSED

All files verified present, all 3 commits confirmed in git log.
