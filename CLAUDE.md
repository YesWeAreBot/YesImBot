# Project: Athena (YesImBot v4)

Koishi 4.x plugin monorepo. See `.planning/PROJECT.md` for full context.

## Koishi Service Pattern

**MUST** use `Service` subclass pattern. **NEVER** use `ctx.provide()` or manual `ctx[name] = ...`.

### Providing a service

```ts
import { Context, Service } from 'koishi'

// 1. Declaration merging (required for type safety)
declare module 'koishi' {
  interface Context {
    'my-service': MyService
  }
}

// 2. Extend Service — this IS a valid plugin
class MyService extends Service {
  constructor(ctx: Context, config: Config) {
    // immediate=true if no async init needed, false to wait for ready event
    super(ctx, 'my-service', true)
  }
}

// 3. Load as sub-plugin in parent
export function apply(ctx: Context, config: Config) {
  ctx.plugin(MyService, config)
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

- **Always run `typecheck` before `build`** — Use `turbo run build` which automatically runs typecheck via turbo task dependencies
- Individual package typecheck: `yarn typecheck` (runs `tsc --noEmit` via turbo)
- Turbo pipeline ensures typecheck completes for all dependencies before build starts

## Logger Pattern

**MUST** create logger once, then use it. **NEVER** chain `.info()` on `ctx.logger()` call.

```ts
// ✓ Correct
const logger = ctx.logger('my-plugin')
logger.info('message')

// ✓ Also correct (uses default logger)
ctx.logger.info('message')

// ✗ Wrong - creates new logger each call
ctx.logger('my-plugin').info('message')
```

## Service Typing

When extending `Service` with config:
- Use generic parameter: `class MyService extends Service<MyConfig>`
- Don't declare duplicate `private config` field (inherited from base class)
- Koishi plugin system resolves config injection automatically
