# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。
**Current focus:** Quick Task 1 — Percept BuildView Refactor (COMPLETE)

## Current Position

Phase: 16.1 (Percept Ownership & User Message Context Refactor)
Plan: 2/2
Status: Complete
Last activity: 2026-02-21 - Completed quick task 1: 优化类型定义和接口：统一Percept类型，简化buildView参数

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
- [16.1-01]: Percept types placed in agent/service.ts for locality, not separate types file
- [16.1-01]: HorizonView.percept narrowed to BasePerceptRef to avoid circular imports
- [16.1-01]: toStructured() removed; loop.ts uses formatHorizonText() directly
- [16.1-01]: buildView() accepts BasePerceptRef + optional runtime instead of UserMessagePercept
- [quick-1]: Shared types (TriggerType, Scope, BasePerceptRef) extracted to shared/types.ts
- [quick-1]: buildView() simplified to single PerceptInput argument (no separate runtime param)
- [16.1-02]: Observations split by stage: active/undefined->history, new->trigger
- [16.1-02]: environment.mustache emptied not deleted; environment kept in INJECTION_POINTS for future Skill reuse
- [16.1-02]: Single rendering path: all dynamic context via formatHorizonText -> horizon-view.mustache

### Pending Todos

None.

### Roadmap Evolution

- Phase 16.1 inserted after Phase 16: Percept Ownership & User Message Context Refactor (URGENT)

### Blockers/Concerns

- TraitAnalyzer service type TBD: Koishi Service vs plain class owned by AgentCore
- Skill hot-reload behavior during active conversations needs design

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | 优化类型定义和接口：统一Percept类型，简化buildView参数 | 2026-02-21 | 3977997 | [1-percept-buildview](./quick/1-percept-buildview/) |

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed Quick Task 1 (Percept BuildView Refactor)
Resume file: None
