# Background Tool Tasks Implementation Plan

> **For agentic workers:** Use independent implementation lanes and a fresh whole-branch reviewer. Steps use checkbox syntax for tracking.

**Goal:** Allow selected tools to run in the background without blocking conversation processing.

**Architecture:** An instance-owned bounded task registry holds progress and results. ToolService supplies scoped execution and management tools; AgentCore consumes completion signals through existing scheduling and willingness gates.

**Tech Stack:** TypeScript, Koishi, AsyncLocalStorage, Vitest; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-background-tool-tasks-design.md`

## Global Constraints

Default off. Preserve XML, serial direct calls, per-instance/bot/conversation isolation, history-generation fences and administrator overrides. Comments and documentation describe code behavior only.

## Review Focus

- Foreground cancellation must not cancel an accepted independent task.
- Uncooperative external work must not free its concurrency slot prematurely.
- Fast sibling tasks must settle a request bonus only after submission closes.
- Busy skip/deferred policies must not lose task-completion events.
- History clear, authorization changes and lifecycle stop must reject stale results and reads.

### Task 1: Task registry

Files: new `packages/core/src/extension/background-tasks.ts`, new registry tests.

- [x] Write deferred-promise tests for progress, cancellation, timeout, ownership, concurrency and sealed request settlement; run RED.
- [x] Implement bounded registry and immutable snapshots; run GREEN.

### Task 2: Policy and scheduling

Files: agent/config.ts, willing.ts, scheduler.ts and focused tests.

- [x] Write tests for independent completion queues and willingness without source-message scoring; run RED.
- [x] Add configuration and dedicated probability/bonus methods; run GREEN.

### Task 3: Execution and context

Files: extension types/decorators/service, search/core-util capability metadata, agent heartbeat/context/core, world template/type declarations and new integration tests.

- [x] Test actual ToolService invocation: opt-in, native/JSON request grouping, foreground detachment, progress, model/admin query/cancel, context injection, stale receipt suppression.
- [x] Implement fresh session execution, unconditional result generation fences, bounded snapshots and lifecycle invalidation.
- [x] Run targeted integration tests and full suite.

### Task 4: Delivery verification

- [x] Review entire diff independently and resolve material findings with reproducing tests.
- [x] Run full tests, build, formatting and lint; document limits in operator guide.
- [x] Commit locally and present concise change summary plus draft PR text for review; do not publish without authorization.

## Verification notes

Registry, policy, invocation, prompt, lifecycle and authority tests exercised cancellation, history fences, request closure, topic credit transfer and completion copies. Whole-feature review identified queued-event invalidation, tool-authorization invalidation and management-receipt generation gaps; each was reproduced before its fix.

The baseline commit 9416fc4 independently reproduces two failures in `chat-stream-errors.spec.ts`: `keeps a validator-approved early exit without an upstream finish frame` and `accepts only the validator's own early-exit abort reason`. The background feature does not modify the model stream implementation. These failures remain outside this change.
