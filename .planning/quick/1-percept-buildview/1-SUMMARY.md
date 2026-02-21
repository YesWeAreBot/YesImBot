---
phase: quick
plan: 1
subsystem: core/services
tags: [types, refactor, shared-types, buildView]
dependency_graph:
  requires: []
  provides: [shared-types, percept-input, simplified-buildView]
  affects: [agent, horizon, plugin]
tech_stack:
  added: []
  patterns: [shared-type-module, re-export-backward-compat]
key_files:
  created:
    - core/src/services/shared/types.ts
  modified:
    - core/src/services/agent/types.ts
    - core/src/services/horizon/types.ts
    - core/src/services/horizon/listener.ts
    - core/src/services/horizon/service.ts
    - core/src/services/agent/loop.ts
    - core/src/services/agent/service.ts
decisions:
  - PerceptInput in shared/types.ts alongside BasePerceptRef for co-location
  - Re-exports in agent/types.ts and horizon/types.ts preserve all existing consumers
metrics:
  duration: ~2.5min
  completed: 2026-02-21
---

# Quick Task 1: Percept BuildView Refactor Summary

Shared type extraction (TriggerType, Scope, BasePerceptRef) into shared/types.ts and buildView simplified to single PerceptInput argument.

## What Was Done

### Task 1: Extract shared types (6675160)

Moved `TriggerType`, `Scope`, and `BasePerceptRef` from their original locations (agent/types.ts and horizon/types.ts) into a new `core/src/services/shared/types.ts`. Updated all import paths. Added re-exports in both agent/types.ts and horizon/types.ts for backward compatibility.

### Task 2: Simplify buildView signature (1cb9893)

Added `PerceptInput` interface (extends `BasePerceptRef` with optional `runtime`). Changed `buildView(percept, runtime?)` to `buildView(percept: PerceptInput)`. Updated both call sites in agent/loop.ts and agent/service.ts.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. `yarn typecheck` passes with zero errors
2. No two-argument `buildView` calls remain
3. No `horizon/ -> agent/types` imports exist
4. `agent/service.ts -> horizon/types` is one-directional only (HorizonMessageEvent for event handling)

## Commits

| Task | Commit  | Description                                          |
| ---- | ------- | ---------------------------------------------------- |
| 1    | 6675160 | Extract shared types into shared/types.ts            |
| 2    | 1cb9893 | Simplify buildView to single PerceptInput argument   |

## Self-Check: PASSED

- FOUND: commit 6675160
- FOUND: commit 1cb9893
- FOUND: core/src/services/shared/types.ts
- FOUND: 1-SUMMARY.md
