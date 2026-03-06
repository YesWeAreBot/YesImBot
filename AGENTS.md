# Athena Development Context

## Project Overview

Athena (YesImBot v4) is a Koishi 4.x plugin monorepo that turns generic LLMs into chat agents with personality, memory, and tool-using behavior.

- Continuity: layered context and memory handling
- Relationality: channel-aware social context and entity state
- Agency: willingness gating, tool actions, and multi-round think-act loop

Primary project context lives in `.planning/PROJECT.md`.

## How to Use This Documentation

When working on Athena, follow this decision tree:

### Starting a Task

- New feature: check `docs/CHANGE_GUIDE.md` and this file first.
- Refactor: check `docs/ARCHITECTURE.md` for dependency boundaries.
- Bug fix: inspect the target service under `core/src/services/` and related tests in `core/tests/`.

### Understanding Change Impact

```text
Message event -> Willingness decision -> Agent loop -> Tool execution -> Response
     |                 |                    |              |
  Horizon         Rule + LLM          Trait + Skill    Native tool call
```

Steps:

1. Read the target service in `core/src/services/<name>/`.
2. Trace callers with `rg "<ServiceName|methodName>" core plugins providers`.
3. Verify dependencies in `static inject = [...]`.
4. Confirm config schema in plugin/provider `Config` definitions.
5. Validate runtime flow in `docs/ARCHITECTURE.md`.

## Quick Component Summary

- `core/`: main runtime plugin
  - `services/agent/`: willingness gating, DM/group aggregation, think-act loop
  - `services/horizon/`: timeline/event/entity/environment context layer
  - `services/model/`: provider registry, concurrency queue, fallback calls
  - `services/prompt/`: prompt injection and section rendering
  - `services/role/`: SOUL/AGENTS/TOOLS role file loading
  - `services/trait/`: context signals (scene/heat)
  - `services/skill/`: skill loading, condition matching, effect merging
  - `services/plugin/`: tool/action registration and schema conversion
- `packages/shared-model/`: shared provider/model interfaces and schema factory
- `providers/provider-*`: model provider integrations (Anthropic/OpenAI/Google/DeepSeek)
- `plugins/`: optional extension plugins (`persona`, `search-service`, `memory-keeper`, `mcp-client`)

## Key Runtime Flows

- Message ingestion: Koishi middleware event -> Horizon event -> Agent willingness/aggregation
- Willingness decision: decay + gain + fatigue + sigmoid -> optional deferred LLM judgment -> token bucket limit
- Agent loop: Horizon view -> Trait analyze -> Skill resolve -> Prompt render/inject -> model call -> tool/action execution
- Tool semantics: `Tool` continues the loop; `Action` executes and ends current round
- Anthropic cache path: split stable and dynamic system blocks with ephemeral cache control

## Context Files

Load these files as needed for focused work:

- `docs/ARCHITECTURE.md`: module boundaries and end-to-end flow
- `docs/CHANGE_GUIDE.md`: concrete implementation playbook for common changes
- `docs/ENVIRONMENT.md`: configuration and secrets checklist
- `.planning/PROJECT.md`: roadmap, milestone goals, and scope
- `.planning/ROADMAP.md`: current phase ordering and execution targets
- `core/resources/roles/AGENTS.md`: runtime role prompt instructions

## Implementation Strategy

1. Start with types in `packages/shared-model` or target service types.
2. Implement with Koishi `Service` subclass pattern.
3. Wire dependencies via `static inject`.
4. Add prompt/skill/plugin integration only through existing service APIs.
5. Add or update tests in `core/tests`.
6. Run `yarn typecheck` before broader validation.

## Testing Conventions

- Test framework: Vitest (`describe/it/expect`)
- Location: `core/tests/*.test.ts`
- Existing focus areas: JSON parser, willingness/token bucket, horizon formatting
- Commands:
  - `yarn test`
  - `yarn test -p core`
  - `yarn typecheck`

## Development Notes

- Horizon is a data/context layer, not a decision layer.
- Keep Trait (analysis) and Skill (behavior effect) responsibilities separate.
- Preserve per-channel isolation with `ChannelKey = platform + channelId`.
- Prefer explicit required fields over weak optional chaining.
- Provider abstraction is shared; Anthropic prompt cache behavior is provider-specific.

## Build and Test Commands

```bash
yarn build
yarn typecheck
yarn test
yarn test -p core
yarn lint
```

## Remember

- Use Service subclass pattern; do not use `ctx.provide()`.
- Reuse logger instance (`const logger = ctx.logger("...")`).
- Keep tool/action distinction intact.
- Validate dependency graph when touching service startup/injection.
- Reference `references/YesImBot-v3/` for feature migration patterns.

## Reference Documentation and Resources

- [Koishi](references/koishi-docs/zh-CN)
- [Letta Source Code](references/letta)
- [OpenClaw docs](references/openclaw/docs)
- [Plast Mem](references/plast-mem) an experimental llm memory layer for cyber waifu.
