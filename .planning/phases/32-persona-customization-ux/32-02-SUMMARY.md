---
phase: 32-persona-customization-ux
plan: 02
subsystem: ui
tags: [koishi, persona, prompt-injection, schema]

requires:
  - phase: 32-persona-customization-ux/01
    provides: persona plugin scaffold with Schema, presets, and i18n
provides:
  - buildPersonaText() pure function with preset merge logic
  - PromptService injection wiring (__persona_supplement after __role_soul)
  - Automatic dispose cleanup via Koishi context lifecycle
affects: [core-prompt, role-service]

tech-stack:
  added: []
  patterns:
    [declare-module augmentation for external plugin typing, preset-merge-with-user-override]

key-files:
  created: []
  modified:
    - plugins/persona/src/index.ts

key-decisions:
  - "Used local declare module augmentation instead of core devDependency for PromptService typing"
  - "buildPersonaText returns pre-computed text string; renderFn returns cached value (no re-computation per render)"

patterns-established:
  - "External plugin type augmentation: declare module 'koishi' with minimal interface for consumed service"

requirements-completed: []

duration: 6min
completed: 2026-02-27
---

# Phase 32 Plan 02: Persona Injection Wiring & Text Assembly Summary

**buildPersonaText() with preset-merge-then-override and PromptService.inject() wiring into soul point after \_\_role_soul**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-27T07:10:22Z
- **Completed:** 2026-02-27T07:16:29Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Implemented buildPersonaText() pure function that merges preset defaults with user-provided field overrides
- Wired PromptService.inject() with **persona_supplement positioned after **role_soul
- Guard prevents empty injection when all fields are empty and preset is none
- Semantic prefix "以下是补充人格特质：" distinguishes persona content from SOUL.md

## Task Commits

Both tasks implemented in single atomic commit (tightly coupled in same file):

1. **Task 1+2: buildPersonaText, preset merging, and injection wiring** - `fd8c5c3` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `plugins/persona/src/index.ts` - Added buildPersonaText(), PromptInjector type augmentation, and apply() injection wiring

## Decisions Made

- Used local `declare module "koishi"` augmentation with minimal PromptInjector interface instead of adding core as devDependency — keeps persona plugin lightweight and self-contained
- Pre-compute text in apply() and capture in closure for renderFn — avoids re-merging on every prompt render call

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added declare module augmentation for yesimbot.prompt typing**

- **Found during:** Task 1 (typecheck)
- **Issue:** TypeScript could not resolve `ctx["yesimbot.prompt"]` — the declare module augmentation lives in core but persona plugin had no dependency on core
- **Fix:** Added local `declare module "koishi"` with minimal PromptInjector interface containing only the `inject()` method signature
- **Files modified:** plugins/persona/src/index.ts
- **Verification:** `tsc --noEmit` passes cleanly
- **Committed in:** fd8c5c3

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for TypeScript compilation. No scope creep.

## Issues Encountered

None beyond the type augmentation deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Persona plugin is fully functional: Schema config in Koishi Console, preset selection, field overrides, prompt injection
- Phase 32 complete — persona customization UX delivers intuitive alternative to single SOUL file

## Self-Check: PASSED

- FOUND: 32-02-SUMMARY.md
- FOUND: plugins/persona/src/index.ts
- FOUND: fd8c5c3 (Task 1+2 commit)

---

_Phase: 32-persona-customization-ux_
_Completed: 2026-02-27_
