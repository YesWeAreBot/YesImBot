---
phase: 10-willingness-system-migration
plan: 02
subsystem: agent
tags: [willingness, config, koishi-schema, integration]

requires: [10-01]
provides:
  - AgentCoreConfig with willingness field replacing old flat fields
  - Root Config with nested WillingnessSchema group
  - AgentCore wired to WillingnessEngine from config with ctx.setInterval decay timer
affects: [agent-core, root-config]

tech-stack:
  added: []
  patterns:
    - Nested Koishi Schema group for willingness config
    - ctx.setInterval for decay timer (auto-cancelled on dispose)

key-files:
  created: []
  modified:
    - plugins/core/src/services/agent/config.ts
    - plugins/core/src/services/agent/service.ts
    - plugins/core/src/services/agent/index.ts
    - plugins/core/src/index.ts

key-decisions:
  - "WillingnessEngine instantiated in start() from config.willingness with fallback defaults"
  - "ctx.setInterval (not raw setInterval) for decay timer — auto-cancelled on dispose"
  - "WillingnessSchema nested directly in root Schema.object — creates grouped UI in Koishi"

requirements-completed: [WILLING-01, WILLING-02, WILLING-03]

duration: 67s
completed: 2026-02-20
---

# Phase 10 Plan 02: Willingness System Migration Summary

**WillingnessEngine fully wired into AgentCore lifecycle — config-driven, decay timer via ctx.setInterval, old LLM-judge fields fully removed**

## Performance

- **Duration:** ~67s
- **Started:** 2026-02-19T19:41:47Z
- **Completed:** 2026-02-19T19:42:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Removed all six old willingness fields from `AgentCoreConfig` and root `Config`
- Added `willingness?: WillingnessConfig` to `AgentCoreConfig`
- `AgentCore.start()` instantiates `WillingnessEngine` from `config.willingness` and starts `ctx.setInterval` decay timer
- Root `Config` interface and `Schema` now have nested `willingness` group via `WillingnessSchema`
- `apply()` passes `config.willingness` through to `AgentCore`
- `WillingnessConfig` type exported from agent index

## Task Commits

1. **Task 1: Update AgentCoreConfig and AgentCore service** - `2150575` (feat)
2. **Task 2: Update root Config and Schema** - `2e55b79` (feat)

## Files Modified

- `plugins/core/src/services/agent/config.ts` - Removed old fields, added `willingness?: WillingnessConfig`
- `plugins/core/src/services/agent/service.ts` - Engine instantiated from config in `start()`, decay timer added
- `plugins/core/src/services/agent/index.ts` - Added `export type { WillingnessConfig }`
- `plugins/core/src/index.ts` - Removed old flat fields, added nested `willingness: WillingnessSchema`

## Decisions Made

- `WillingnessEngine` instantiated in `start()` with `config.willingness ?? defaults` — safe fallback if config omitted
- `ctx.setInterval` used for decay timer so it is auto-cancelled when AgentCore disposes
- `WillingnessSchema` nested directly in root `Schema.object` — creates a grouped section in Koishi UI

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Self-Check: PASSED
