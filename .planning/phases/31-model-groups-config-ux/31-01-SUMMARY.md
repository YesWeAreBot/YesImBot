---
phase: 31-model-groups-config-ux
plan: 01
subsystem: ui
tags: [koishi, schema, i18n, config-ux, schemastery]

requires:
  - phase: 30-provider-architecture
    provides: AbstractProvider with createProviderSchema intersect pattern
provides:
  - Five labeled config groups in Koishi Console (Basic, Model, Willingness, Prompt, Advanced)
  - zh-CN and en-US locale files for all config field descriptions
  - i18n wiring via Schema.i18n() on top-level Config
affects: [31-02, provider-plugins]

tech-stack:
  added: []
  patterns:
    [
      Schema.intersect with locale-aware .description() for UI grouping,
      Schema.i18n() for field descriptions,
    ]

key-files:
  created:
    - core/src/locales/zh-CN.json
    - core/src/locales/en-US.json
  modified:
    - core/src/index.ts
    - core/src/services/agent/service.ts
    - core/src/services/agent/willingness.ts
    - core/src/services/horizon/service.ts
    - core/src/services/plugin/service.ts
    - core/src/services/prompt/service.ts
    - core/tsconfig.json

key-decisions:
  - "Used `as never` cast for locale-aware .description() objects — schemastery accepts objects at runtime but types only allow string"
  - "Inlined all field definitions into five groups in index.ts instead of importing service ConfigSchemas — cleaner grouping control"

patterns-established:
  - "Locale-aware group headers: .description({ 'zh-CN': '...', 'en-US': '...' } as never) on Schema.object inside intersect"
  - "i18n wiring: import JSON locale files, call .i18n({ 'zh-CN': zhCN._config, 'en-US': enUS._config }) on final schema"

requirements-completed: [REQ-06, REQ-07, REQ-08]

duration: 7min
completed: 2026-02-26
---

# Phase 31 Plan 01: Config UX Grouping & i18n Summary

**Core config reorganized into 5 labeled Console sections with zh-CN/en-US descriptions on all 32 fields via Schema.intersect + .i18n()**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-26T18:53:39Z
- **Completed:** 2026-02-26T19:01:19Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Created zh-CN and en-US locale JSON files covering all 32 config fields with descriptions
- Restructured flat Config into 5 labeled intersect groups (Basic, Model, Willingness, Prompt, Advanced)
- Stripped hardcoded .description() from 5 service schema files, replaced with i18n-driven descriptions
- Typecheck and build pass cleanly; flat config shape preserved for backward compatibility

## Task Commits

1. **Task 1: Create locale JSON files and update tsconfig** - `990d943` (chore)
2. **Task 2: Restructure core Config into five labeled groups with i18n** - `49c95f3` (feat)

## Files Created/Modified

- `core/src/locales/zh-CN.json` - Chinese descriptions for all config fields
- `core/src/locales/en-US.json` - English descriptions for all config fields
- `core/src/index.ts` - Five-group Schema.intersect with .i18n() wiring
- `core/src/services/agent/service.ts` - Stripped .description() from AgentCoreConfigSchema
- `core/src/services/agent/willingness.ts` - Stripped .description() from WillingnessSchema fields and sub-groups
- `core/src/services/horizon/service.ts` - Stripped .description() from HorizonServiceConfigSchema
- `core/src/services/plugin/service.ts` - Stripped .description() from PluginServiceConfigSchema
- `core/src/services/prompt/service.ts` - Stripped .description() from PromptServiceConfigSchema
- `core/tsconfig.json` - Added explicit JSON file inclusion

## Decisions Made

- Used `as never` type cast for locale-aware `.description()` objects since schemastery's TypeScript types only accept `string` but runtime accepts locale objects
- Inlined all field definitions directly into the five groups in `index.ts` rather than importing service ConfigSchemas, giving full control over field grouping

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `as never` cast for .description() locale objects**

- **Found during:** Task 2 (Config restructuring)
- **Issue:** schemastery type definitions declare `.description(text: string)` but runtime accepts `{ "zh-CN": string, "en-US": string }` objects for locale-aware headers
- **Fix:** Added `as never` cast on all 5 group `.description()` calls
- **Files modified:** core/src/index.ts
- **Verification:** `yarn typecheck` passes cleanly
- **Committed in:** 49c95f3

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Type cast necessary due to schemastery type definition gap. No scope creep.

## Issues Encountered

None beyond the type cast deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Core config grouping and i18n complete
- Provider plugins (31-02) can follow the same locale pattern established here
- Each provider already has locale files created (picked up by lint-staged in Task 1 commit)

## Self-Check: PASSED

- All 9 files verified present
- Commit 990d943 verified
- Commit 49c95f3 verified

---

_Phase: 31-model-groups-config-ux_
_Completed: 2026-02-26_
