# Athena Agent Guide

## Project Overview

Athena is a Yarn 4 monorepo for Koishi-based LLM chat agents.

- `core/` is the main `koishi-plugin-yesimbot` runtime.
- `packages/shared-model/` defines cross-package model/provider contracts.
- `packages/plugin-sdk/` defines the plugin/tool registration API used by optional integrations.
- `providers/*` register model backends into `ctx["yesimbot.model"]`.
- `plugins/*` register optional tools and integrations into the runtime.

## Context Files

Load these on demand when the task needs deeper context:

- `@README.md` - top-level workspace summary and common root commands.
- `@package.json` - root workspace scripts, workspace layout, lint-staged config, Yarn version.
- `@.github/workflows/ci.yml` - authoritative verification order: `lint -> fmt:check -> typecheck -> build -> test`.
- `@core/package.json` - core package scripts; this is the only workspace package with a `test` script.
- `@core/src/index.ts` - Koishi plugin entrypoint and top-level runtime config schema.
- `@core/src/services/session/service.ts` - channel runtime ownership, middleware wiring, management commands.
- `@core/src/services/model/service.ts` - model registry, `provider:modelId` resolution, model-related commands.
- `@.planning/codebase/ARCHITECTURE.md` - verified runtime layering and data flow.
- `@.planning/codebase/CONVENTIONS.md` - repo-specific TS/Koishi patterns already extracted from code.
- `@.planning/codebase/TESTING.md` - focused Vitest commands and current test layout under `core/tests/session/`.
- `@.planning/codebase/INTEGRATIONS.md` - provider/search/MCP integration inventory and where secrets live.
- `@scripts/release.mjs` - interactive release flow and tag naming rules.

## Working Rules

- Prefer communicating in Chinese unless the user asks otherwise.
- This repo uses Yarn 4 with `nodeLinker: node-modules`; use `yarn`, not `pnpm` or `npm`.
- Pre-commit runs `npx lint-staged`, which applies `oxlint --fix` and `oxfmt --write` to staged JS/TS and JSON files.
- `dist/` directories exist as build output across packages; do not treat them as the primary source of truth.

## Build and Verification

Use the narrowest command that proves your change.

```bash
# root
yarn lint
yarn fmt:check
yarn typecheck
yarn build
yarn test

# focused core checks
yarn workspace koishi-plugin-yesimbot typecheck
yarn workspace koishi-plugin-yesimbot test
yarn workspace koishi-plugin-yesimbot test tests/session/session-restore.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/session/channel-agent-step-finish.test.ts -t "normalizes assistant reasoning blocks and usage metadata into AgentMessage payloads"

# focused package checks
yarn workspace @yesimbot/plugin-sdk typecheck
```

- Follow CI order before claiming broad success: `yarn lint`, `yarn fmt:check`, `yarn typecheck`, `yarn build`, `yarn test`.
- Root `yarn test` only runs workspaces that actually define a `test` script; currently that means `core`.
- When changing runtime/session logic, start with the narrowest `core/tests/session/*.test.ts` target, then expand.

## Architecture Notes

- `core/src/index.ts` wires three long-lived services: `ModelService`, `PluginService`, and `AgentSessionService`.
- `AgentSessionService` owns one runtime per `platform:channelId` and persists append-only session state under the configured workspace base path.
- `attachedInstructionFiles` defaults to `SOUL.md`, `AGENTS.md`, and `PERSONA.md`; changes to instruction-loading behavior should be checked from `core/src/index.ts` and session resource-loading code.
- Provider packages expose Koishi plugins from `providers/*/src/index.ts`; optional integrations do the same from `plugins/*/src/index.ts`.
- Shared contracts belong in `packages/shared-model` or `packages/plugin-sdk` before wiring them into `core`.

## File Reference

| File | Purpose |
| ---- | ------- |
| `README.md` | High-level workspace summary and common commands |
| `package.json` | Root scripts, workspace boundaries, lint-staged, Yarn version |
| `.github/workflows/ci.yml` | Exact CI verification sequence |
| `.github/workflows/publish.yml` | Current publish flow: build/publish `shared-model` first, then `core` |
| `.yarnrc.yml` | Confirms Yarn 4 and `node-modules` linker |
| `.oxlintrc.json` | Lint rules; notably `@typescript-eslint/no-explicit-any` is enforced |
| `.oxfmtrc.json` | Formatter behavior and import/package.json sorting |
| `.husky/pre-commit` | Pre-commit entrypoint (`npx lint-staged`) |
| `core/src/index.ts` | Main Koishi plugin entry and config schema |
| `core/src/services/session/service.ts` | Channel bootstrapping, middleware, admin commands |
| `core/src/services/model/service.ts` | Model registry and `provider:modelId` resolution |
| `packages/plugin-sdk/src/plugin.ts` | Plugin authoring API for optional integrations |
| `packages/plugin-sdk/src/tools/index.ts` | Tool metadata/decorator registration |
| `providers/openai/src/index.ts` | Representative provider plugin entry |
| `plugins/search-service/src/index.ts` | Representative optional tool plugin entry |
| `plugins/mcp-client/src/index.ts` | MCP integration entrypoint |
| `scripts/release.mjs` | Interactive version/tag bump flow; final push is manual |

## File Editing

**IMPORTANT**
- When updating or creating long files, write them in smaller chunks instead of one large write.
- Prefer segmented writes for large content because the write tool can time out on oversized payloads.

## Communication

- Unless the user explicitly requests otherwise, prefer communicating in Chinese.

<!-- GSD:profile-start -->
## Developer Profile

> Generated by GSD from questionnaire. Run `/gsd-profile-user --refresh` to update.

| Dimension | Rating | Confidence |
|-----------|--------|------------|
| Communication | conversational | MEDIUM |
| Decisions | deliberate-informed | MEDIUM |
| Explanations | educational | MEDIUM |
| Debugging | collaborative | MEDIUM |
| UX Philosophy | backend-focused | MEDIUM |
| Vendor Choices | opinionated | MEDIUM |
| Frustrations | scope-creep | MEDIUM |
| Learning | documentation-first | MEDIUM |

**Directives:**
- **Communication:** Use a natural conversational tone. Explain reasoning briefly alongside code. Engage with the developer's questions.
- **Decisions:** Present options in a structured comparison table with pros/cons. Let the developer make the final call.
- **Explanations:** Teach the underlying concepts and principles, not just the implementation. Relate new patterns to fundamentals.
- **Debugging:** Walk through the debugging process step by step. Explain the investigation approach, not just the conclusion.
- **UX Philosophy:** Optimize for developer experience (clear APIs, good error messages, helpful CLI output) over visual design.
- **Vendor Choices:** Respect the developer's existing tool preferences. Ask before suggesting alternatives to their preferred stack.
- **Frustrations:** Do exactly what is asked -- nothing more. Never add unrequested features, refactoring, or "improvements". Ask before expanding scope.
- **Learning:** Link to official documentation and relevant sections. Structure explanations like reference material.
<!-- GSD:profile-end -->
