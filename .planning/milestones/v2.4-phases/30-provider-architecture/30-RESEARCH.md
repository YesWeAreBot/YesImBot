# Phase 30: Provider Architecture - Research

**Researched:** 2026-02-26
**Domain:** TypeScript abstract class refactoring, Koishi class-form plugins, Koishi Schema factory
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- `AbstractProvider` is an abstract class in `shared-model`, NOT a Koishi Service (Service only allows single registration; providers use `reusable = true` for multiple instances)
- Provider plugins `export default class` extending AbstractProvider — the class itself IS a valid Koishi class-form plugin (`constructor(ctx, config)`)
- No `apply()` wrapper needed; Koishi loads class plugins directly
- AbstractProvider encapsulates: `listModels()`, `getDefaultParams()`, `getModel()`, and registration flow
- Subclasses implement only `createClient()` returning an SDK instance
- `getModel()` is in AbstractProvider (all providers use `client.chat(modelId)` identically)
- Constructor auto-registers with `ctx['yesimbot.model'].registerProvider(this)` — subclasses don't handle registration
- `createProviderSchema()` factory function generates the complete common Schema (id, apiKey, baseURL, models[], defaultParams)
- Parameterized: accepts `{ extra, defaults, defaultModels }` — subclass passes provider-specific fields, default values, and default model list
- Anthropic passes `extra: Schema.object({ projectId, sessionId })` to add its unique fields
- Default models are also parameterized (OpenAI: gpt-4o, DeepSeek: deepseek-chat/reasoner, Anthropic: claude series)
- Models stay as array form `[{id, name, ...}]` for Koishi Console table display compatibility
- `createClient()` is the sole extension point — subclasses handle all SDK initialization inside it (including Anthropic's custom fetch interceptor for user_id injection)
- No additional lifecycle hooks (beforeRequest/afterResponse etc.) — not needed
- Provider-specific helper methods (Anthropic's `buildUserId`, `isJsonContentType`, `parseBody`) stay inside the subclass, not promoted to AbstractProvider
- No backward compatibility needed (no published version yet) — free to redesign completely
- Delete `ModelDefaultParams` interface from shared-model; use ai-sdk's `CallSettings` directly (SDK handles aliases internally)
- Global `defaultParams` at provider level (not per-model) to keep models array concise
- Advanced override: textarea field (`Schema.string().role('textarea', { rows: [2, 4] })`) for user-written JSON covering headers, options, per-model parameter overrides etc.
- JSON parse failure: log warning, don't throw, don't apply the override — graceful degradation
- One-shot migration: all three providers converted to AbstractProvider simultaneously in one pass
- Each provider should shrink from ~113 lines to ~30-40 lines

### Claude's Discretion

- Exact `createProviderSchema()` parameter interface shape
- How advanced JSON override merges with base config
- Internal organization of AbstractProvider methods
- Whether to split AbstractProvider and schema factory into separate files

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                                                                                                                           | Research Support                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-05 | BaseProvider abstract class encapsulates listModels, getDefaultParams, registration flow; createBaseProviderSchema() factory; three providers inherit, no duplication | AbstractProvider pattern in shared-model; Koishi class-form plugin with static reusable; Schema.intersect for extra fields; CallSettings from ai-sdk replaces ModelDefaultParams |

</phase_requirements>

## Summary

This phase is a pure TypeScript refactoring — no new runtime behavior, no new dependencies. The three provider plugins (OpenAI, DeepSeek, Anthropic) share ~80 lines of identical boilerplate: the same Schema shape, the same `listModels()` / `getDefaultParams()` / `getModel()` implementations, and the same `registerProvider()` call in `apply()`. The goal is to extract that boilerplate into `AbstractProvider` in `shared-model` and a `createProviderSchema()` factory, leaving each provider with only its `createClient()` specialization.

The key architectural insight is that `AbstractProvider` is NOT a Koishi `Service` — it is a plain abstract class that implements `IModelProvider`. The class-form plugin pattern (`export default class Foo { constructor(ctx, config) {} }`) is the correct Koishi idiom for reusable plugins. `static reusable = true` on the subclass is the class-form equivalent of `export const reusable = true`. The constructor calls `ctx['yesimbot.model'].registerProvider(this)` directly, and the `ModelService.registerProvider()` already handles dispose cleanup via `caller.on('dispose', ...)` using `this[Context.current]`.

The `ModelDefaultParams` interface in `shared-model` is redundant with ai-sdk's `CallSettings` type (exported from `ai`). `CallSettings` uses `maxOutputTokens` (not `maxTokens`) and covers all the same fields. The current providers incorrectly use `maxTokens` in their config interfaces — this migration is the right moment to align with the SDK's canonical field names.

**Primary recommendation:** Implement AbstractProvider as a plain abstract class in `shared-model/src/providers/abstract-provider.ts`, add `createProviderSchema()` in `shared-model/src/providers/schema-factory.ts`, delete `ModelDefaultParams`, update `IModelProvider` to use `CallSettings`, then convert all three providers in one pass.

## Standard Stack

### Core

| Library                | Version      | Purpose                                           | Why Standard                                                           |
| ---------------------- | ------------ | ------------------------------------------------- | ---------------------------------------------------------------------- |
| koishi                 | ^4.18.3      | Plugin framework, Schema, Context                 | Already in use; class-form plugin is documented pattern                |
| ai (Vercel AI SDK)     | ^6.0.0       | `CallSettings` type, `generateText`, `streamText` | Already in use; `CallSettings` is the canonical param type             |
| @yesimbot/shared-model | workspace:\* | AbstractProvider, schema factory, IModelProvider  | Internal shared package — correct home for cross-provider abstractions |

### Supporting

| Library           | Version | Purpose             | When to Use                         |
| ----------------- | ------- | ------------------- | ----------------------------------- |
| @ai-sdk/openai    | ^3.0.0  | `createOpenAI()`    | OpenAI provider `createClient()`    |
| @ai-sdk/deepseek  | ^3.0.0  | `createDeepSeek()`  | DeepSeek provider `createClient()`  |
| @ai-sdk/anthropic | ^3.0.47 | `createAnthropic()` | Anthropic provider `createClient()` |

### Alternatives Considered

| Instead of                          | Could Use                              | Tradeoff                                                                           |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| Plain abstract class                | Koishi Service subclass                | Service only allows one registration; providers need reusable=true multi-instance  |
| `CallSettings` from `ai`            | Keep `ModelDefaultParams`              | ModelDefaultParams is a subset duplicate; CallSettings is the SDK's canonical type |
| `Schema.intersect` for extra fields | Separate Config interface per provider | intersect composes schemas cleanly in Koishi Console UI                            |

**Installation:** No new packages needed — all dependencies already present.

## Architecture Patterns

### Recommended File Structure

```
packages/shared-model/src/
├── index.ts                    # re-export everything
├── types/
│   ├── model.ts                # IModelProvider (updated), IModelService, ModelInfo, Modality
│   └── errors.ts               # unchanged
├── utils/
│   └── model-id.ts             # unchanged
└── providers/
    ├── abstract-provider.ts    # AbstractProvider abstract class
    └── schema-factory.ts       # createProviderSchema() factory

providers/provider-openai/src/index.ts      # ~35 lines after migration
providers/provider-deepseek/src/index.ts    # ~35 lines after migration
providers/provider-anthropic/src/index.ts   # ~45 lines after migration (custom fetch)
```

### Pattern 1: Koishi Class-Form Plugin with static reusable

**What:** A class with `constructor(ctx, config)` is a valid Koishi plugin. `static reusable = true` is the class-form equivalent of `export const reusable = true`.

**When to use:** When the plugin is a class (not a function), and multiple instances must be loadable simultaneously.

**Example:**

```typescript
// Source: references/koishi-docs/en-US/guide/plugin/lifecycle.md
export default class Bar {
  static reusable = true;
  constructor(ctx: Context, config: Bar.Config) {
    // plugin logic here
  }
}

namespace Bar {
  export interface Config {}
  export const Config: Schema<Config> = Schema.object({});
}
```

The `name`, `inject`, and `Config` meta-properties must be on the class (as static properties or via namespace) when using default export class form.

### Pattern 2: AbstractProvider as Plain Abstract Class

**What:** AbstractProvider implements IModelProvider, holds ctx and config, calls registerProvider in constructor, delegates createClient() to subclasses.

**When to use:** Shared logic across multiple plugin classes that are NOT services.

**Example:**

```typescript
// Source: codebase analysis of existing providers + Koishi docs
import { Context } from "koishi";
import type { LanguageModel } from "ai";
import type { CallSettings } from "ai";
import { IModelProvider, ModelInfo } from "./types/model";

export abstract class AbstractProvider<
  TClient,
  TConfig extends BaseProviderConfig,
> implements IModelProvider {
  readonly id: string;
  readonly models: ModelInfo[];
  protected client: TClient;
  protected ctx: Context;
  protected config: TConfig;

  constructor(ctx: Context, config: TConfig) {
    this.ctx = ctx;
    this.config = config;
    this.id = config.id;
    this.client = this.createClient(config);
    this.models = config.models.map((m) => ({
      id: m.id,
      tool_call: m.tool_call,
      reasoning: m.reasoning,
      modalities: m.modalities,
    }));
    ctx["yesimbot.model"].registerProvider(config.id, this);
  }

  protected abstract createClient(config: TConfig): TClient;
  abstract readonly providerType: string;

  getModel(modelId: string): LanguageModel {
    return (this.client as any).chat(modelId);
  }

  listModels(): Record<string, ModelInfo> {
    return Object.fromEntries(this.models.map((m) => [m.id, m]));
  }

  getDefaultParams(): CallSettings {
    return this.config.defaultParams ?? {};
  }
}
```

### Pattern 3: createProviderSchema() Factory

**What:** A function that returns a complete Koishi Schema for the common provider config fields, parameterized by provider-specific defaults and optional extra fields.

**When to use:** When multiple plugins share the same schema shape with minor variations.

**Example:**

```typescript
// Source: codebase analysis + Koishi schema docs
import { Schema } from "koishi";
import { Modality, ModelInfo } from "../types/model";

export interface ProviderSchemaOptions<TExtra = Record<string, never>> {
  defaultId: string;
  defaultBaseURL: string;
  defaultModels: ModelInfo[];
  extra?: Schema<TExtra>;
}

export function createProviderSchema<TExtra = Record<string, never>>(
  opts: ProviderSchemaOptions<TExtra>,
) {
  const base = Schema.object({
    id: Schema.string().default(opts.defaultId),
    apiKey: Schema.string().role("secret").required(),
    baseURL: Schema.string().default(opts.defaultBaseURL),
    models: Schema.array(
      Schema.object({
        id: Schema.string().required(),
        tool_call: Schema.boolean().default(true),
        reasoning: Schema.boolean().default(false),
        modalities: Schema.array(
          Schema.union([
            Schema.const(Modality.Audio),
            Schema.const(Modality.Image),
            Schema.const(Modality.Pdf),
            Schema.const(Modality.Text),
            Schema.const(Modality.Video),
          ]),
        )
          .default([Modality.Text])
          .role("checkbox"),
      }),
    )
      .default(opts.defaultModels)
      .role("table"),
    defaultParams: Schema.object({
      temperature: Schema.number().default(0.7),
      maxOutputTokens: Schema.number().default(2048),
      topP: Schema.number().default(1.0),
    }),
    advancedOverride: Schema.string()
      .role("textarea", { rows: [2, 4] })
      .default("")
      .description(
        "JSON override for headers, options, per-model params. Parse errors are ignored.",
      ),
  });

  if (opts.extra) {
    return Schema.intersect([base, opts.extra]) as Schema<any>;
  }
  return base;
}
```

### Pattern 4: Subclass Provider (post-migration shape)

**What:** Each provider becomes a thin class that only implements `createClient()` and declares its `providerType`.

**Example (OpenAI after migration):**

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { AbstractProvider, createProviderSchema } from "@yesimbot/shared-model";
import { Context } from "koishi";
import type { IModelService } from "@yesimbot/shared-model";

declare module "koishi" {
  interface Context {
    "yesimbot.model": IModelService;
  }
}

export default class OpenAIProvider extends AbstractProvider<
  ReturnType<typeof createOpenAI>,
  OpenAIProvider.Config
> {
  static reusable = true;
  static inject = ["yesimbot.model"];
  readonly providerType = "openai";

  protected createClient(config: OpenAIProvider.Config) {
    return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }
}

namespace OpenAIProvider {
  export type Config = ReturnType<typeof OpenAIProvider.Config.parse>;
  export const Config = createProviderSchema({
    defaultId: "openai",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: [
      { id: "gpt-4o", tool_call: true, reasoning: false, modalities: ["text", "image"] },
    ],
  });
}
```

### Anti-Patterns to Avoid

- **Extending Koishi Service for AbstractProvider:** Service enforces single-instance semantics. Providers need `reusable = true` multi-instance. Use plain abstract class.
- **Keeping `apply()` wrapper:** The class constructor IS the plugin entry point. `apply()` is redundant and creates a double-registration risk.
- **Keeping `ModelDefaultParams`:** It duplicates `CallSettings` from ai-sdk with slightly different field names (`maxTokens` vs `maxOutputTokens`). Delete it and use `CallSettings` directly.
- **Putting `registerProvider()` in subclass constructors:** AbstractProvider constructor handles registration. Subclasses must call `super(ctx, config)` first — registration happens automatically.
- **Throwing on JSON parse failure for advancedOverride:** The decision is log-warn-and-skip. Never throw; graceful degradation is required.
- **Promoting Anthropic helpers to AbstractProvider:** `buildUserId`, `isJsonContentType`, `parseBody` are Anthropic-specific. They stay in the Anthropic subclass.

## Don't Hand-Roll

| Problem                              | Don't Build                                 | Use Instead                                                                                             | Why                                                                               |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Schema composition with extra fields | Custom merge logic                          | `Schema.intersect([base, extra])`                                                                       | Koishi's built-in composition; renders correctly in Console UI                    |
| Provider dispose cleanup             | Manual dispose tracking in AbstractProvider | `ModelService.registerProvider()` already calls `caller.on('dispose', ...)` via `this[Context.current]` | Already implemented in ModelService; AbstractProvider just calls registerProvider |
| Call parameter type                  | Custom `ModelDefaultParams` interface       | `CallSettings` from `ai` package                                                                        | SDK-canonical type; avoids field name mismatches (maxTokens vs maxOutputTokens)   |
| Plugin meta-properties on class      | Separate export statements                  | Static class properties (`static reusable`, `static inject`) + namespace for `Config`                   | Koishi class-form plugin pattern; documented in official docs                     |

**Key insight:** The ModelService already handles the full provider lifecycle (registration, dispose cleanup, schema refresh). AbstractProvider only needs to call `registerProvider(config.id, this)` in its constructor — no additional lifecycle management needed.

## Common Pitfalls

### Pitfall 1: `this[Context.current]` in registerProvider

**What goes wrong:** `ModelService.registerProvider()` uses `this[Context.current]` to get the calling plugin's context for dispose cleanup. If AbstractProvider calls `registerProvider` in its constructor, `this[Context.current]` correctly resolves to the provider plugin's context — this is the intended behavior.

**Why it happens:** Koishi's context system tracks the "current" plugin context during plugin initialization. The constructor runs during plugin load, so `Context.current` is set correctly.

**How to avoid:** Call `ctx['yesimbot.model'].registerProvider(config.id, this)` in AbstractProvider's constructor (not in a `ready` event or deferred callback). The timing is correct during construction.

**Warning signs:** If dispose cleanup doesn't fire when a provider plugin is unloaded, the registerProvider call was deferred past the constructor.

### Pitfall 2: `maxTokens` vs `maxOutputTokens` field name mismatch

**What goes wrong:** Current providers define `defaultParams.maxTokens` in their Config interfaces, but `CallSettings` from ai-sdk uses `maxOutputTokens`. The ModelService merges `{ ...defaults, ...params }` — if the field name is wrong, the SDK ignores it silently.

**Why it happens:** The `ModelDefaultParams` interface used `maxOutputTokens` (correct), but the provider Config interfaces declared `maxTokens` (wrong). The two types diverged.

**How to avoid:** Delete `ModelDefaultParams`. Use `CallSettings` from `ai` as the type for `defaultParams` in `BaseProviderConfig`. The Schema field should be named `maxOutputTokens` to match.

**Warning signs:** Model responses ignore token limits; generation runs to model's default max.

### Pitfall 3: Static meta-properties on class-form plugins

**What goes wrong:** `export const reusable = true` and `export const inject = [...]` work for namespace-export plugins. For `export default class`, these must be `static reusable = true` and `static inject = [...]` on the class itself.

**Why it happens:** Koishi reads meta-properties from the plugin object. For a class, the plugin object IS the class constructor — so properties must be on the constructor (static), not on instances.

**How to avoid:** Use `static reusable = true` and `static inject = ["yesimbot.model"]` on the subclass. Do NOT export separate `const reusable` or `const inject` alongside a default class export.

**Warning signs:** Provider loads only once even when configured multiple times; or inject dependency is not respected.

### Pitfall 4: AbstractProvider generic type complexity

**What goes wrong:** Over-engineering the generic parameters on AbstractProvider leads to TypeScript inference failures in subclasses, especially with `ReturnType<typeof createOpenAI>` as the client type.

**Why it happens:** TypeScript's structural typing means the client type only needs to satisfy `.chat(modelId)` returning `LanguageModel`. Over-constraining the generic breaks inference.

**How to avoid:** Keep AbstractProvider generic as `AbstractProvider<TClient, TConfig extends BaseProviderConfig>`. The `getModel()` method can use `(this.client as any).chat(modelId)` or define a minimal `HasChat` interface. Don't try to type the full SDK client shape.

**Warning signs:** TypeScript errors in subclass `createClient()` return type; "Type X is not assignable to TClient" errors.

### Pitfall 5: Schema.intersect type inference for Config

**What goes wrong:** `Schema.intersect([base, extra])` returns `Schema<BaseConfig & ExtraConfig>` but TypeScript may not infer the intersection type correctly for the `Config` namespace type alias.

**Why it happens:** Koishi's Schema type inference for intersect can be imprecise. The `Config` type in the namespace needs to be explicitly typed or use `ReturnType<typeof Config.parse>`.

**How to avoid:** In the Anthropic subclass namespace, declare `export type Config = ReturnType<typeof AnthropicProvider.Config.parse>` rather than manually writing the intersection type. This lets TypeScript infer from the schema.

**Warning signs:** TypeScript errors when accessing `config.projectId` or `config.sessionId` in the Anthropic subclass constructor.

## Code Examples

Verified patterns from official sources and codebase analysis:

### AbstractProvider base class (complete)

```typescript
// Source: codebase analysis of existing providers + Koishi lifecycle docs
import type { Context } from "koishi";
import type { LanguageModel } from "ai";
import type { CallSettings } from "ai";
import type { IModelProvider, IModelService, ModelInfo } from "../types/model";

export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL: string;
  models: ModelInfo[];
  defaultParams?: Partial<CallSettings>;
  advancedOverride?: string;
}

declare module "koishi" {
  interface Context {
    "yesimbot.model": IModelService;
  }
}

export abstract class AbstractProvider<
  TClient extends { chat(modelId: string): LanguageModel },
  TConfig extends BaseProviderConfig,
> implements IModelProvider {
  readonly id: string;
  readonly models: ModelInfo[];
  abstract readonly providerType: string;
  protected client: TClient;
  protected ctx: Context;
  protected config: TConfig;

  constructor(ctx: Context, config: TConfig) {
    this.ctx = ctx;
    this.config = config;
    this.id = config.id;
    this.client = this.createClient(config);
    this.models = config.models.map((m) => ({
      id: m.id,
      tool_call: m.tool_call,
      reasoning: m.reasoning,
      modalities: m.modalities,
    }));
    ctx["yesimbot.model"].registerProvider(config.id, this);
  }

  protected abstract createClient(config: TConfig): TClient;

  getModel(modelId: string): LanguageModel {
    return this.client.chat(modelId);
  }

  listModels(): Record<string, ModelInfo> {
    return Object.fromEntries(this.models.map((m) => [m.id, m]));
  }

  getDefaultParams(): Partial<CallSettings> {
    return this.config.defaultParams ?? {};
  }
}
```

### IModelProvider interface update (remove ModelDefaultParams dependency)

```typescript
// Source: packages/shared-model/src/types/model.ts — updated version
import type { LanguageModel } from "ai";
import type { CallSettings } from "ai";

// DELETE: ModelDefaultParams interface
// USE: CallSettings from "ai" directly

export interface IModelProvider {
  readonly id: string;
  readonly providerType: string;
  readonly models: ModelInfo[];
  listModels(): Record<string, ModelInfo>;
  getModel(modelId: string): LanguageModel;
  getDefaultParams(): Partial<CallSettings>;
}
```

### Anthropic subclass (most complex — custom fetch interceptor stays in createClient)

```typescript
// Source: codebase analysis of providers/provider-anthropic/src/index.ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { AbstractProvider, createProviderSchema } from "@yesimbot/shared-model";
import { Context } from "koishi";

export default class AnthropicProvider extends AbstractProvider<
  ReturnType<typeof createAnthropic>,
  AnthropicProvider.Config
> {
  static reusable = true;
  static inject = ["yesimbot.model"];
  readonly providerType = "anthropic";

  protected createClient(config: AnthropicProvider.Config) {
    return createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      fetch: async (url, init) => {
        // ... Anthropic-specific user_id injection logic stays here
        // buildUserId, isJsonContentType, parseBody helpers stay as module-level functions
      },
    });
  }
}

namespace AnthropicProvider {
  export type Config = ReturnType<typeof AnthropicProvider.Config.parse>;
  export const Config = createProviderSchema({
    defaultId: "anthropic",
    defaultBaseURL: "https://api.anthropic.com",
    defaultModels: [
      { id: "claude-sonnet-4-6", tool_call: true, reasoning: false, modalities: ["text", "image"] },
      { id: "claude-opus-4-6", tool_call: true, reasoning: false, modalities: ["text", "image"] },
      {
        id: "claude-haiku-4-5-20251001",
        tool_call: true,
        reasoning: false,
        modalities: ["text", "image"],
      },
    ],
    extra: Schema.object({
      projectId: Schema.string().default("unknown"),
      sessionId: Schema.string().default("unknown"),
    }),
  });
}
```

### shared-model/src/index.ts update

```typescript
// Add new exports alongside existing ones
export * from "./types/model";
export * from "./types/errors";
export * from "./utils/model-id";
export * from "./providers/abstract-provider";
export * from "./providers/schema-factory";
```

### ModelService.registerProvider — existing dispose cleanup (no changes needed)

```typescript
// Source: core/src/services/model/service.ts (existing, verified)
public registerProvider(name: string, provider: IModelProvider): void {
  this.providers.set(name, provider);
  this.logger.info(`Provider registered: ${name}`);
  const caller = this[Context.current];
  caller.on("dispose", () => {
    this.unregisterProvider(name);
  });
  this.refreshSchemas();
}
```

## State of the Art

| Old Approach                                        | Current Approach                                      | When Changed                         | Impact                                                             |
| --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `export const reusable = true` + `apply()` function | `export default class` with `static reusable = true`  | Koishi 4.x class-form plugin support | Cleaner encapsulation; constructor IS the plugin entry             |
| Custom `ModelDefaultParams` interface               | `CallSettings` from `ai` package                      | ai-sdk v6 stabilized CallSettings    | Eliminates field name drift; SDK handles provider-specific aliases |
| Per-provider duplicated Schema                      | `createProviderSchema()` factory + `Schema.intersect` | This phase                           | Single source of truth for common fields                           |

**Deprecated/outdated:**

- `ModelDefaultParams` interface: replaced by `CallSettings` from `ai`. The field `maxTokens` in current provider configs is wrong — the correct SDK field is `maxOutputTokens`.
- `apply()` wrapper function in providers: replaced by class constructor. The current providers use `apply()` + internal class — after migration, the class IS the plugin.

## Open Questions

1. **`TClient` generic constraint: `.chat()` method typing**
   - What we know: All three SDK factories (`createOpenAI`, `createDeepSeek`, `createAnthropic`) return objects with a `.chat(modelId)` method returning `LanguageModel`
   - What's unclear: Whether TypeScript can infer the constraint `{ chat(modelId: string): LanguageModel }` cleanly for all three, or if `ReturnType<typeof createAnthropic>` has a different `.chat()` signature
   - Recommendation: Define a minimal `HasChatMethod` interface as the constraint; fall back to `(this.client as any).chat(modelId)` in `getModel()` if inference fails

2. **advancedOverride merge semantics**
   - What we know: The decision is textarea JSON, parse-error-as-warning, graceful degradation
   - What's unclear: Whether the override merges into `defaultParams` only, or also into per-call params, or is passed as `providerOptions`
   - Recommendation: Merge into `defaultParams` at construction time (shallow merge); document that per-call params from the caller always win via `{ ...defaults, ...params }` in ModelService

3. **`declare module "koishi"` placement**
   - What we know: Each provider currently redeclares `Context["yesimbot.model"]`; AbstractProvider in shared-model would need to do the same
   - What's unclear: Whether the declaration in shared-model is sufficient or if providers still need their own
   - Recommendation: Put the declaration in `abstract-provider.ts` in shared-model; providers import from shared-model so the declaration is transitively available. Remove duplicate declarations from provider files.

## Sources

### Primary (HIGH confidence)

- `/home/workspace/Athena/providers/provider-openai/src/index.ts` — current OpenAI provider (113 lines, full boilerplate)
- `/home/workspace/Athena/providers/provider-deepseek/src/index.ts` — current DeepSeek provider (113 lines, identical structure)
- `/home/workspace/Athena/providers/provider-anthropic/src/index.ts` — current Anthropic provider (184 lines, custom fetch)
- `/home/workspace/Athena/packages/shared-model/src/types/model.ts` — IModelProvider, ModelDefaultParams, ModelInfo
- `/home/workspace/Athena/core/src/services/model/service.ts` — ModelService.registerProvider() dispose cleanup pattern
- `/home/workspace/Athena/references/koishi-docs/en-US/guide/plugin/index.md` — class-form plugin, default export, namespace Config
- `/home/workspace/Athena/references/koishi-docs/en-US/guide/plugin/lifecycle.md` — `static reusable = true` for class-form plugins
- `/home/workspace/Athena/references/koishi-docs/en-US/guide/plugin/schema.md` — Schema.intersect, Schema.object, role('textarea')
- `/home/workspace/Athena/node_modules/ai/dist/index.d.ts` lines 595-640 — `CallSettings` type definition (maxOutputTokens, temperature, topP, topK, presencePenalty, frequencyPenalty, stopSequences, seed)

### Secondary (MEDIUM confidence)

- `.planning/phases/30-provider-architecture/30-CONTEXT.md` — locked decisions from discuss-phase session

### Tertiary (LOW confidence)

- None

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries already in use, versions confirmed from package.json
- Architecture: HIGH — patterns verified from existing codebase + Koishi official docs
- Pitfalls: HIGH — identified from direct code inspection of current providers and ModelService

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable framework, no fast-moving dependencies)
