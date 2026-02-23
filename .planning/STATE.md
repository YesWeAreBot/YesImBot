# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。
**Current focus:** Phase 20 — Injection Point Merge & Wrapper Elimination

## Current Position

Phase: 20 of 23 (Injection Point Merge & Wrapper Elimination)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-02-23 — Roadmap created for v2.1 milestone

Progress: v1.0 ✅ | v2.0 ✅ | v2.1 [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- v1.0: 15 phases, 29 plans, ~4 days
- v2.0: 8 phases, 16 plans, ~6 days

**By Phase:** See MILESTONES.md for breakdown.

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.
v2.0 decisions archived to milestones/v2.0-ROADMAP.md.

- [v2.1]: OpenClaw memory paradigm adopted (SOUL.md/AGENTS.md/TOOLS.md)
- [v2.1]: Injection points merged 6->4 (soul/instructions/memory/extra)
- [v2.1]: Vitest chosen over Jest (ESM-native, zero-config for bundler moduleResolution)

### Pending Todos

None.

### Blockers/Concerns

- Mustache renders missing partials as empty string — validate partial existence at boot
- system.mustache may become vestigial after wrapper partial elimination — clarify during Phase 20

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 1 | 优化类型定义和接口：统一Percept类型，简化buildView参数 | 2026-02-21 | 3977997 | | [1-percept-buildview](./quick/1-percept-buildview/) |
| 2 | 使用gray-matter替换js-yaml和自定义解析实现。与memory_block模块和skill模块集成。 | 2026-02-23 | bc8184a | Verified | [2-gray-matter-js-yaml-memory-block-skill](./quick/2-gray-matter-js-yaml-memory-block-skill/) |

## Session Continuity

Last session: 2026-02-23 11:08
Stopped at: Roadmap created for v2.1 milestone
Resume file: None
