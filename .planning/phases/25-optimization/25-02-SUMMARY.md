---
phase: 25-optimization
plan: 02
subsystem: model
tags: [anthropic, prompt-cache, cache_control, provider, system-prompt, ai-sdk]

requires:
  - phase: 25-optimization/25-01
    provides: Section[] render() API in PromptService, loop.ts wmLines builder

provides:
  - System prompt split into stable (soul+instructions) and dynamic (memory+extra) sections
  - Anthropic provider gets SystemModelMessage[] with cacheControl ephemeral on stable block
  - Non-Anthropic providers get plain string concatenation (stable-first for prefix cache)
  - provider-anthropic package with AnthropicProvider (providerType = "anthropic")
  - Cache hit/miss logging via cacheWriteTokens/cacheReadTokens in ModelService

affects: [any phase touching loop.ts system prompt, model service call params, provider registration]

tech-stack:
  added: ["@ai-sdk/anthropic@3.0.47 (providers/provider-anthropic)"]
  patterns:
    - "System prompt split: soul+instructions = stable (cacheable), memory+extra = dynamic"
    - "Provider detection via IModelProvider.providerType field (not model ID inference)"
    - "Anthropic cache_control: providerOptions.anthropic.cacheControl.type = ephemeral on stable block"
    - "Cache logging: debug-level log when cacheWriteTokens or cacheReadTokens > 0"

key-files:
  created:
    - providers/provider-anthropic/src/index.ts
    - providers/provider-anthropic/package.json
    - providers/provider-anthropic/tsconfig.json
  modified:
    - core/src/services/agent/loop.ts
    - core/src/services/model/service.ts

key-decisions:
  - "Provider type detected via providerType field on IModelProvider — never inferred from model ID"
  - "Stable block uses ephemeral cache_control (not persistent) — matches Anthropic's recommended pattern for system prompts"
  - "Non-Anthropic providers receive plain string (stable+dynamic joined) — no behavioral change"
  - "Cache logging fires only when tokens > 0 — no noise on non-Anthropic calls"

patterns-established:
  - "providerType = 'anthropic' is the sentinel for cache injection in loop.ts"
  - "provider-anthropic mirrors provider-openai structure exactly (same Config shape, same apply() pattern)"

requirements-completed: [OPT-01, OPT-02]

duration: 4min
completed: 2026-02-25
---

# Phase 25 Plan 02: System Prompt Caching Summary

**Anthropic prompt cache_control injection via stable/dynamic system prompt split, with new provider-anthropic package using @ai-sdk/anthropic**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-02-25T16:09:14Z
- **Completed:** 2026-02-25T16:13:03Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- loop.ts now calls `prompt.render()` instead of `renderToString()`, splitting sections into stable (soul+instructions) and dynamic (memory+extra)
- Anthropic provider receives `SystemModelMessage[]` with `cacheControl: { type: "ephemeral" }` on the stable block — enables Anthropic prompt caching
- New `providers/provider-anthropic` package with `AnthropicProvider` class (`providerType = "anthropic"`) using `@ai-sdk/anthropic`
- ModelService logs cache write/read token counts at debug level when non-zero

## Task Commits

1. **Task 1: Split system prompt into stable/dynamic sections** - `38eacbf` (feat)
2. **Task 2: Create provider-anthropic package and cache token logging** - `343aeee` (feat)

## Files Created/Modified

- `core/src/services/agent/loop.ts` - Replaced renderToString() with render(); added stable/dynamic split; Anthropic SystemModelMessage[] vs plain string; debug byte-size logging
- `core/src/services/model/service.ts` - Added cache token logging after generateText() call
- `providers/provider-anthropic/src/index.ts` - AnthropicProvider with providerType="anthropic", createAnthropic client, default claude-sonnet-4-20250514
- `providers/provider-anthropic/package.json` - Package config with @ai-sdk/anthropic dependency
- `providers/provider-anthropic/tsconfig.json` - TypeScript config mirroring provider-openai

## Decisions Made

- Provider type detected via `IModelProvider.providerType` field — locked decision from STATE.md, never infer from model ID
- Used `ephemeral` cache type (not `persistent`) — matches Anthropic's recommended pattern for system prompts that change per-session
- Wrap-up call in max-rounds block also uses `systemParam` — consistent cache behavior across all model calls in the loop

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

To use Anthropic models, add the provider-anthropic plugin to your Koishi config and provide an API key. The `providerType = "anthropic"` field will automatically enable cache_control injection in loop.ts.

## Next Phase Readiness

- Prompt caching infrastructure is complete for Anthropic
- Cache hit/miss observable in debug logs via `write=N read=N` entries
- provider-anthropic package ready to be added to workspace turbo pipeline if needed
- Non-Anthropic providers see no behavioral change
