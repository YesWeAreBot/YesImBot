# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。
**Current focus:** v2.2 Runtime Optimization & Observability

## Current Position

Phase: 23 — Bug Fixes & Reliability
Plan: 01 of 4
Status: In progress
Last activity: 2026-02-24 — Completed 23-00 test scaffolds

Progress: v1.0 ✅ | v2.0 ✅ | v2.1 ✅ | v2.2 ◆ (Phase 23/25)

## Performance Metrics

**Velocity:**
- v1.0: 15 phases, 29 plans, ~4 days
- v2.0: 8 phases, 16 plans, ~6 days
- v2.1: 3 phases, 6 plans, ~2 days
- v2.2: 3 phases planned, 0 complete

**By Phase:** See MILESTONES.md for breakdown.

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.
v2.0 decisions archived to milestones/v2.0-ROADMAP.md.
v2.1 decisions archived to milestones/v2.1-ROADMAP.md.

**v2.2 decisions:**
- memory_block → RoleService merge deferred to v2.3 (migration risk, not blocking any v2.2 feature)
- Prompt cache scoped to Anthropic-only first (other providers have different cache semantics)
- TraceContext threaded as explicit object (not AsyncLocalStorage — Koishi event system doesn't guarantee async context propagation)
- Phase 25 requires phase research before implementation (providerOptions format needs live API verification)

### Pending Todos

- Phase 25: Run phase research to verify Anthropic `providerOptions` cache control format before implementing OPT-01/OPT-02

### Blockers/Concerns

- `{{date.now}}` and all snippet variables render empty in horizon-view (BUGFIX-01) — confirmed live bug, critical path blocker for Phase 25
- Test coverage not yet established — BUGFIX-02 introduces vitest as first test infrastructure
- vitest installed, RED test scaffolds created for BUGFIX-01, WILL-01, WILL-02 (23-00 complete)

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 1 | 优化类型定义和接口：统一Percept类型，简化buildView参数 | 2026-02-21 | 3977997 | | [1-percept-buildview](./quick/1-percept-buildview/) |
| 2 | 使用gray-matter替换js-yaml和自定义解析实现。与memory_block模块和skill模块集成。 | 2026-02-23 | bc8184a | Verified | [2-gray-matter-js-yaml-memory-block-skill](./quick/2-gray-matter-js-yaml-memory-block-skill/) |
| 3 | Fix agent JSON output drift: unify format spec, improve raw-text fallback | 2026-02-23 | b030d54 | Verified | [3-fix-unexpected-agent-outputs-agent-stops](./quick/3-fix-unexpected-agent-outputs-agent-stops/) |
| Phase 22 P01 | 3min | 2 tasks | 4 files |
| Phase 22 P02 | 2min | 2 tasks | 2 files |

## Session Continuity

Last session: 2026-02-24
Stopped at: Completed 23-00-PLAN.md (test scaffolds)
Resume file: None
