# Athena Agent Guide

## Project Snapshot

- Athena is a Yarn 4 TypeScript monorepo for Koishi-based LLM agents.
- Athena is also referred to as YesImBot in older docs and references; the project goal is "machine shell, human heart" for an IM-native AI companion rather than a command-only assistant.
- The long-term product direction is a naturally participating group-chat agent with personality, memory, and situational awareness, while the active mainline work is currently focused on the runtime refactor in `core/`.
- This root guide covers only the active mainline workspaces: `core/`, `packages/shared-model/`, `packages/plugin-sdk/`, `providers/*`, and `plugins/*`.
- Main package roles: `core/` is the primary runtime, `packages/shared-model/` holds shared contracts, `packages/plugin-sdk/` defines extension APIs, `providers/*` implement model providers, and `plugins/*` add optional integrations.
- Root workspace aliases come from `tsconfig.json`: `koishi-plugin-yesimbot` -> `core/src`, `@yesimbot/*` -> `packages/*/src`.
- Checked for repo-specific editor rules: no `.cursor/rules/`, no `.cursorrules`, and no `.github/copilot-instructions.md` were found at review time.

### Product Context

- Historical product themes in older docs include willingness-driven participation, memory/scenario-based context handling, persona customization, world-state modeling, tool calling, and scheduler/heartbeat behavior.
- Treat those as architectural context and reference material, not as automatic in-scope requirements for the current runtime-refactor phases.
- For current implementation scope, follow `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, and phase context/planning artifacts over older product descriptions.

## Workspace Commands

### Root Commands

- Build all workspaces: `yarn build` (artifact build only; run `yarn typecheck` separately for TypeScript validation)
- Typecheck all workspaces: `yarn typecheck` (prebuilds required workspace artifacts, then runs `tsc --noEmit`)
- Lint all workspaces: `yarn lint`
- Lint with fixes where supported: `yarn lint:fix`
- Format all workspaces: `yarn fmt`
- Check formatting only: `yarn fmt:check`
- Run the core package test suite: `yarn test`
- Clean build outputs: `yarn clean`

### Preferred Targeted Commands

- Prefer running targeted work from the repository root with `yarn workspace <package-name> <script>`.
- Build one package: `yarn workspace <package-name> build`
- Typecheck one package: `yarn workspace <package-name> typecheck`
- Lint one package: `yarn workspace <package-name> lint`
- Test one package: `yarn workspace <package-name> test`
- Format one package: `yarn workspace <package-name> fmt`
- Build commands emit dist artifacts via `pkgroll`; they do not replace explicit `typecheck` runs.
- The old README example `yarn test -p core` is stale; prefer explicit workspace commands from the root.

### Important Workspace Names

- Core: `koishi-plugin-yesimbot`
- Shared model: `@yesimbot/shared-model`
- Plugin SDK: `@yesimbot/plugin-sdk`
- Plugins: `koishi-plugin-yesimbot-search-service`, `koishi-plugin-yesimbot-mcp-client`
- Providers: `@yesimbot/koishi-plugin-provider-openai`, `@yesimbot/koishi-plugin-provider-anthropic`, `@yesimbot/koishi-plugin-provider-google`, `@yesimbot/koishi-plugin-provider-deepseek`

### Package-Local Commands

- `yarn workspace koishi-plugin-yesimbot build|typecheck|lint|test|fmt`
- `yarn workspace @yesimbot/plugin-sdk build|typecheck|lint|fmt`
- `yarn workspace @yesimbot/shared-model build|typecheck|lint|fmt`
- `providers/*` and `plugins/*` generally expose `build`, `typecheck`, `lint`, and `fmt`, but usually no package-level `test` script.

### Testing Guidance

- Active package test suites currently live in `core/tests/**/*.test.ts`.
- `packages/plugin-sdk/`, `packages/shared-model/`, `providers/*`, and `plugins/*` currently do not define package-level test scripts.
- Run one core test file from the root: `yarn workspace koishi-plugin-yesimbot test tests/session/session-restore.test.ts`
- From inside `core/`: `yarn test tests/session/session-restore.test.ts`
- Run one exact core case: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/session/channel-agent-step-finish.test.ts -t "normalizes assistant reasoning blocks and usage metadata into AgentMessage payloads"`
- For `packages/plugin-sdk/`, use `yarn workspace @yesimbot/plugin-sdk typecheck` and `yarn workspace @yesimbot/plugin-sdk build` until a real test surface is added.
- Use `yarn workspace <pkg> exec vitest run <file> -t "<case name>"` when you need exact case-level targeting.
- While iterating, run the narrowest relevant test first, then broaden to package-level verification only as needed.

## Code Style

- Unless the user explicitly requests otherwise, prefer communicating in Chinese.

### File Editing

- When updating or creating long files, write them in smaller chunks instead of one large write.
- Prefer segmented writes for large content because the write tool can time out on oversized payloads.

### Formatting

- TypeScript is strict and formatted with `oxfmt`.
- Use 2-space indentation, LF line endings, double quotes, semicolons, trailing commas, and a final newline.
- `oxfmt` uses `printWidth: 100`; do not hand-wrap for visual alignment.
- Keep files ASCII unless the file already contains localized text or Unicode is required.
- Prefer formatter-driven cleanup over manual import reordering or spacing edits.

### Imports

- Prefer `import type` for type-only imports.
- Prefer `node:` specifiers for Node built-ins in new code.
- Use workspace aliases for cross-package imports; otherwise prefer relative imports inside a package.
- Keep imports readable as built-ins, third-party modules, then local modules.
- Let `oxfmt` own final import ordering.

### Types

- `strict: true` is enabled in `tsconfig.base.json`; satisfy types instead of weakening them.
- Do not introduce `any`; `.oxlintrc.json` makes `@typescript-eslint/no-explicit-any` an error.
- Prefer `unknown` in `catch` blocks and narrow before reading `.message` or other properties.
- Put cross-package contracts in `packages/shared-model/src/` before duplicating shapes across packages.
- Do not use local interface-assertion shims such as `ctx as Context & { ... }` to patch missing types at the call site; fix the source type through shared contracts, exported types, or module augmentation instead.
- Use explicit annotations when they improve contracts; avoid noisy annotations that only restate inference.

### Naming

- Use `PascalCase` for classes, schemas, exported types, and error classes.
- Use `camelCase` for functions, methods, variables, and config fields.
- Use `SCREAMING_SNAKE_CASE` only for true constants.
- Keep filenames aligned with existing patterns such as `index.ts`, `service.ts`, `types.ts`, `config.ts`, and `command.ts`.
- Match Koishi service ids, logger names, and exported symbols consistently.

## Structural Conventions

- In service-oriented code, organize new behavior under `src/services/<service-name>`.
- Keep service directory names concise; prefer a single word when it remains clear.
- Every top-level `services/` directory must contain a `service.ts` file.
- Do not create bucket directories inside `src/services/` such as `shared`, `runtime`, `utils`, `helpers`, `common`, or `lib`.
- Those names are acceptable elsewhere when local to `src/` or inside a specific service module.
- Prefer one primary service module per top-level service directory; keep helpers, types, config, and commands beside it.
- Declare Koishi module augmentation near the top when extending `Context`, `Events`, or `Tables`.
- Service constructors should call `super(ctx, "<service-name>", false)`, assign `this.config`, assign `this.logger = ctx.logger("<service-name>")`, and set `this.logger.level = config.debugLevel ?? 2`.
- Register services from package entrypoints with `ctx.plugin(...)`.

## Dependency And Interface Rules

- Prefer long-lived objects holding their own stable dependencies over passing behavior downward as callback parameters.
- Do not introduce parameterized interfaces whose only job is tunneling runtime capabilities through constructors.
- Avoid passing method references or function adapters such as `sendMessage`, `resolveModel`, or similar shims into objects like `ChannelAgent` when the object can hold `ctx`, `bot`, or concrete services directly.
- Framework-required middleware, hook handlers, and callback APIs are acceptable exceptions.

## Error Handling And Logging

- Prefer structured, service-aware errors for cross-boundary failures; `core/src/errors/base.ts` is the reference pattern.
- Include service name, operation name, and trace id when an error escapes its local scope.
- Preserve causes when wrapping errors.
- Use service-named loggers via `ctx.logger("service-name")`.
- Narrow unknown errors before reading properties; otherwise log `String(error)`.
- Use explicit timeouts for slow or external boundaries such as hooks, tools, and model calls.

## Testing And Change Expectations

- Add or update tests when changing service boundaries, runtime contracts, hooks, prompts, model routing, or plugin registration.
- If you touch `core/src/services/`, consider whether related structure or debug-level tests need updates.
- Finish exported contract changes with package-level `typecheck` and `build`; do not treat `build` as a substitute for `typecheck`.

## Git And Workspace Hygiene

- Prefer branch isolation by default; do not create a git worktree unless the user explicitly asks for one.
- Never revert user changes you did not make unless explicitly requested.
- Avoid destructive git commands such as `git reset --hard` or `git checkout --` unless explicitly requested.
- Do not amend commits unless the user explicitly asks for it.

## Reference Documentation And Resources

### Architecture References

- `references/letta` for tool-calling patterns, persona/prompt design, and heartbeat-style agent control ideas.
- `references/mastra` for memory management, context recall/control, and workspace-oriented runtime design.
- `references/pi-mono/packages/coding-agent` for `AgentSession` persistence, prompt construction, skills, and agent settings patterns.
- `references/MaiBot` for earlier willingness-system ideas and related chatbot runtime design.

### Reference Documentation

- `node_modules/ai/docs` for local AI SDK reference docs.
- `references/koishi-docs/zh-CN` for Koishi plugin lifecycle, services, middleware, and session APIs.
- `references/koishi-docs/zh-CN/guide/plugin/service.md` for Koishi service structure and lifecycle.
- `references/pi-mono/packages/coding-agent` for session persistence and coding-agent runtime patterns.
- `references/pi-mono/packages/coding-agent/docs` for session and settings behavior.
- `references/pi-mono/packages/ai` for model abstraction and tool-call primitives.
- `references/letta`, `references/openclaw/docs`, and `references/plast-mem` for agent orchestration and memory design references.
- `references/vercel-chat/skills/chat/SKILL.md` and `references/vercel-chat/apps/docs/content/docs/concurrency.mdx` for best practices to build chat-bot via ai-sdk.

### Additional Project References

- `references/plast-mem` for experimental LLM memory-layer ideas relevant to long-term memory design exploration.
- `references/AgentGal` for multi-agent roleplay/narrative patterns with narrator routing, independent character memory, structured writeback, and retrieval.
- `references/lossless-claw` for lossless context-management ideas.
- `references/YesImBot-v3` for older v3 implementations of willingness, memory, and tool-calling basics.
- `references/YesImBot-core` for older dev/v4-era architecture explorations; useful as a mixed reference and anti-reference because parts are richer but also more coupled or structurally inconsistent.
- `references/vercel-chat` for normalized message modeling, channel/thread abstractions, and AI SDK-facing message conversion patterns across chat platforms.

<!-- GSD:profile-start -->
## Developer Profile

> Generated by GSD from hybrid. Run `/gsd-profile-user --refresh` to update.

| Dimension | Rating | Confidence |
|-----------|--------|------------|
| Communication | detailed-structured | MEDIUM |
| Decisions | deliberate-informed | MEDIUM |
| Explanations | educational | MEDIUM |
| Debugging | hypothesis-driven | MEDIUM |
| UX Philosophy | backend-focused | MEDIUM |
| Vendor Choices | opinionated | MEDIUM |
| Frustrations | instruction-adherence | MEDIUM |
| Learning | documentation-first | MEDIUM |

**Directives:**
- **Communication:** 简单修复保持直接，但在后续开发、长期维护和代码质量相关任务中，使用更完整的上下文、结构化讨论和明确决策点。
- **Decisions:** 在需要选型或取舍时，先给结构化对比、利弊和建议结论，再让开发者拍板。
- **Explanations:** 默认按教育型方式解释原理、机制和取舍；但对简单执行任务保持简洁，先给结果再补最少必要说明。
- **Debugging:** 调试时先对齐现象和可能根因，优先回应开发者已有假设，再给修复方案。
- **UX Philosophy:** 当前项目语境下优先关注运行时、接口和行为正确性；除非明确要求，否则不要主动扩展到视觉设计。
- **Vendor Choices:** 默认尊重开发者已有的技术偏好；若要建议替代方案，先说明为什么，并给出依据和对照。
- **Frustrations:** 严格按已给出的约束执行，不要擅自扩展范围；如果要偏离要求，先说明原因并征求确认。
- **Learning:** 优先给官方文档、参考位置和关键段落；在合适时补一个最小可运行示例，帮助把文档落实到实际代码。
<!-- GSD:profile-end -->

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Athena Runtime Refactor**

Athena 是一个以“机器壳，人类心”为目标的智能体项目，长期方向不是停留在 IM 聊天机器人，而是逐步演化成具有独立性格、能自主行动和思考、可以持续自我进化的赛博灵魂。当前阶段它仍以基于 Koishi 的 IM ChatBot 形态落地，这次项目初始化聚焦于打磨现有代码的核心运行时基础，把消息处理链路、状态切换与调度、AgentSession 设计收束成清晰、可维护、便于后续扩展的架构。

**Core Value:** 先建立一个稳定、优雅、易扩展的核心运行时框架，让后续能力可以在清晰边界上持续演进，而不是继续堆叠成难以维护的耦合系统。

### Constraints

- **Tech Stack**: 继续基于 Koishi、TypeScript、AI SDK 和现有 monorepo 结构演进 — 需要复用当前工程与类型体系，避免为重构引入额外迁移成本
- **Architecture**: 以复用现有库能力和类型为主，拒绝重复造轮子 — 保持实现简洁，减少自定义抽象带来的维护负担
- **Scope**: 第一阶段聚焦运行时主链路，不引入主动发言、复杂记忆、复杂 Hook、动态工具发现、高级模型路由 — 防止再次因功能过早扩张而失控
- **Design**: 拒绝过度设计，先做核心闭环，再逐步优化和扩展 — 当前目标是建立稳定基础而不是一次性做完所有未来能力
- **Quality**: 模块设计必须高内聚低耦合 — 后续新增、删除、重构运行时能力时，必须能保持影响面局部化
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript (`ES2022`, `moduleResolution: bundler`) - Used across `core/src/`, `packages/*/src/`, `providers/*/src/`, and `plugins/*/src/`.
- JSON - Workspace/package manifests, config, locales, and session data in `core/src/services/session/session-manager.ts`.
- Markdown - Long-lived docs and planning notes under `.planning/codebase/`.
## Runtime
- Node.js ESM runtime - Package manifests use `type: "module"` in workspace packages such as `core/package.json` and `providers/openai/package.json`.
- TypeScript target is `ES2022` in `tsconfig.base.json`.
- Yarn `4.12.0` - Declared in `package.json`.
- Lockfile: present (`yarn.lock`).
## Frameworks
- Koishi `^4.18.x` - Bot framework and service container used in `core/src/index.ts`, `core/src/services/*`, `packages/plugin-sdk/src/plugin.ts`, and provider/plugin packages.
- AI SDK `^6.0.0` - Model/runtime abstraction used in `core/src/services/session/runtime/channel-runtime.ts`, `core/src/services/session/session-manager.ts`, and provider packages.
- `@ai-sdk/*` provider packages - OpenAI, Anthropic, Google, DeepSeek integrations in `providers/*/src/index.ts`.
- Vitest `^4.0.18` - Configured in `core/vitest.config.ts` and run from `core/package.json`.
- `pkgroll` - Package build pipeline in `package.json`, `core/package.json`, `packages/*/package.json`, `providers/*/package.json`, and `plugins/*/package.json`.
- `oxfmt` / `oxlint` - Formatting and linting tools wired in root scripts and package scripts.
## Key Dependencies
- `ai` - Tool-loop orchestration, model message types, and language model interfaces in `core/src/services/session/runtime/channel-runtime.ts` and `core/src/services/session/session-manager.ts`.
- `@ai-sdk/provider-utils` - Tool/schema helpers and message types in `packages/plugin-sdk/src/plugin.ts` and `core/src/services/session/session-manager.ts`.
- `@yesimbot/shared-model` - Shared model registry contracts in `packages/shared-model/src/types.ts` and `core/src/services/model/service.ts`.
- `@yesimbot/plugin-sdk` - Plugin metadata/tool registration surface in `packages/plugin-sdk/src/plugin.ts` and `core/src/services/plugin/service.ts`.
- `zod` - Validation dependency exposed by provider packages and plugin SDK peer requirements.
- `@modelcontextprotocol/sdk` - MCP client transport support in `plugins/mcp-client/src/adapters/transports.ts`.
- `koishi` - Peer dependency and runtime host across the monorepo.
## Configuration
- Workspace configuration is driven by Koishi schema objects in `core/src/index.ts`, `providers/*/src/index.ts`, `plugins/search-service/src/index.ts`, and `plugins/mcp-client/src/index.ts`.
- Secrets are declared through Koishi `Schema.string().role("secret")` fields rather than repo-local `.env` files.
- Root path aliases come from `tsconfig.json`: `koishi-plugin-yesimbot` → `core/src`, `@yesimbot/*` → `packages/*/src`.
- `tsconfig.base.json` sets shared compiler behavior (`strict`, `composite`, `incremental`, `emitDeclarationOnly`).
- Package-specific `tsconfig.json` files define `rootDir` / `outDir` and references, e.g. `core/tsconfig.json`.
- `core/vitest.config.ts` defines test root and setup files.
- Root `package.json` defines workspaces and lifecycle scripts.
## Platform Requirements
- Node.js with native ESM support.
- Yarn 4 workspace tooling.
- Koishi-compatible runtime for local service/plugin execution.
- Published as npm packages from workspace builds (`dist/` outputs).
- Koishi host application must provide required services such as `database` for `core/package.json` and `yesimbot.model` for provider packages.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Service modules use `service.ts`, `index.ts`, and feature-specific filenames such as `session-manager.ts`, `settings-manager.ts`, and `channel-runtime.ts` under `core/src/services/session/`.
- Test files use `*.test.ts` and live under `core/tests/session/`.
- Use `camelCase` for functions and methods, including helpers like `buildDefaultSettings()` in `core/src/services/session/service.ts` and `deepMergeSettings()` in `core/src/services/session/settings-manager.ts`.
- Prefer verb-first names for actions (`resolveSettings`, `reloadChannelSettings`, `appendCustomEntry`).
- Use descriptive nouns for long-lived state (`sessionManager`, `settingsManager`, `responseState`).
- Use `SCREAMING_SNAKE_CASE` only for true constants such as `CURRENT_SESSION_VERSION` in `core/src/services/session/session-manager.ts`.
- Use `PascalCase` for exported types and interfaces (`AgentSessionServiceConfig`, `SettingsReloadMetadata`, `ResponseEndRecord`).
- Keep shared protocol types in `core/src/services/session/types.ts` and session storage types in `core/src/services/session/session-manager.ts`.
## Code Style
- TypeScript is formatted with `oxfmt` from the root scripts in `package.json` and `core/package.json`.
- Use 2-space indentation, double quotes, semicolons, and trailing commas; the codebase follows the formatter rather than hand-aligned spacing.
- `oxlint` is the primary linter (`package.json`, `core/package.json`).
- `@typescript-eslint/no-explicit-any` is enforced as an error in `.oxlintrc.json`.
- Prefer `unknown` plus narrowing in `catch` blocks; examples appear in `core/src/services/session/service.ts` and `core/src/services/session/settings-manager.ts`.
## Import Organization
- Workspace aliases are defined at the repo root in `tsconfig.json` and used for cross-package imports such as `@yesimbot/shared-model` in `core/src/services/model/service.ts`.
## Service and Module Patterns
- Extend `Service<T>` and register from `core/src/index.ts` with `ctx.plugin(...)`.
- Service constructors follow the same shape: `super(ctx, "service.id", <bool>)`, assign `this.config`, create a service-named logger, and set `this.logger.level` from config.
- See `core/src/services/session/service.ts`, `core/src/services/model/service.ts`, and `core/src/services/plugin/service.ts`.
- Extend Koishi types near the top of service files with `declare module "koishi"`.
- Examples: `Context["yesimbot.session"]` in `core/src/services/session/service.ts` and `Context["yesimbot.plugin"]` in `core/src/services/plugin/service.ts`.
- Service code stays under `core/src/services/<area>/`.
- Keep helpers beside the owning module, as seen in `core/src/services/session/compaction/`, `runtime/`, and `workspace/`.
## Error Handling
- Prefer local guard clauses and explicit messages for user-facing failures (`core/src/services/session/service.ts`, `core/src/services/model/service.ts`).
- Wrap boundary failures with `try/catch` and log the original error object; convert unknown errors with `error instanceof Error ? error.message : String(error)`.
- Throw `Error` for programmer or contract violations in internal services, as in `ModelService.resolve()` and `PluginService.invoke()`.
- Return structured result objects for recoverable operations such as `ChannelSettingsReloadResult` and `CompactionRunResult`.
## Logging
- Use Koishi service loggers via `ctx.logger("...")`.
- Set explicit logger levels from config when the service accepts a debug setting (`core/src/services/session/service.ts`, `core/src/services/plugin/service.ts`, `core/src/services/model/service.ts`).
- Include channel or service identifiers in log text for runtime failures, as in `core/src/services/session/runtime/channel-runtime.ts`.
- Prefer `info` for lifecycle events, `debug` for state transitions and trace-style diagnostics, and `warn` for config issues such as reload conflicts in `core/src/services/session/service.ts`.
## Typing Conventions
- `strict: true` is enabled in `tsconfig.base.json`; code favors explicit contracts over broad inference.
- Avoid `any`; cast only at integration boundaries when unavoidable, and keep the cast local.
- Prefer narrow exported interfaces for persisted records and runtime payloads (`SessionHeader`, `AgentMessage`, `SettingsIssue`).
- Use discriminated unions for protocol objects and session entry kinds (`type` fields in `core/src/services/session/session-manager.ts`).
- Prefer `import type` when values are not needed, as in `core/src/services/model/service.ts` and `core/src/services/session/runtime/channel-runtime.ts`.
## API and Runtime Discipline
- Keep state inside the owning service/class (`SessionManager`, `ChannelRuntime`, `SettingsManager`) instead of passing behavior through callbacks.
- Export only the service entrypoints and stable helpers from `index.ts` files, such as `core/src/services/session/index.ts` and `core/src/services/session/runtime/index.ts`.
- Define Koishi config in `core/src/index.ts` using `Schema.*` and keep default values near the root entrypoint.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- `core/src/index.ts` wires three long-lived services into Koishi: `ModelService`, `PluginService`, and `AgentSessionService`.
- `core/src/services/session/` owns the per-channel agent lifecycle, persistence, prompt assembly, compaction, and workspace tools.
- `packages/shared-model/` and `packages/plugin-sdk/` provide cross-package contracts so providers and plugins can register into the core at runtime.
## Layers
- Purpose: Bootstrap the Koishi plugin and register services.
- Location: `core/src/index.ts`
- Contains: Koishi schema config and `apply(ctx, config)`.
- Depends on: `core/src/services/model/`, `core/src/services/plugin/`, `core/src/services/session/`.
- Used by: Koishi runtime when loading `koishi-plugin-yesimbot`.
- Purpose: Expose shared runtime registries for models and tools.
- Location: `core/src/services/model/service.ts`, `core/src/services/plugin/service.ts`
- Contains: provider registry, tool registry, Koishi command setup.
- Depends on: `packages/shared-model/`, `packages/plugin-sdk/`.
- Used by: `core/src/services/session/runtime/channel-runtime.ts` and provider/plugin packages.
- Purpose: Own one runtime per channel and route incoming events.
- Location: `core/src/services/session/service.ts`
- Contains: middleware, management commands, channel bootstrap, runtime cache.
- Depends on: `session-manager.ts`, `settings-manager.ts`, `runtime/`, `scaffold.ts`, `resource-loader.ts`.
- Used by: Koishi message pipeline and admin commands.
- Purpose: Run LLM turns, tool calls, willingness checks, and compaction.
- Location: `core/src/services/session/runtime/channel-runtime.ts`
- Contains: `ToolLoopAgent` setup, response state machine, compaction trigger, follow-up handling.
- Depends on: `response-step-processor.ts`, `workspace-tools.ts`, `compaction/`, `willingness.ts`, `resource-loader.ts`.
- Used by: `AgentSessionService` per channel.
- Purpose: Store append-only session history and reconstruct runtime context.
- Location: `core/src/services/session/session-manager.ts`
- Contains: JSONL session format, append/rewrite logic, session context conversion.
- Depends on: Node filesystem APIs, AI SDK model message types.
- Used by: `channel-runtime.ts`, tests in `core/tests/session/`.
- Purpose: Provide file, shell, and sandbox tools to the agent.
- Location: `core/src/services/session/workspace/`
- Contains: `workspace.ts`, `filesystem.ts`, `sandbox.ts`, `helpers.ts`, tool type definitions.
- Depends on: session settings and local filesystem/sandbox implementations.
- Used by: `workspace-tools.ts`.
## Data Flow
- Per-channel runtime state lives in `ChannelRuntime` instances cached by `AgentSessionService`.
- Durable conversation state lives in JSONL sessions managed by `SessionManager`.
- Configuration precedence is handled by `SettingsManager` with defaults, global settings, then workspace overrides.
## Key Abstractions
- Purpose: Encapsulate one channel's agent loop, abort handling, and compaction policy.
- Examples: `core/src/services/session/runtime/channel-runtime.ts`
- Pattern: Stateful service object with cached `ToolLoopAgent` and explicit response state.
- Purpose: Append-only session store and context reconstruction.
- Examples: `core/src/services/session/session-manager.ts`
- Pattern: JSONL persistence with header + linear entry chain.
- Purpose: Layer Koishi config, global `settings.json`, and per-workspace `settings.json`.
- Examples: `core/src/services/session/settings-manager.ts`
- Pattern: Snapshot + metadata object that reports conflicts and validation issues.
- Purpose: Register and resolve model backends by `provider:modelId`.
- Examples: `packages/shared-model/src/types.ts`, `core/src/services/model/service.ts`
- Pattern: Registry contract exported from shared model package and consumed by providers.
- Purpose: Define plugin metadata and AI tools for external integrations.
- Examples: `packages/plugin-sdk/src/plugin.ts`, `packages/plugin-sdk/src/tools/index.ts`
- Pattern: Decorator-driven tool registration with Koishi lifecycle hooks.
## Entry Points
- Location: `core/src/index.ts`
- Triggers: Koishi loads the package.
- Responsibilities: define config schema, register core services.
- Location: `providers/openai/src/index.ts`, `providers/anthropic/src/index.ts`, `providers/google/src/index.ts`, `providers/deepseek/src/index.ts`
- Triggers: Koishi loads provider plugin packages.
- Responsibilities: create AI SDK clients and register them with `yesimbot.model`.
- Location: `plugins/search-service/src/index.ts`, `plugins/mcp-client/src/index.ts`
- Triggers: Koishi loads optional plugin packages.
- Responsibilities: register AI tools into `yesimbot.plugin`.
## Error Handling
- Fail fast on invalid model IDs, missing providers, and invalid session settings.
- Recover locally for runtime failures with logging and skipped turns where possible.
- `core/src/services/session/service.ts` catches bootstrap and reload failures and returns command-friendly summaries.
- `core/src/services/session/runtime/channel-runtime.ts` wraps turn execution in abort/time-out handling and logs failures with channel context.
- `core/src/services/session/settings-manager.ts` records validation issues and conflicts instead of throwing for bad config files.
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->
