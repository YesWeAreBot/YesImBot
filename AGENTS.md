# Athena Agent Guide

## Project Snapshot

Athena (YesImBot v4) is a Yarn 4 + Turbo monorepo for Koishi 4.x plugins that turn generic LLMs into social chat agents with memory, personality, and tool use.

- `core/`: main runtime plugin and services
- `packages/shared-model/`: shared provider/model interfaces and schema helpers
- `providers/*`: model provider adapters
- `plugins/*`: optional extensions such as persona, search, memory, and MCP
- `test/`: integration and e2e-style Vitest coverage
  Primary planning context lives in `.planning/PROJECT.md`.

## External Agent Rules

No Cursor rules were found in `.cursor/rules/` or `.cursorrules`.
No Copilot rules were found in `.github/copilot-instructions.md`.
If those files appear later, treat them as additive repository policy.

## First Reads By Task Type

- New feature: read `docs/CHANGE_GUIDE.md` and the target service under `core/src/services/`
- Refactor: read `docs/ARCHITECTURE.md` before changing dependencies or boundaries
- Bug fix: inspect the target service and its matching tests in `core/tests/`
- Provider work: inspect `packages/shared-model/` first, then the target `providers/*` package
- Prompt/role work: inspect `core/src/services/prompt/`, `core/src/services/role/`, and `core/resources/roles/`

## Core Runtime Flow

```text
Koishi message event
  -> Horizon listener/event manager
  -> Agent willingness + token bucket check
  -> DM/group aggregation window
  -> HorizonView build
  -> Trait analyze + Skill resolve
  -> Prompt render/injection
  -> ModelService call with fallback
  -> Tool or Action execution
  -> Reply or silent finish
```

Keep these boundaries intact:

- Horizon is a context/data layer, not a decision layer
- Trait analyzes signals; Skill turns signals into behavior effects
- Tool calls continue the think-act loop; Action calls end the current round
- Provider-specific behavior belongs in provider packages, not shared abstractions

## Important Repository Rules

- Services must use the Koishi `Service` subclass pattern
- Wire cross-service dependencies with `static inject = [...]`
- Do not use `ctx.provide()` for service creation
- Reuse a logger from context, usually `ctx.logger("...")`
- Preserve per-channel isolation using `platform + channelId`
- **`.planning/` is an independent documentation repository** — it is a separate git submodule/repo and must be committed separately after tasks complete. After completing any task that modifies `.planning/`, switch to the `.planning/` directory and commit changes there.
- Reference `references/YesImBot-v3/` when migrating older behavior patterns

## Workspace Commands

Run commands from the repository root unless a package-local command is clearer.

### Install

- `yarn`

### Build

- Full workspace build: `yarn build`
- Build one package via Turbo: `yarn turbo run build --filter=koishi-plugin-yesimbot`
- Package-local build: `yarn workspace koishi-plugin-yesimbot build`

### Lint and Format

- Lint all workspaces: `yarn lint`
- Lint and auto-fix where supported: `yarn lint:fix`
- Format all workspaces: `yarn fmt`
- Check formatting without writing: `yarn fmt:check`
- Package-local lint: `yarn workspace koishi-plugin-yesimbot lint`

### Typecheck

- Full workspace typecheck: `yarn typecheck`
- Package-local typecheck: `yarn workspace koishi-plugin-yesimbot typecheck`

### Test

- Full workspace tests: `yarn test`
- Core unit tests only: `yarn turbo run test --filter=koishi-plugin-yesimbot`
- E2E/integration package only: `yarn turbo run test --filter=@yesimbot/test`
- Package-local core tests: `yarn workspace koishi-plugin-yesimbot test`
- Package-local e2e tests: `yarn workspace @yesimbot/test test`

### Single-Test Commands

Use Vitest file and test-name filters directly.

- Single core test file from root: `yarn workspace koishi-plugin-yesimbot test tests/json-parser.test.ts`
- Single core test by name: `yarn workspace koishi-plugin-yesimbot test tests/json-parser.test.ts -t "should parse valid JSON"`
- Single e2e test file from root: `yarn workspace @yesimbot/test test e2e/message-flow.test.ts`
- From inside `core/`: `yarn test tests/json-parser.test.ts`
- From inside `core/` by name: `yarn test tests/json-parser.test.ts -t "should parse valid JSON"`
  Notes:
- `core/vitest.config.ts` includes `tests/**/*.test.ts` and loads `core/tests/setup.ts`
- `test/vitest.config.ts` runs in Node with Vitest globals enabled
- Prefer targeted tests while iterating, then finish with `yarn typecheck` and the relevant package suite

## Code Style

The repo is TypeScript-first, strict, and formatted with `oxfmt`.

### Formatting

- Use 2-space indentation
- Use LF line endings and keep a final trailing newline
- Use double quotes, semicolons, and trailing commas
- Let `oxfmt` handle whitespace and wrapping instead of manual alignment
- Keep files ASCII unless the file already contains localized text or Unicode is required

### Imports

- Group imports as: Node built-ins, third-party packages, then local modules
- Separate import groups with a blank line
- Prefer `import type` for type-only imports
- Prefer relative imports inside a package; use workspace aliases only where already established

### Types

- `strict` TypeScript is enabled; satisfy types instead of weakening them
- Do not introduce `any`; `@typescript-eslint/no-explicit-any` is an error
- Prefer `unknown` for caught errors and narrow with guards such as `instanceof Error`
- Prefer explicit interfaces and named types for service contracts, config, and payloads
- Start changes with shared types in `packages/shared-model/` when behavior crosses package boundaries

### Naming

- Use `PascalCase` for classes, schemas, and exported service types
- Use `camelCase` for functions, methods, variables, and config fields
- Use `SCREAMING_SNAKE_CASE` only for true module-level constants
- Keep filenames aligned with local patterns such as `service.ts`, `types.ts`, and `index.ts`

### Service and Plugin Patterns

- Declare Koishi module augmentation near the top when extending `Context`, `Events`, or `Tables`
- Register services through `ctx.plugin(...)` in `core/src/index.ts` or the relevant package entry
- Expose minimal public APIs from services; keep helpers private where possible
- Put configuration schemas next to the config interface
- Keep plugin/tool parameter schemas strict and descriptive

### Error Handling and Logging

- Wrap async service edges in `try/catch` when failures should degrade gracefully
- Catch as `err: unknown`
- Log with the service logger instead of `console.*`
- Prefer actionable log messages with trace IDs, channel keys, or model names when relevant
- For recoverable failures, warn or log and continue; for fatal initialization failures, throw
- Bound external/model/tool output sizes before feeding them back into the loop

### Testing Conventions

- Test framework is Vitest using `describe`, `it`, `expect`, `vi`, and lifecycle hooks
- Core tests live in `core/tests/*.test.ts`
- Integration tests live in `test/e2e/*.test.ts`
- Follow existing naming style: behavior-focused `*.test.ts` files with explicit test titles
- Add or update tests alongside behavior changes, especially for willingness, hooks, horizon formatting, and parser logic

## Change Guidance By Area

- Agent behavior: inspect `core/src/services/agent/`, `core/src/services/trait/`, and `core/src/services/skill/`
- Horizon formatting/compression: inspect `core/src/services/horizon/`
- Tool or action changes: inspect `core/src/services/plugin/` and relevant `plugins/*`
- Prompt composition: inspect `core/src/services/prompt/`, `core/src/services/role/`, and `core/resources/roles/`
- Provider capability: inspect `providers/*` and `packages/shared-model/src/providers/`

## Pre-Merge Checklist For Agents

- Trace callers before changing service contracts
- Verify `static inject` dependencies after moving logic across services
- Run targeted tests for touched code
- Run `yarn workspace koishi-plugin-yesimbot typecheck` or `yarn typecheck` for broader changes
- Run `yarn lint` or `yarn fmt` if you changed style-sensitive files
- For cross-package changes, finish with `yarn build`

## Reference Documentation and Resources

- [Koishi](references/koishi-docs/zh-CN)
- [Letta Source Code](references/letta)
- [OpenClaw docs](references/openclaw/docs)
- [Plast Mem](references/plast-mem) an experimental llm memory layer for cyber waifu.

When using the write tool, make sure to only write small blocks and avoid large chunks, as there is currently a bug in the write tool that can lead to timeouts.
