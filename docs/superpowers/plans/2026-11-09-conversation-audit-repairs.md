# Conversation Audit Repairs Implementation Plan

> **For agentic workers:** Execute each independently owned repair with a failing regression, a minimal implementation, and verification before integration.

**Goal:** Repair confirmed conversation, reset, memory, delivery and diagnostic defects in the November 9 evidence.

**Architecture:** A shared history-reset lifecycle coordinates the core and registered extensions. Other repairs preserve runtime configuration paths and remove diagnostic duplication while retaining message and tool provenance.

**Tech Stack:** TypeScript, Koishi, Vitest, Yarn/Yakumo.

**Spec:** `2026-11-09-conversation-reset-spec.md` in this directory.

## Global Constraints

- Preserve user settings, persona text, scope authorization, and unrelated domains.
- No real history clearing, external model calls, or private evidence publication during verification.
- Publish only tested code to the existing fork integration branch; no new PR.

## Review Focus

- A capture begun before clearing must not enqueue after clearing.
- Late responses and already accepted writes must not resurrect deleted data.
- Audit replay and persistent retries must not recreate purged profiles after restart.
- ID-only multipart receipts must not invent message content.
- Removing diagnostics must preserve required tool results and conversation context.

## Tasks

### 1. Core reset and L3 lifecycle

Files: `world/commands.ts`, new reset coordination module, `agent/index.ts`, `agent/scheduler.ts`, `world/l3-archival-memory.ts`, corresponding tests.

- [ ] Reproduce queued stimulus/assessment surviving clear and repeated L3 failure fanout.
- [ ] Register clear participants; synchronously invalidate old work before asynchronous preparation, drain writes and release maintenance state in finally.
- [ ] Reset transient agent state, cancel L3 work, add bounded failure cooldown and owner-level logging.
- [ ] Verify late results are rejected and fresh messages work after clear.

### 2. Person memory

Files: `packages/person-memory/src/{index,shared-runtime,worker,store,summary-queue,profile-tools,profile-prompt}.ts`, tests.

- [ ] Reproduce list defaults, cached invalid candidate reuse, and clear during capture/model/commit.
- [ ] Join task 1 lifecycle through explicit participant registration; purge only owned scopes under the store serial barrier.
- [ ] Reset queues, timers and persisted candidates; validate/correct invalid output within a finite budget; declare existing profile limits in the generator prompt.
- [ ] Verify both modes, restart behavior, audit reconstruction and unrelated scope preservation.

### 3. Model input and visuals

Files: `agent/context-builder.ts`, `agent/context-packing.ts`, `agent/heartbeat-processor.ts` rendering, world history projection, prompt templates, tests.

- [ ] Reproduce forced budget injection, duplicate observations and skipped recent images.
- [ ] Remove forced internal reporting, deduplicate diagnostic representations and retain bounded new image provenance.
- [ ] Verify final native/JSON requests, image scope and clear invalidation; preserve tool causality and user templates.

### 4. Delivery provenance

Files: `agent/reply-turn.ts`, `extension/builtin/core-util/index.ts`, `world/event-listener.ts`, tool event projection, tests.

- [ ] Reproduce successful ID-only encoder output missing history content.
- [ ] Recover unambiguous sent content without attributing full content to ambiguous multipart receipts.
- [ ] Verify partial delivery, cancellation and read-back using actual encoder boundaries.

### 5. Failure classification and maintenance

Files: `model/service.ts`, native heartbeat error branch, `world/history-inspection.ts`, usage owner plumbing, decision journal, tests.

- [ ] Reproduce deterministic HTTP rejection retries, native-call error misclassification and implicit dependency warnings.
- [ ] Classify terminal versus transient errors, retain bounded native correction, pass existing service dependencies explicitly.
- [ ] Evaluate stale-lock recovery using provable ownership; preserve conservative behavior for ambiguous locks.
- [ ] Verify transient retries, cancellation and no replay of side effects.

### 6. Integration

- [ ] Independently review merged lifecycle and source projection boundaries.
- [ ] Run full Vitest suite, build, client typecheck, lint and format checks.
- [ ] Verify packed installations and actual Koishi lifecycle; inspect console if settings change.
- [ ] Publish with expected-head guard and compare remote tree to tested tree.
