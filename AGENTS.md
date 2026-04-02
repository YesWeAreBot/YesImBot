# Athena Agent Guide

## Project Snapshot

- Athena is a Yarn 4 + Turbo TypeScript monorepo for Koishi-based LLM agents.
- This root guide covers only the active mainline workspaces: `core/`, `packages/shared-model/`, `packages/plugin-sdk/`, `providers/*`, and `plugins/*`.
- Main package roles: `core/` is the primary runtime, `packages/shared-model/` holds shared contracts, `packages/plugin-sdk/` defines extension APIs, `providers/*` implement model providers, and `plugins/*` add optional integrations.
- Root workspace aliases come from `tsconfig.json`: `koishi-plugin-yesimbot` -> `core/src`, `@yesimbot/*` -> `packages/*/src`.
- Checked for repo-specific editor rules: no `.cursor/rules/`, no `.cursorrules`, and no `.github/copilot-instructions.md` were found at review time.

## Workspace Commands

### Root Commands

- Build all workspaces: `yarn build`
- Typecheck all workspaces: `yarn typecheck`
- Lint all workspaces: `yarn lint`
- Lint with fixes where supported: `yarn lint:fix`
- Format all workspaces: `yarn fmt`
- Check formatting only: `yarn fmt:check`
- Run package tests wired into Turbo: `yarn test`
- Clean build outputs: `yarn clean`

### Preferred Targeted Commands

- Prefer running targeted work from the repository root with Turbo filters.
- Build one package: `yarn turbo run build --filter=<package-name>`
- Typecheck one package: `yarn turbo run typecheck --filter=<package-name>`
- Lint one package: `yarn turbo run lint --filter=<package-name>`
- Test one package: `yarn turbo run test --filter=<package-name>`
- Use `yarn workspace <package-name> <script>` only as a secondary fallback when a
  root-level Turbo command is not practical.
- The old README example `yarn test -p core` is stale; prefer Turbo filters from the root.

### Important Workspace Names

- Core: `koishi-plugin-yesimbot`
- Shared model: `@yesimbot/shared-model`
- Plugin SDK: `@yesimbot/plugin-sdk`
- Plugins: `@yesimbot/koishi-plugin-search-service`, `@yesimbot/koishi-plugin-mcp-client`
- Providers: `@yesimbot/koishi-plugin-provider-openai`, `@yesimbot/koishi-plugin-provider-anthropic`, `@yesimbot/koishi-plugin-provider-google`, `@yesimbot/koishi-plugin-provider-deepseek`

### Package-Local Commands

- `yarn workspace koishi-plugin-yesimbot build|typecheck|lint|test|fmt`
- `yarn workspace @yesimbot/plugin-sdk build|typecheck|lint|fmt`
- `yarn workspace @yesimbot/shared-model build|typecheck|lint|fmt`
- `providers/*` and `plugins/*` generally expose `build`, `typecheck`, `lint`, and `fmt`, but usually no package-level `test` script.

### Testing Guidance

- Active package test suites currently live in `core/tests/**/*.test.ts`.
- `packages/plugin-sdk/`, `packages/shared-model/`, `providers/*`, and `plugins/*` currently do not define package-level test scripts.
- Run one core test file from the root: `yarn turbo run test --filter=koishi-plugin-yesimbot -- tests/session/session-restore.test.ts`
- From inside `core/`: `yarn test tests/session/session-restore.test.ts`
- Run one exact core case: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/session/channel-agent-step-finish.test.ts -t "normalizes assistant reasoning blocks and usage metadata into AgentMessage payloads"`
- For `packages/plugin-sdk/`, use `yarn turbo run typecheck --filter=@yesimbot/plugin-sdk` and `yarn turbo run build --filter=@yesimbot/plugin-sdk` until a real test surface is added.
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
- Finish exported contract changes with package-level `typecheck` and `build`.

## Git And Workspace Hygiene

- Prefer branch isolation by default; do not create a git worktree unless the user explicitly asks for one.
- Never revert user changes you did not make unless explicitly requested.
- Avoid destructive git commands such as `git reset --hard` or `git checkout --` unless explicitly requested.
- Do not amend commits unless the user explicitly asks for it.

## Reference Documentation And Resources

- `node_modules/ai/docs` for local AI SDK reference docs.
- `references/koishi-docs/zh-CN` for Koishi plugin lifecycle, services, middleware, and session APIs.
- `references/koishi-docs/zh-CN/guide/plugin/service.md` for Koishi service structure and lifecycle.
- `references/pi-mono/packages/coding-agent` for session persistence and coding-agent runtime patterns.
- `references/pi-mono/packages/coding-agent/docs` for session and settings behavior.
- `references/pi-mono/packages/ai` for model abstraction and tool-call primitives.
- `references/letta`, `references/openclaw/docs`, and `references/plast-mem` for agent orchestration and memory design references.
- `references/vercel-chat/skills/chat/SKILL.md` and `references/vercel-chat/apps/docs/content/docs/concurrency.mdx` for best practices to build chat-bot via ai-sdk.
