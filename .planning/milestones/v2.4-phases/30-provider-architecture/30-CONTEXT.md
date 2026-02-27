# Phase 30: Provider Architecture - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract AbstractProvider abstraction to unify provider plugins. All three provider plugins (OpenAI, DeepSeek, Anthropic) share a common abstract base class; duplicated registration, schema, and data access code is eliminated. Existing provider external behavior is unchanged from a functional perspective, but config structure may be redesigned (no published version yet).

</domain>

<decisions>
## Implementation Decisions

### Abstraction Boundary

- `AbstractProvider` is an abstract class in `shared-model`, NOT a Koishi Service (Service only allows single registration; providers use `reusable = true` for multiple instances)
- Provider plugins `export default class` extending AbstractProvider — the class itself IS a valid Koishi class-form plugin (`constructor(ctx, config)`)
- No `apply()` wrapper needed; Koishi loads class plugins directly
- AbstractProvider encapsulates: `listModels()`, `getDefaultParams()`, `getModel()`, and registration flow
- Subclasses implement only `createClient()` returning an SDK instance
- `getModel()` is in AbstractProvider (all providers use `client.chat(modelId)` identically)
- Constructor auto-registers with `ctx['yesimbot.model'].registerProvider(this)` — subclasses don't handle registration

### Schema Factory Design

- `createProviderSchema()` factory function generates the complete common Schema (id, apiKey, baseURL, models[], defaultParams)
- Parameterized: accepts `{ extra, defaults, defaultModels }` — subclass passes provider-specific fields, default values, and default model list
- Anthropic passes `extra: Schema.object({ projectId, sessionId })` to add its unique fields
- Default models are also parameterized (OpenAI: gpt-4o, DeepSeek: deepseek-chat/reasoner, Anthropic: claude series)
- Models stay as array form `[{id, name, ...}]` for Koishi Console table display compatibility

### Provider Specialization

- `createClient()` is the sole extension point — subclasses handle all SDK initialization inside it (including Anthropic's custom fetch interceptor for user_id injection)
- No additional lifecycle hooks (beforeRequest/afterResponse etc.) — not needed
- Provider-specific helper methods (Anthropic's `buildUserId`, `isJsonContentType`, `parseBody`) stay inside the subclass, not promoted to AbstractProvider

### Config Structure Redesign

- No backward compatibility needed (no published version yet) — free to redesign completely
- Delete `ModelDefaultParams` interface from shared-model; use ai-sdk's `CallSettings` directly (SDK handles aliases internally)
- Global `defaultParams` at provider level (not per-model) to keep models array concise
- Advanced override: textarea field (`Schema.string().role('textarea', { rows: [2, 4] })`) for user-written JSON covering headers, options, per-model parameter overrides etc.
- JSON parse failure: log warning, don't throw, don't apply the override — graceful degradation

### Migration Strategy

- One-shot migration: all three providers converted to AbstractProvider simultaneously in one pass
- Each provider should shrink from ~113 lines to ~30-40 lines

### Claude's Discretion

- Exact `createProviderSchema()` parameter interface shape
- How advanced JSON override merges with base config
- Internal organization of AbstractProvider methods
- Whether to split AbstractProvider and schema factory into separate files

</decisions>

<specifics>
## Specific Ideas

- Config design reference: opencode's provider config template — models with minimal required fields, advanced options as optional overrides (headers, limit, cost, options, modalities)
- Koishi class-form plugin pattern: see `references/koishi-docs/zh-CN/guide/plugin/index.md` — `export default class` with `constructor(ctx, config)` is a valid plugin
- Textarea JSON override pattern: `Schema.string().role('textarea', { rows: [2, 4] })` with parse-error-as-warning semantics

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 30-provider-architecture_
_Context gathered: 2026-02-26_
