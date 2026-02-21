# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。
**Current focus:** Phase 16.1 — Percept Ownership & User Message Context Refactor (NOT STARTED)

## Current Position

Phase: 16.1 (Percept Ownership & User Message Context Refactor)
Plan: 0/? (not planned yet)
Status: Not started
Last activity: 2026-02-21 — Inserted Phase 16.1 (urgent architectural refactor)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 29 (v1.0)
- Average duration: ~20 min (v1.0 baseline)
- Total execution time: ~9.7 hours (v1.0)

**By Phase:** See MILESTONES.md for v1.0 breakdown.

*Updated after each plan completion*

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.0]: Trait + Skill replaces ChatMode (continuous multi-dimensional vs discrete mode switching)
- [v2.0]: PromptService redesign is critical-path dependency — must come first
- [v2.0]: No new dependencies needed (Mustache, js-yaml, node:fs sufficient)
- [16-01]: Kahn's algorithm for before/after chain ordering with cycle fallback to registration order
- [16-01]: Promise.allSettled with per-entry timeout for parallel injection rendering
- [16-01]: Cacheable: identity/style/core_memories=true, working_memory/environment/extra=false
- [16-02]: Environment data formatted as text in ThinkActLoop, not complex Mustache templates
- [16-02]: how_you_work folded into default identity injection (only 6 injection points)
- [16-02]: User message simplified to trigger type + content; full context in system prompt
- [16.1]: System prompt 纯静态（identity/style/memories），user message 承载全部动态工作负载
- [16.1]: 统一模板路径：horizon-view.mustache 渲染 user message，删除 toStructured() + envLines 手工拼接
- [16.1]: Percept 构造从 horizon 移到 agent 模块；horizon 只广播原始事件，不参与决策
- [16.1]: Percept 语义 = "已决定要响应的触发源"，一旦构造必定触发响应
- [16.1]: aggregation window 从 listener 移到 agent（属于调度决策，非数据层职责）

### Pending Todos

None.

### Roadmap Evolution

- Phase 16.1 inserted after Phase 16: Percept Ownership & User Message Context Refactor (URGENT)

### Blockers/Concerns

- TraitAnalyzer service type TBD: Koishi Service vs plain class owned by AgentCore
- Skill hot-reload behavior during active conversations needs design

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 16-02-PLAN.md (Templates, HorizonView, Consumer Migration) — Phase 16 complete
Resume file: None
