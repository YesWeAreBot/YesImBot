# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-19)

**Core value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。
**Current focus:** Milestone v2 — 功能平替

## Current Position

Phase: 9 (Dynamic Schema Linkage)
Plan: 1 complete
Status: Plan 09-01 complete
Last activity: 2026-02-20 — 09-01 executed (listModels + refreshSchemas)

## Performance Metrics

**Velocity:**

- Total plans completed: 6
- Average duration: 2.8 minutes
- Total execution time: 0.28 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
| ----- | ----- | ----- | -------- |
| 01    | 2     | 392s  | 196s     |
| 02    | 2     | 268s  | 134s     |
| 03    | 1     | 84s   | 84s      |
| 04    | 1     | 300s  | 300s     |

**Recent Trend:**

- Last 5 plans: 01-02 (134s), 02-01 (160s), 02-03 (108s), 03-01 (84s)
- Trend: Improving

_Updated after each plan completion_
| Phase 03-horizon-context-system P03 | 300 | 2 tasks | 3 files |
| Phase 08-stream-support-dead-code-cleanup P02 | 56 | 1 tasks | 1 files |
| Phase 09-dynamic-schema-linkage P01 | 178 | 2 tasks | 4 files |

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
- [04-01]: Config-provided templates override built-in defaults (config > registerTemplate priority)
- [04-01]: Snippets evaluated lazily — only those whose keys appear in the template are called
- [04-01]: Injections sorted ascending by priority, joined with double newline into scope.injections
- [04-01]: MustacheRenderer sets Mustache.escape = identity to disable HTML escaping globally
- [04-02]: experimentalDecorators added to tsconfig.base.json for legacy TS decorator support
- [04-02]: Schema.dict (not schema.list) stores object properties in Koishi Schema
- [04-02]: Plugin base class reads **staticTools/**staticActions from prototype in constructor
- [04-02]: Promise.race with setTimeout for invoke() timeout — no external dependency
- [05-01]: ai-sdk v6 has no tool() function — Tool is plain object with inputSchema field
- [05-01]: ToolSet from ai used as return type for buildAiSdkTools (avoids transitive @ai-sdk/provider-utils import)
- [05-01]: finishTool included in buildAiSdkTools output under 'finish' key
- [05-01]: enqueue uses .finally() with reference equality to avoid premature queue cleanup
- [05-02]: Config interface does not extend AgentCoreConfig — fields declared inline to avoid Schema type inference conflict
- [05-02]: ThinkActLoop.run() takes Percept with PerceptType.UserMessage type guard before buildView()
- [05-02]: as CallParams cast passes tools/toolChoice/stopWhen through ModelService spread at runtime
- [06-01]: maxOutputTokens (not maxTokens) for ai-sdk v6 LLM judge call
- [06-01]: WillingnessCalculator is plain class, not Koishi Service — no lifecycle overhead needed
- [06-01]: gateAndEnqueue wraps entire body in try/catch to prevent unhandled rejections
- [06-02]: reportError swallows its own send errors to prevent infinite error loops
- [06-02]: Fallback delay uses fallbackText.trim().length — sentContent declared after the check
- [06-02]: Inter-part delay in send_message tool, not in loop — separation of concerns
- [07-01]: Private field named 'log' not 'logger' — Service base class already exposes public 'logger' property
- [07-01]: DEFAULT_SYSTEM_TEMPLATE uses {{view.self.name}} and {{#view.environment}} matching v4 HorizonView scope
- [08-01]: streamCall queue slot released when streamText() returns — stream is lazy, HTTP established not fully consumed
- [08-01]: callParams assembled once before stream/generate branch — both paths share same params object
- [08-01]: Lifecycle order after response: markAsActive → archiveStale → recordAgentSummary
- [Phase 08]: MODEL-01/02/03 corrected from Pending to Complete — provider packages exist and are functional
- [Phase 08]: AGENT-03 and HORIZON-02 marked Partial — Phase 8 Plan 01 will complete them
- [Phase 08]: PLATFORM-01 marked Partial — Koishi Service pattern used throughout but no formal integration test
- [Phase 09-dynamic-schema-linkage]: Schema<string>[] typed array allows mixing Schema.const and Schema.string in union without type errors
- [Phase 09-dynamic-schema-linkage]: Context.current gives caller context for dispose hook — auto-unregisters provider on plugin unload

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-20
Stopped at: Completed 09-01-PLAN.md
Resume file: .planning/phases/09-dynamic-schema-linkage/09-01-SUMMARY.md
