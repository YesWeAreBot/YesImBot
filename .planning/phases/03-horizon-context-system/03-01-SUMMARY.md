---
phase: 03-horizon-context-system
plan: "01"
subsystem: horizon
tags: [types, database, timeline, event-manager]
dependency_graph:
  requires: []
  provides: [horizon-types, event-manager]
  affects: [03-02, 03-03]
tech_stack:
  added: []
  patterns: [koishi-database-as-any, random-id-generation]
key_files:
  created:
    - plugins/core/src/services/horizon/types.ts
    - plugins/core/src/services/horizon/event-manager.ts
  modified: []
decisions:
  - "as any casts for yesimbot.timeline table name — schema declared in Plan 03 service"
  - "TimelineEventType limited to Message + AgentSummary per v4 scope decision"
  - "SelfInfo simplified to id+name only (no avatar/platform)"
metrics:
  duration: 84s
  completed: 2026-02-18
---

# Phase 3 Plan 01: Horizon Type Definitions and EventManager Summary

Horizon data model (Scope/Entity/Event/Observation/Percept/HorizonView) and EventManager Timeline CRUD with scope-filtered queries and time-window retrieval.

## Tasks Completed

| #   | Name                                         | Commit  | Files                                              |
| --- | -------------------------------------------- | ------- | -------------------------------------------------- |
| 1   | Create Horizon type definitions              | 743a0e6 | plugins/core/src/services/horizon/types.ts         |
| 2   | Create EventManager for Timeline persistence | ee2a3cd | plugins/core/src/services/horizon/event-manager.ts |

## Decisions Made

- `as any` casts on `yesimbot.timeline` table name: Koishi's `Tables` interface doesn't include this table until the schema is declared in Plan 03. Using `as any` is the correct approach per plan instructions.
- `TimelineEventType` reduced to `Message` and `AgentSummary` only — all dev-version agent activity types removed per v4 scope decision.
- `SelfInfo` simplified to `{ id, name }` — no avatar or platform fields needed at this layer.

## Deviations from Plan

None — plan executed exactly as written.
