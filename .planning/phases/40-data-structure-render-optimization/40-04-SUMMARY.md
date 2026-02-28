---
phase: 40-data-structure-render-optimization
plan: "04"
subsystem: horizon
tags: [refactor, environment, decoupling]
dependency_graph:
  requires: []
  provides: [EnvironmentManager]
  affects: [HorizonService]
tech_stack:
  added: []
  patterns: [standalone-manager-class, delegation]
key_files:
  created:
    - core/src/services/horizon/environment.ts
  modified:
    - core/src/services/horizon/service.ts
decisions:
  - EnvironmentManager takes cacheTtl in constructor — avoids coupling to HorizonServiceConfig shape
  - JsonDB import removed from service.ts — only EnvironmentManager owns the DB instance now
metrics:
  duration: 4min
  completed_date: "2026-02-28"
  tasks_completed: 1
  files_changed: 2
---

# Phase 40 Plan 04: EnvironmentManager Extraction Summary

**One-liner:** Extracted Environment management from HorizonService into standalone EnvironmentManager class backed by JsonDB, with HorizonService delegating via `this.environments.getOrCreate()`.

## Tasks Completed

| #   | Task                                                                        | Commit  | Files                            |
| --- | --------------------------------------------------------------------------- | ------- | -------------------------------- |
| 1   | Create EnvironmentManager and extract environment logic from HorizonService | 6fe5e04 | environment.ts (new), service.ts |

## What Was Done

Created `core/src/services/horizon/environment.ts` with `EnvironmentManager` class that owns:

- The `JsonDB` instance for `environments.json`
- The `cacheTtl` parameter
- The `getOrCreate(key, session)` logic (pure extraction from `getOrCreateEnvironment`)

Updated `core/src/services/horizon/service.ts`:

- Replaced `private environmentDB: JsonDB<...>` field with `private environments: EnvironmentManager`
- Constructor now calls `new EnvironmentManager(ctx, config.entityCacheTtl)` instead of `new JsonDB(...)`
- `buildView()` calls `this.environments.getOrCreate()` instead of `this.getOrCreateEnvironment()`
- Removed `private async getOrCreateEnvironment()` method entirely
- Removed `JsonDB` import (no longer used in service.ts)

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx tsc --noEmit -p core/tsconfig.json` passes cleanly
- `environment.ts` exports `EnvironmentManager` class
- `service.ts` has no `environmentDB` field
- `service.ts` has no `getOrCreateEnvironment` private method
- `service.ts` calls `this.environments.getOrCreate()`
- Entity table schema unchanged (already normalized — confirmed)

## Self-Check: PASSED

- environment.ts: FOUND
- service.ts: FOUND
- commit 6fe5e04: FOUND
