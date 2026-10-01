# Person memory implementation plan

Goal: implement #196 as an optional plugin with administrator control through recognition and profile maintenance.

Architecture: scene-scoped state in Koishi DB, immutable audit deltas and evidence snapshots; bounded background summaries; existing tool and prompt injection services.

Tech stack: TypeScript, Koishi/Minato, Node test runner, SQLite, existing YIB model service.

Spec: `docs/superpowers/specs/2026-10-01-person-memory.md`.

## Global Constraints

No cross-scene reads or writes. Original message senders remain unchanged. Model proposals cannot alter identity or bypass locks. Human edits invalidate stale proposals. State and audit commit atomically. Bounded work and unload cancellation. README describes operation, not development workflow.

## Review Focus

Check direct-message scene identifiers, multi-bot isolation, compare-and-set semantics on actual SQLite, rollback reference integrity, stale proposals after rebind, prompt second-pass Mustache rendering, background cancellation races, command authority enforcement and schema bounds.

### Task 1: persistence and identity

Write and run failing store tests using SQLite; implement scene key, schema, evidence, normalized state, CAS transaction, UUID people, associations, profile/lock operations, merge/split, candidate review, audit and conditional rollback. Run `node --test packages/person-memory/tests/store.test.cjs`; expected failing before implementation and passing after. Commit the tested storage changes.

### Task 2: summary worker and context

Write failing tests for bounded background processing, model errors, timeout/unload cancellation and escaping/scoped active-person context. Implement worker and rendering helpers and disposable prompt injection registration. Run `node --test packages/person-memory/tests/worker.test.cjs packages/person-memory/tests/context.test.cjs`; expected passing after implementation. Commit.

### Task 3: plugin tools and administrator commands

Write failing plugin registration and execution tests. Implement optional configuration, scene-filtered message capture, model read/propose tools and administrator commands for the full lifecycle. Run plugin tests and all package tests; expected passing. Commit.

### Task 4: delivery

Document install/configuration, every command and model authority, evidence retention and limits, OneBot lookup example. Build core and package, run package and existing extension suites; compare core failures to clean baseline. Request one independent whole-branch review, fix meaningful findings with regression tests, commit and provide a reviewable branch and installable package.
