# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-17)

**Core value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。
**Current focus:** Phase 4 - Prompt & Tool Services

## Current Position

Phase: 4 of 6 (Prompt & Tool Services)
Plan: 0 of 2 in current phase
Status: Context gathered, ready for planning
Last activity: 2026-02-18 — Phase 4 context gathered

Progress: [██████░░░░] 50%

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: 2.7 minutes
- Total execution time: 0.25 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
| ----- | ----- | ----- | -------- |
| 01    | 2     | 392s  | 196s     |
| 02    | 2     | 268s  | 134s     |
| 03    | 1     | 84s   | 84s      |

**Recent Trend:**

- Last 5 plans: 01-02 (134s), 02-01 (160s), 02-03 (108s), 03-01 (84s)
- Trend: Improving

_Updated after each plan completion_
| Phase 03-horizon-context-system P03 | 300 | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- ai-sdk replaces xsai for better ecosystem support
- Provider plugin pattern to avoid configuration complexity
- Horizon architecture for context management (Environment/Entity/Event)
- v1 focuses on functional skeleton without memory system
- Type-only ai-sdk dependency to prevent runtime bundling (01-01)
- Optional zod peer dependency to avoid forcing consumers to install it (01-01)
- Koishi 4.x plugin structure with name/Config/apply exports (01-02)
- workspace:\* protocol for shared-model dependency (01-02)
- TypeScript project references for cross-package compilation (01-02)
- pkgroll for consistent build tooling across packages (01-02)
- Service subclass pattern for auto-registration (02-01)
- p-queue for concurrency control with default 5 (02-01)
- Fallback chain keyed by provider:model format (02-01)
- Usage tracking per provider:model (02-01)
- [Phase 02]: DeepSeek uses OpenAI-compatible API via createOpenAI with custom baseURL
- [Phase 02]: Default models: deepseek-chat (with tool calling), deepseek-reasoner (streaming only)
- [Phase 03]: No complex Observation transform layer — simple message history concatenation
- [Phase 03]: Environment/Entity/Event as "enriched cache" of Koishi session, not redundant abstraction
- [Phase 03]: Hybrid prompt: Horizon view (aggregated context) + standard multi-turn (tool calls)
- [Phase 03]: Entity carries cross-channel continuity, Environment stays channel-isolated
- [Phase 03]: Agent response compressed to single summary Event in Timeline
- [Phase 03]: Message aggregation before trigger (prevent bot spam in group chat)
- [03-01]: as any casts for yesimbot.timeline — schema declared in Plan 03 service
- [03-01]: TimelineEventType limited to Message + AgentSummary per v4 scope
- [03-02]: Declaration merging extends Koishi Events for after-send and horizon/percept type safety
- [03-02]: ctx.setTimeout (not raw setTimeout) for aggregation timers — auto-cancelled on dispose
- [03-02]: Direct messages bypass aggregation window and emit Percept immediately
- [03-03]: Config interface extends HorizonConfig to merge sub-plugin config into parent schema
- [03-03]: Service base class logger used directly — no private logger field override

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-18
Stopped at: Phase 4 context gathered
Resume file: .planning/phases/04-prompt-tool-services/04-CONTEXT.md
