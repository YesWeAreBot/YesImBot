# Athena Agent Guide

## Project Overview

Athena is a Yarn 4 monorepo for Koishi-based LLM chat agents. Long-term goal: evolve from group chat agent into a persistent, perceptive, autonomous digital entity.

- `core/` is the main `koishi-plugin-yesimbot` runtime — business logic, Koishi integration, message conversion.
- `packages/agent/` owns the agent loop, session management, compaction, and extension system (`@yesimbot/agent`).
- `packages/shared-model/` defines cross-package model/provider contracts.
- `providers/*` register model backends into `ctx["yesimbot.model"]`.

## Working Rules

- Prefer communicating in Chinese unless the user asks otherwise.
- This repo uses Yarn 4 (`nodeLinker: node-modules`); use `yarn`, not `pnpm` or `npm`.
- Pre-commit runs `npx lint-staged`, which applies `oxlint --fix` and `oxfmt --write` to staged JS/TS and JSON files.
- `dist/` directories are build output; do not treat them as source of truth.
- When updating or creating long files, write them in smaller chunks — the write tool can time out on oversized payloads.
- `references/` and `node_modules/` are `.gitignore`-excluded. Tool-based file search (glob, grep, etc.) filters them by default. To read from these directories, always use **absolute paths** (e.g., `/home/workspace/Athena/references/...`).

## Build and Verification

Use the narrowest command that proves your change.

```bash
# full pipeline (CI order)
yarn lint && yarn fmt:check && yarn check-types && yarn build && yarn test

# root turbo shortcuts
yarn lint
yarn fmt:check
yarn check-types
yarn build
yarn test

# package-scoped (always prefer turbo --filter for speed)
yarn turbo run build --filter=koishi-plugin-yesimbot
yarn turbo run check-types --filter=koishi-plugin-yesimbot
yarn turbo run test --filter=koishi-plugin-yesimbot
yarn turbo run check-types --filter=@yesimbot/agent
yarn turbo run test --filter=@yesimbot/agent
yarn turbo run check-types --filter=@yesimbot/plugin-sdk

# single test file
yarn workspace @yesimbot/agent exec vitest run tests/agent/agent-loop.test.ts

# single test by name pattern
yarn workspace @yesimbot/agent exec vitest run tests/session/compaction.test.ts -t "compaction"
```

- Root `yarn test` runs all workspaces with a `test` script; currently `core` and `packages/agent`.
- `core` has no `tests/` directory yet; its vitest config exists but is empty. Tests live in `packages/agent/tests/`.
- Turbo task `test` depends on `build` (see `turbo.json`). Run build first if type-checking or test resolution fails on workspace references.

## Architecture

- `core/src/index.ts` wires `ModelService` and `Runtime`. Runtime creates one `AgentSession` per `platform:channelId` on first message.
- `@yesimbot/agent` (`packages/agent/`) owns `Agent`, `AgentSession`, `SessionManager`, and the agent loop (`packages/agent/src/agent/`).
- Extension system: `ExtensionRegistry` (global, in core) manages definitions; `ExtensionRunner` (per-session, in agent) manages bindings. Extensions register tools, subscribe to lifecycle events, inject context, and modify system prompts.
- `AgentSession.subscribe()` emits events (`agent_start`, `agent_end`, `turn_start`, `tool_execution_*`, etc.).
- Provider packages expose Koishi plugins from `providers/*/src/index.ts`; optional integrations do the same from `plugins/*/src/index.ts`.
- Shared contracts belong in `packages/shared-model` before wiring them into `core`.

## Workspace Package Names

| Directory                | npm name                       |
| ------------------------ | ------------------------------ |
| `core/`                  | `koishi-plugin-yesimbot`       |
| `packages/agent/`        | `@yesimbot/agent`              |
| `packages/shared-model/` | `@yesimbot/shared-model`       |
| `plugins/skill/`         | `koishi-plugin-yesimbot-skill` |

## Context Files

Load on demand when deeper context is needed:

- `@core/src/index.ts` — Koishi plugin entrypoint and runtime wiring.
- `@packages/agent/src/agent/` — agent loop implementation.
- `@packages/agent/src/session/` — session management and compaction.
- `@packages/agent/src/session/extensions/` — extension system (types, runner, loader, registry).
- `@packages/shared-model/` — cross-package model/provider type contracts.

## Reference Projects

`references/` 目录存放设计参考与文档，按需用绝对路径读取：

| 目录                           | 用途                                                                               | 何时参考                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `references/koishi-docs/zh-CN` | Koishi 官方中文文档（插件 API、Schema、数据库、沙盒等）                            | 开发 Koishi 插件、不确定 API 用法或配置 schema 时                    |
| `references/pi-mono`           | Pi monorepo — 多 provider LLM API、agent runtime、coding agent CLI                 | 设计 agent loop、tool calling、多 provider 适配、monorepo 工程模式时 |
| `references/plast-mem`         | Plast Mem — Rust 认知科学记忆层（情景/语义双层记忆、FSRS 衰减、事件分段）          | 实现记忆系统、会话分段、语义召回、compaction 策略时                  |
| `references/CyberGroupmate`    | CyberGroupmate — CodeAct 群聊 Agent（氛围感知、三层记忆、反思引擎、NPM-as-skills） | 设计群聊行为、消息路由、CodeAct 执行、多模态处理、可视化面板时       |

## Subagents

- ALWAYS wait for all subagents to complete before yielding.
- Spawn subagents for parallelizable work, long-running tasks, or risky change isolation.
- 如果需要，优先派发子代理进行研究

## 代码索引工具使用规范

- 优先使用 augment-context-engine_codebase-retrieval 索引本地代码
- 使用 augment-context-engine_codebase-retrieval 索引 references 中被 .gitignore 排除的仓库，并将 directory_path 设置为对应仓库的绝对路径
- 使用 deepwiki 研究第三方仓库，常用仓库列表 `badlogic/pi-mono`, `vercel/ai`
