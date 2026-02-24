# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。
**Current focus:** Phase 22 — Skill Enhancement & Tech Debt

## Current Position

Phase: 22 of 23 (Skill Enhancement & Tech Debt)
Plan: 1 of 2 in current phase
Status: Executing Phase 22
Last activity: 2026-02-24 — Completed 22-01 (Skill injection point routing)

Progress: v1.0 ✅ | v2.0 ✅ | v2.1 [██████░░░░] 60%

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
- [20-01]: Removed old default injections from constructor — Phase 21 fills content via SOUL.md/AGENTS.md
- [20-02]: render() assembles XML tags inline — no Mustache partials for prompt structure
- [20-02]: Empty injection points always emit tags for structural consistency
- [21-01]: English defaults with natural tone, Markdown ## headings for RAG chunking
- [21-01]: SOUL.md covers identity/personality/style; AGENTS.md covers control-flow/format/group-chat; TOOLS.md covers tool mechanics
- [21-02]: Used Mustache.render() directly (same as MemoryService) rather than MustacheRenderer wrapper
- [21-02]: Fixed loop.ts __default_soul -> __role_soul for skill style override ordering
- [22-01]: injectionPoint defaults to 'extra', styleInjectionPoint defaults to 'soul' — backward compatible
- [22-01]: Active skills sorted by specificity descending before prompt injection concatenation

### Pending Todos

None.

### Blockers/Concerns

- Mustache renders missing partials as empty string — validate partial existence at boot

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 1 | 优化类型定义和接口：统一Percept类型，简化buildView参数 | 2026-02-21 | 3977997 | | [1-percept-buildview](./quick/1-percept-buildview/) |
| 2 | 使用gray-matter替换js-yaml和自定义解析实现。与memory_block模块和skill模块集成。 | 2026-02-23 | bc8184a | Verified | [2-gray-matter-js-yaml-memory-block-skill](./quick/2-gray-matter-js-yaml-memory-block-skill/) |
| 3 | Fix agent JSON output drift: unify format spec, improve raw-text fallback | 2026-02-23 | b030d54 | Verified | [3-fix-unexpected-agent-outputs-agent-stops](./quick/3-fix-unexpected-agent-outputs-agent-stops/) |
| Phase 22 P01 | 3min | 2 tasks | 4 files |

## Session Continuity

Last session: 2026-02-24 09:37
Stopped at: Completed 22-01-PLAN.md (Skill injection point routing)
Resume file: None
