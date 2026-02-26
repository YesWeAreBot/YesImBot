# Roadmap: Athena (YesImBot v4)

## Milestones

- ✅ **v1.0 Foundation + Feature Parity** — Phases 1-15 (shipped 2026-02-21)
- ✅ **v2.0 Context-Aware Architecture** — Phases 16-19 (shipped 2026-02-23)
- ✅ **v2.1 Polish & Release Prep** — Phases 20-22 (shipped 2026-02-24)
- ✅ **v2.2 Runtime Optimization & Observability** — Phases 23-25 (shipped 2026-02-25)
- ✅ **v2.3 Architecture Cleanup** — Phases 26-28 (shipped 2026-02-26)
- 🔷 **v2.4 Runtime & Polish** — Phases 29-31 (active)

## Phases

<details>
<summary>✅ v1.0 Foundation + Feature Parity (Phases 1-15) — SHIPPED 2026-02-21</summary>

- [x] Phase 1: Foundation & Shared Model (2/2 plans) — completed 2026-02-17
- [x] Phase 2: Model Service & Providers (3/3 plans) — completed 2026-02-18
- [x] Phase 3: Horizon Context System (3/3 plans) — completed 2026-02-18
- [x] Phase 4: Prompt & Tool Services (2/2 plans) — completed 2026-02-18
- [x] Phase 5: Agent Core & Integration (2/2 plans) — completed 2026-02-18
- [x] Phase 6: Willingness & Polish (2/2 plans) — completed 2026-02-18
- [x] Phase 7: Core Wiring Fixes (1/1 plan) — completed 2026-02-19
- [x] Phase 8: Stream Support & Dead Code Cleanup (2/2 plans) — completed 2026-02-19
- [x] Phase 9: Dynamic Schema Linkage (2/2 plans) — completed 2026-02-19
- [x] Phase 10: Willingness System Migration (2/2 plans) — completed 2026-02-19
- [x] Phase 11: Horizon Context Filling (1/1 plan) — completed 2026-02-20
- [x] Phase 12: Memory & Prompt Snippets (2/2 plans) — completed 2026-02-20
- [x] Phase 13: Non-stream Path & Fallback Wiring (2/2 plans) — completed 2026-02-20
- [x] Phase 14: Provider Pattern Cleanup & PLATFORM-01 (1/1 plan) — completed 2026-02-20
- [x] Phase 15: LLM Deferred Judgment & Config (2/2 plans) — completed 2026-02-20

</details>

<details>
<summary>✅ v2.0 Context-Aware Architecture (Phases 16-19) — SHIPPED 2026-02-23</summary>

- [x] Phase 16: PromptService Redesign + HorizonView (2/2 plans) — completed 2026-02-21
- [x] Phase 16.1: Percept Ownership & User Message Context (2/2 plans) — completed 2026-02-21
- [x] Phase 16.2: Percept Type Cleanup & Session Decoupling (2/2 plans) — completed 2026-02-21
- [x] Phase 16.3: Tool Call Improve (2/2 plans) — completed 2026-02-22
- [x] Phase 16.4: Working Memory Improve (2/2 plans) — completed 2026-02-22
- [x] Phase 17: Trait Perception (2/2 plans) — completed 2026-02-22
- [x] Phase 18: Skill Response (2/2 plans) — completed 2026-02-22
- [x] Phase 19: Integration & Validation (2/2 plans) — completed 2026-02-22

</details>

<details>
<summary>✅ v2.1 Polish & Release Prep (Phases 20-22) — SHIPPED 2026-02-24</summary>

- [x] Phase 20: Injection Point Merge & Wrapper Elimination (2/2 plans) — completed 2026-02-23
- [x] Phase 21: Fixed-Role File Loading (2/2 plans) — completed 2026-02-23
- [x] Phase 22: Skill Enhancement & Tech Debt (2/2 plans) — completed 2026-02-24

</details>

<details>
<summary>✅ v2.2 Runtime Optimization & Observability (Phases 23-25) — SHIPPED 2026-02-25</summary>

- [x] Phase 23: Bug Fixes & Reliability (4/4 plans) — completed 2026-02-24
- [x] Phase 24: Observability (2/2 plans) — completed 2026-02-25
- [x] Phase 25: Optimization (2/2 plans) — completed 2026-02-25

</details>

<details>
<summary>✅ v2.3 Architecture Cleanup (Phases 26-28) — SHIPPED 2026-02-26</summary>

- [x] Phase 26: Memory Cleanup (2/2 plans) — completed 2026-02-26
- [x] Phase 27: Scope Deletion & Module Migration (3/3 plans) — completed 2026-02-26
- [x] Phase 28: Environment Simplification & DB Schema (1/1 plan) — completed 2026-02-26

</details>

### v2.4 Runtime & Polish (Phases 29-31)

- [x] **Phase 29: Runtime Bug Fixes** — Eliminate three known runtime defects to establish a clean baseline
- [x] **Phase 30: Provider Architecture** — Extract BaseProvider abstraction to unify provider plugins (completed 2026-02-26)
- [x] **Phase 31: Model Groups + Config UX** — Add load-balanced model groups and improve config readability (completed 2026-02-26)

## Phase Details

### Phase 29: Runtime Bug Fixes

**Goal**: Three known runtime defects are eliminated and the system behaves correctly under message bursts, silence, and long conversations
**Depends on**: Nothing (surgical fixes, zero cross-phase dependencies)
**Requirements**: REQ-01, REQ-02, REQ-03
**Success Criteria** (what must be TRUE):

1. When messages arrive while a response is in-flight, they are queued and merged into a single follow-up response rather than triggering separate responses or being dropped
2. When the LLM chooses silence, no empty `[Bot Action]` record appears in the timeline
3. After many conversation rounds, working memory token count stays bounded — the initial user context block is trimmed like any other message
   **Plans**: 2 plans

- [x] 29-01-PLAN.md — Message queue backlog merge (REQ-01)
- [x] 29-02-PLAN.md — Silence rendering fix + trimmer initial context budget (REQ-02, REQ-03)

### Phase 30: Provider Architecture

**Goal**: All provider plugins share a common BaseProvider base class; duplicated registration and schema code is eliminated
**Depends on**: Phase 29
**Requirements**: REQ-05
**Success Criteria** (what must be TRUE):

1. A `BaseProvider` abstract class exists in `shared-model` encapsulating `listModels`, `getDefaultParams`, and the registration flow
2. A `createBaseProviderSchema()` factory generates the common config schema fields
3. All three provider plugins extend `BaseProvider` with no duplicated boilerplate
4. Existing provider external behavior is unchanged — no config migration required
   **Plans**: 2 plans

- [ ] 30-01-PLAN.md — Foundation (AbstractProvider + schema factory + type updates)
- [ ] 30-02-PLAN.md — Migration (convert all three providers + cleanup)

### Phase 31: Config UX

**Goal**: Improve Koishi Console config readability with labeled groups and i18n descriptions across core and provider plugins
**Depends on**: Phase 30
**Requirements**: REQ-06, REQ-07, REQ-08
**Success Criteria** (what must be TRUE):

1. The Koishi Console config panel shows items in labeled groups (基础、模型、意愿值、提示词、高级) rather than a flat list
2. Every config field has a Chinese description via i18n keys (not hardcoded)
3. Both `zh-CN` and `en-US` locale files exist for core and all provider plugins; Schema descriptions reference i18n keys
   **Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status     | Completed  |
| ----- | --------- | -------------- | ---------- | ---------- |
| 1-15  | v1.0      | 29/29          | Complete   | 2026-02-21 |
| 16-19 | v2.0      | 16/16          | Complete   | 2026-02-23 |
| 20-22 | v2.1      | 6/6            | Complete   | 2026-02-24 |
| 23-25 | v2.2      | 8/8            | Complete   | 2026-02-25 |
| 26-28 | v2.3      | 6/6            | Complete   | 2026-02-26 |
| 29    | v2.4      | Complete       | 2026-02-26 | 2026-02-26 |
| 30    | 2/2       | Complete       | 2026-02-26 | -          |
| 31    | 2/2       | Complete       | 2026-02-26 | -          |
