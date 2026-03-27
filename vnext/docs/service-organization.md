# Athena vNext Service Organization

This document defines the Koishi service topology and service-boundary admission rules for vnext.

## Top-level service topology

Athena vNext uses exactly three top-level Koishi services:

1. `athena.models`
2. `athena.session`
3. `athena.listener`

### Dependency chain

- `athena.models`: no dependencies (startup root)
- `athena.session`: `static inject = ["athena.models"]`
- `athena.listener`: `static inject = ["athena.session"]`

Registration order must follow this chain:

```ts
ctx.plugin(ModelsService, { ... });
ctx.plugin(SessionService, { ... });
ctx.plugin(ListenerService, {});
```

## Responsibilities

### `athena.models`

- Owns `AuthStorage` and `ModelRegistry`
- Applies runtime environment key overrides
- Exposes model schema projection and model command surfaces

### `athena.session`

- Owns per-channel session pool and lifecycle
- Exposes `receive(event)` as listener ingress boundary
- Owns willingness, message formatting, rate-limiting, tool wiring, prompt loading, and response dispatch

### `athena.listener`

- Thin Koishi message listener
- Extracts Koishi session fields into `ChannelEvent`
- Routes to `this.ctx["athena.session"].receive(event)`
- Must not contain business logic (no willingness/format/rate-limit decisions)

## Admission rules for adding a new top-level service

A new top-level service is allowed only if all conditions are true:

1. It has full Koishi Service lifecycle ownership (`constructor/start/dispose`).
2. It provides a clear, stable external capability boundary.
3. It is safely consumable by external modules through explicit service APIs.

If any condition is not met, keep the code as an internal module inside an existing service.

## Internal module rules

`athena.session` may use functional internal subdirectories:

- `tool/`
- `response/`
- `prompt/`

Generic bucket names are prohibited inside services:

- `runtime/`
- `utils/`
- `helpers/`
- `shared/`
- `common/`
- `lib/`

## Expected directory structure

```text
vnext/src/services/
+-- models/          # athena.models - AuthStorage + ModelRegistry + schema projection
|   +-- service.ts
|   +-- types.ts
|   +-- index.ts
+-- session/         # athena.session - pool + lifecycle + business logic
|   +-- service.ts
|   +-- types.ts
|   +-- index.ts
|   +-- willingness.ts
|   +-- format.ts
|   +-- rate-limiter.ts
|   +-- tool/
|   +-- response/
|   +-- prompt/
+-- listener/        # athena.listener - thin Koishi event router
    +-- service.ts
    +-- types.ts
    +-- index.ts
```
