# Roadmap: Athena (YesImBot v4)

## Milestones

- ✅ **v1.0 Foundation + Feature Parity** — Phases 1-15 (shipped 2026-02-21)
- ✅ **v2.0 Context-Aware Architecture** — Phases 16-19 (shipped 2026-02-23)
- ✅ **v2.1 Polish & Release Prep** — Phases 20-22 (shipped 2026-02-24)
- ◆ **v2.2 Runtime Optimization & Observability** — Phases 23-25 (active)

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

### v2.2 Runtime Optimization & Observability (Phases 23-25)

- [x] **Phase 23: Bug Fixes & Reliability** — Snippet rendering fix, JSON parser test suite, DM willingness handling (completed 2026-02-24)
- [ ] **Phase 24: Observability** — Full-chain trace IDs, structured debug logging, Judge prompt improvement
- [ ] **Phase 25: Optimization** — Working memory layout, prompt cache with SystemModelMessage[]

## Phase Details

### Phase 23: Bug Fixes & Reliability
**Goal**: The agent renders prompts correctly, handles DMs naturally, and the JSON parser has test coverage preventing silent failures
**Depends on**: Phase 22 (v2.1 complete)
**Requirements**: BUGFIX-01, BUGFIX-02, WILL-01, WILL-02
**Success Criteria** (what must be TRUE):
  1. `{{date.now}}`, `{{bot.name}}`, and all other snippet variables appear with correct values in the rendered horizon-view output — no empty strings
  2. The JSON parser test suite runs via `vitest` and passes all 18 cases covering perfect JSON, code blocks, nested code blocks, `[OBSERVE]` prefix, truncated strings, and dangling keys
  3. A private message to the bot receives a reply with high probability, using a longer aggregation window to wait for the user to finish sending multiple messages before responding — not every single DM triggers a response
  4. Rapid DM sequences are rate-limited per user so cost cannot explode from unthrottled private chat
**Plans**: 4 plans
Plans:
- [x] 23-00-PLAN.md — Wave 0: Test scaffolds for BUGFIX-01, WILL-01, WILL-02 (RED tests)
- [ ] 23-01-PLAN.md — Install vitest + port v3 JSON parser test suite (18 cases)
- [ ] 23-02-PLAN.md — Fix snippet variable rendering in horizon-view
- [ ] 23-03-PLAN.md — DM adaptive aggregation window + per-user token bucket rate limiting

### Phase 24: Observability
**Goal**: Every message processing flow is traceable end-to-end and the willingness judge makes better-calibrated decisions
**Depends on**: Phase 23
**Requirements**: OBS-01, OBS-02, OBS-03, WILL-03
**Success Criteria** (what must be TRUE):
  1. Each incoming message produces a `traceId` visible in logs across listener, willingness, agent loop, model call, parser, and reply — a single grep on the traceId shows the full flow
  2. Setting `KOISHI_DEBUG=agent.willingness` shows only willingness logs; `KOISHI_DEBUG=agent.loop` shows only loop logs — namespaces filter independently
  3. Debug logs include: willingness score breakdown, prompt section byte sizes, model call latency and token counts, JSON parse outcome, and tool execution results
  4. The Judge prompt includes a persona summary and structured output format — responses are no longer bare `yes`/`no` strings and include reasoning context
**Plans**: 2 plans
Plans:
- [ ] 24-01-PLAN.md — TraceId threading + namespace loggers + structured debug logging (OBS-01, OBS-02, OBS-03)
- [ ] 24-02-PLAN.md — Judge prompt upgrade with persona summary + structured JSON output (WILL-03)

### Phase 25: Optimization
**Goal**: The agent's working memory is temporally coherent and the system prompt is cached at the provider level to reduce token costs
**Depends on**: Phase 24
**Requirements**: OPT-01, OPT-02, OPT-03, OPT-04
**Success Criteria** (what must be TRUE):
  1. Working memory tool entries are annotated with their trigger position in the conversation history (timestamp or message ID), so the LLM understands the causal link between tool execution and the chat context — not just opaque "Round N" labels
  2. `send_message` entries in working memory omit the full message content when that content already appears in the conversation history — only the execution result summary is retained
  3. On Anthropic providers, the system prompt is sent as `SystemModelMessage[]` with a cache breakpoint after the `instructions` section — cache hit/miss is observable in response headers or debug logs
  4. On non-Anthropic providers (OpenAI, DeepSeek), the system prompt falls back to string concatenation with no behavioral change
**Plans**: TBD
**Note**: Requires phase research — verify `providerOptions` cache control format against current Anthropic API docs before implementing OPT-01/OPT-02

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-15 | v1.0 | 29/29 | Complete | 2026-02-21 |
| 16-19 | v2.0 | 16/16 | Complete | 2026-02-23 |
| 20-22 | v2.1 | 6/6 | Complete | 2026-02-24 |
| 23. Bug Fixes & Reliability | 4/4 | Complete    | 2026-02-24 | — |
| 24. Observability | v2.2 | 0/2 | Planning complete | — |
| 25. Optimization | v2.2 | 0/? | Not started | — |
