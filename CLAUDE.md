# Project: Athena (YesImBot v4)

Koishi 4.x plugin monorepo. See `.planning/PROJECT.md` for full context.

## Koishi Service Pattern

**MUST** use `Service` subclass pattern. **NEVER** use `ctx.provide()` or manual `ctx[name] = ...`.

### Providing a service

```ts
import { Context, Service } from "koishi";

// 1. Declaration merging (required for type safety)
declare module "koishi" {
  interface Context {
    "my-service": MyService;
  }
}

// 2. Extend Service — this IS a valid plugin
class MyService extends Service {
  constructor(ctx: Context, config: Config) {
    // immediate=true if no async init needed, false to wait for ready event
    super(ctx, "my-service", true);
  }
}

// 3. Load as sub-plugin in parent
export function apply(ctx: Context, config: Config) {
  ctx.plugin(MyService, config);
}
```

### Consuming a service

```ts
// inject declares dependency — plugin won't load until service exists
export const inject = ['my-service']
// or: inject = { required: ['my-service'], optional: ['other'] }

export function apply(ctx: Context) {
  ctx['my-service'].doSomething()

  // Partial dependency via sub-plugin
  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry(...)
  })
}
```

### Key rules

- Service subclass auto-registers on construct, auto-removes on dispose
- Dependent plugins auto-rollback when service is removed, auto-reload when re-provided
- `ctx.on('dispose', ...)` in service methods uses caller's context (supports hot-reload cleanup)
- `package.json` should declare `koishi.service.implements` / `required` / `optional`

## Build Workflow

- **Always run `typecheck` before `build`** — Use `yarn build` which automatically runs typecheck via turbo task dependencies
- Individual package typecheck: `yarn typecheck` (runs `tsc --noEmit` via turbo)
- Turbo pipeline ensures typecheck completes for all dependencies before build starts

## Logger Pattern

**MUST** create logger once, then use it. **NEVER** chain `.info()` on `ctx.logger()` call.

```ts
// ✓ Correct
const logger = ctx.logger("my-plugin");
logger.info("message");

// ✓ Also correct (uses default logger)
ctx.logger.info("message");

// ✗ Wrong - creates new logger each call
ctx.logger("my-plugin").info("message");
```

## Service Typing

When extending `Service` with config:

- Use generic parameter: `class MyService extends Service<MyConfig>`
- Don't declare duplicate `private config` field (inherited from base class)
- Koishi plugin system resolves config injection automatically

## Type Lint Rules

- **No explicit `any`** — Use proper types or `ReturnType<T>` / `Awaited<T>` to extract from functions
- **Prefer type inference** — Let TypeScript infer return types; annotate only when necessary for public APIs

## Reference Materials

### Previous Versions

- `references/YesImBot-v3/` — v3 发布版，功能最完整的版本。基于 xsai，Bun monorepo。包含动态 Schema 联动、Circuit breaker 熔断、成熟的意愿值系统（指数衰减+S 曲线增益）、6 个内置工具扩展、核心记忆块系统。迁移功能时优先参考。
- `references/YesImBot-dev/` — v3→v4 过渡版。已迁移到 Yarn monorepo，引入 Horizon 替代 WorldState，增加 ChatMode 机制。仍基于 xsai。意愿值系统在 v3 基础上增强（对话热度检测、弹性衰减）。

### Design Documents

- `books/` — 作者关于架构的思考记录（仅人类发言，去除了 AI 回复）。涵盖模块化模型服务、异步任务系统、记忆系统演进、工具调用范式、拟人化唤醒机制、记忆检索方案。体现对系统的核心愿景：连续性（L1/L2/L3 记忆）、关系性（社交网络理解）、主体性（内部状态与目标）。
- `docs/` — 完整的架构讨论文档。包含 Horizon 模块重构、Plugin 模块设计、上下文管理缺陷分析、智能上下文管理器方案等。关键设计决策：Horizon 作为数据访问层而非决策层、ChatMode 动态注册、Tool/Action 分离、反自我强化机制。
