# Phase 31: Model Groups + Config UX - Research

**Researched:** 2026-02-27
**Domain:** Koishi Schema i18n, Schema.intersect grouping, locale file registration
**Confidence:** HIGH

## Summary

This phase is purely a Config UX improvement: grouping the flat config into collapsible sections in Koishi Console, adding Chinese descriptions to all fields, and wiring up zh-CN / en-US locale files. No new runtime logic is introduced.

The Koishi/schemastery ecosystem has first-class support for all three requirements. `Schema.intersect` with `.description()` on each sub-schema produces collapsible groups in the Console UI. The `Schema.prototype.i18n()` method accepts a `{ "zh-CN": {...}, "en-US": {...} }` dict and merges descriptions into the schema metadata — this is the canonical pattern used by Koishi core itself and the v3 reference implementation. Locale YAML files are imported via `yml-register` (already in the project's `tsconfig.base.json` types) and passed to `.i18n()`.

The project already uses `Schema.intersect` at the top level in `core/src/index.ts` and in `WillingnessSchema`. The pattern is proven and in use. The only new work is: (1) wrapping each service's flat `Schema.object` in a named intersect group, (2) creating `locales/zh-CN.yml` + `locales/en-US.yml` per plugin, and (3) calling `.i18n()` on each schema.

**Primary recommendation:** Use `Schema.object({...}).description("分组名").collapse()` wrapped in `Schema.intersect([...])` for each group. Call `.i18n({ "zh-CN": require("./locales/zh-CN.yml")._config, "en-US": require("./locales/en-US.yml")._config })` on the final intersect schema.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- 五组划分：基础、模型、意愿值、提示词、高级（可根据实际配置项数量和逻辑关系微调）
- 使用 `Schema.intersect` 各子 schema 的 `.description()` 实现 UI 折叠分组，保持平铺结构不引入嵌套 object
- 首组（基础）默认展开，其余分组默认折叠
- 每个分组仅显示纯中文标题，不加额外描述文字
- 组内字段按使用频率排列，常改的靠前，高级/少用的靠后
- 描述通过 i18n key 引用，不硬编码中文字符串
- 覆盖范围：core 插件 + 所有 provider 插件，全部做 i18n
- 每个插件独立维护 `locales/` 目录，包含 `zh-CN.yml` 和 `en-US.yml`
- 通过 `ctx.i18n.define()` 或 Koishi locales 文件机制注册翻译

### Claude's Discretion

- 具体的 i18n key 命名规范
- 分组内字段的精确排序
- 五组划分的微调（如某组配置项过多时是否拆分）

### Deferred Ideas (OUT OF SCOPE)

- 模型组与负载均衡（REQ-04）— 原计划在本 phase，用户决定延期，继续使用 fallbackChain
- 故障恢复机制（冷却期、重试、全组不可用处理）— 随模型组一起延期
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                  | Research Support                                                                      |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| REQ-06 | 配置分组优化 — Schema.intersect + .description() 折叠分组    | Schema.intersect + .collapse() pattern confirmed in schemastery API                   |
| REQ-07 | Schema 描述增强 — 所有配置项添加中文描述，通过 i18n key 引用 | Schema.prototype.i18n() merges locale dict into meta.description                      |
| REQ-08 | i18n 国际化 — locales/zh-CN.yml + en-US.yml per plugin       | yml-register already in tsconfig types; .i18n() pattern confirmed from reference code |

</phase_requirements>

## Standard Stack

### Core

| Library      | Version               | Purpose                            | Why Standard                                                                      |
| ------------ | --------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| schemastery  | (bundled with koishi) | Schema definition + i18n           | Koishi's built-in schema system; `.i18n()` and `.collapse()` are first-party APIs |
| yml-register | 1.2.5                 | YAML import support for TypeScript | Already in `tsconfig.base.json` types; enables `import ... from '*.yml'`          |

### Supporting

| Library                    | Version | Purpose                     | When to Use                                                                                  |
| -------------------------- | ------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| koishi `ctx.i18n.define()` | 4.x     | Runtime locale registration | Alternative to Schema.i18n() for command/message strings; not needed for config descriptions |

### Alternatives Considered

| Instead of                              | Could Use                        | Tradeoff                                                                                                                          |
| --------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Schema.i18n({ "zh-CN": yml._config })` | `ctx.i18n.define("zh-CN", dict)` | `ctx.i18n.define` is for command/message strings; Schema.i18n() is the correct API for config field descriptions shown in Console |
| YAML locale files                       | Inline JS objects                | YAML is more maintainable for translators; already supported via yml-register                                                     |

**Installation:** No new packages needed. `yml-register` is already declared in `tsconfig.base.json` types.

## Architecture Patterns

### Recommended Project Structure

```
core/src/
├── services/agent/
│   ├── service.ts          # AgentCoreConfigSchema — wrap in intersect groups
│   └── willingness.ts      # WillingnessSchema — already uses intersect
├── locales/
│   ├── zh-CN.yml           # core plugin locale
│   └── en-US.yml
providers/provider-openai/src/
├── index.ts                # createProviderSchema result — add .i18n()
└── locales/
    ├── zh-CN.yml
    └── en-US.yml
providers/provider-deepseek/src/
└── locales/
    ├── zh-CN.yml
    └── en-US.yml
providers/provider-anthropic/src/
└── locales/
    ├── zh-CN.yml
    └── en-US.yml
```

### Pattern 1: Schema.intersect Grouping with .collapse()

**What:** Wrap each logical group of fields in a `Schema.object({...}).description("分组名").collapse()` and combine them in `Schema.intersect([...])`. The `.description()` on the object schema becomes the group header in Koishi Console. `.collapse()` makes the group collapsed by default.

**When to use:** Any time you want collapsible sections in Koishi Console without introducing nested config objects (which would break existing config compatibility).

**Example:**

```typescript
// Source: schemastery API (confirmed from lib/index.d.ts + Koishi core usage)
export const AgentCoreConfigSchema: Schema<AgentCoreConfig> = Schema.intersect([
  // Group 1: 基础 — expanded by default (no .collapse())
  Schema.object({
    model: Schema.dynamic("registry.chatModels").description("_config.model"),
    fallbackChain: Schema.array(Schema.dynamic("registry.chatModels"))
      .default([])
      .description("_config.fallbackChain"),
    errorReportChannel: Schema.string().description("_config.errorReportChannel"),
  }).description("基础"),

  // Group 2: 模型 — collapsed by default
  Schema.object({
    maxRounds: Schema.number().default(3).description("_config.maxRounds"),
    streamMode: Schema.boolean().default(false).description("_config.streamMode"),
    globalTimeout: Schema.number().default(120000).description("_config.globalTimeout"),
    maxToolResultLength: Schema.number().default(4000).description("_config.maxToolResultLength"),
  }).description("模型").collapse(),

  // Group 3: 意愿值 — collapsed
  Schema.object({
    willingness: WillingnessSchema,
    aggregationWindow: Schema.number().default(1500).description("_config.aggregationWindow"),
  }).description("意愿值").collapse(),

  // Group 4: 高级 — collapsed
  Schema.object({
    charBudget: Schema.number().default(30000).description("_config.charBudget"),
    keepLastRounds: Schema.number().default(2).description("_config.keepLastRounds"),
    softTrimHead: Schema.number().default(800).description("_config.softTrimHead"),
    softTrimTail: Schema.number().default(800).description("_config.softTrimTail"),
    initialContextCharBudget: Schema.number().default(20000).description("_config.initialContextCharBudget"),
    enableThoughts: Schema.boolean().default(true).description("_config.enableThoughts"),
    debugLevel: Schema.union([...]).default(2).description("_config.debugLevel"),
  }).description("高级").collapse(),
]).i18n({
  "zh-CN": require("./locales/zh-CN.yml")._config,
  "en-US": require("./locales/en-US.yml")._config,
});
```

### Pattern 2: Locale YAML Structure

**What:** Each plugin has `locales/zh-CN.yml` and `locales/en-US.yml`. The YAML uses a `_config` top-level key (matching the reference implementation pattern). Field keys match the Schema field names. Nested objects use YAML nesting.

**Example `locales/zh-CN.yml`:**

```yaml
_config:
  model: 主要对话模型
  fallbackChain: 备用模型链
  errorReportChannel: 错误上报频道（platform:channelId 格式）
  maxRounds: 最大工具调用轮数
  streamMode: 启用流式输出
  globalTimeout: 全局超时时间（毫秒）
  maxToolResultLength: 工具返回结果最大字符数
  willingness:
    $desc: 意愿值系统
    maxWillingness: 意愿值上限
    mentionBoost: @提及时的概率加成（0-1）
    decay:
      $desc: 衰减设置
      halfLife: 意愿值半衰期（秒）
      elasticThreshold: 弹性衰减阈值（占上限比例）
```

**Example `locales/en-US.yml`:**

```yaml
_config:
  model: Primary chat model
  fallbackChain: Fallback model chain
  errorReportChannel: Error report channel (platform:channelId)
  maxRounds: Max tool call rounds
  streamMode: Enable streaming output
  globalTimeout: Global timeout (ms)
  maxToolResultLength: Max tool result length (chars)
```

### Pattern 3: Provider Schema i18n

**What:** `createProviderSchema` in `shared-model` returns a schema. Each provider calls `.i18n()` on the result.

**Example:**

```typescript
// providers/provider-openai/src/index.ts
namespace OpenAIProvider {
  export type Config = BaseProviderConfig;
  export const Config = createProviderSchema({
    defaultId: "openai",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: [...],
  }).i18n({
    "zh-CN": require("./locales/zh-CN.yml")._config,
    "en-US": require("./locales/en-US.yml")._config,
  });
}
```

### Pattern 4: i18n Key Naming Convention

Use `_config.<fieldName>` as the key path. For nested objects, use YAML nesting. The `$desc` key sets the description for the object itself (the group header shown in Console).

```yaml
_config:
  apiKey: API 密钥
  baseURL: API 基础地址
  models:
    $desc: 模型列表
  defaultParams:
    $desc: 默认参数
    temperature: 温度（0-2，越高越随机）
    maxOutputTokens: 最大输出 token 数
    topP: Top-P 采样参数
  advancedOverride: JSON 格式的高级覆盖参数（解析失败时忽略）
```

### Anti-Patterns to Avoid

- **Hardcoding Chinese strings in `.description()`:** Breaks i18n. Always use i18n key strings like `"_config.fieldName"` as the description value, then let `.i18n()` resolve them.
- **Introducing nested Schema.object for grouping:** This changes the config shape and breaks existing user configs. Use `Schema.intersect` with flat objects — each object in the intersect contributes its fields to the same flat config level.
- **Calling `.collapse()` on the first group:** The first group should be expanded by default (no `.collapse()`). All subsequent groups get `.collapse()`.
- **Putting `.i18n()` on individual field schemas:** Call `.i18n()` once on the top-level intersect schema. The schemastery `.i18n()` implementation recursively propagates locale data to nested schemas.

## Don't Hand-Roll

| Problem                   | Don't Build                  | Use Instead                                         | Why                                                         |
| ------------------------- | ---------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Config field descriptions | Custom description injection | `Schema.prototype.i18n()`                           | schemastery handles recursive propagation to nested schemas |
| YAML parsing              | Custom YAML loader           | `yml-register` (already in tsconfig types)          | Zero-config YAML import support                             |
| Collapsible groups        | Custom UI components         | `Schema.object({}).description("title").collapse()` | Koishi Console renders this natively                        |
| Locale fallback           | Custom fallback logic        | `ctx.i18n` (Koishi built-in)                        | Koishi handles zh-CN → en-US fallback automatically         |

**Key insight:** The entire Config UX improvement is achievable purely through schemastery API calls — no custom UI code, no new runtime services, no new dependencies.

## Common Pitfalls

### Pitfall 1: Schema.intersect breaks TypeScript type inference

**What goes wrong:** When you split a `Schema.object({...})` into multiple objects inside `Schema.intersect([...])`, TypeScript may fail to infer the combined type correctly, especially with optional fields.
**Why it happens:** `Schema.intersect` uses `IntersectS<X>` and `IntersectT<X>` type helpers that intersect the types. Optional fields in separate objects can cause `undefined` to appear in unexpected places.
**How to avoid:** Keep the `Config` interface as a single flat interface (intersection of all field types). The existing pattern in `core/src/index.ts` already does this correctly — `Config = AgentCoreConfig & HorizonServiceConfig & ...`. Within each service, the intersect groups should all contribute to the same flat `Config` interface.
**Warning signs:** TypeScript errors about `undefined` not assignable, or config fields not being recognized.

### Pitfall 2: `.i18n()` key path mismatch

**What goes wrong:** YAML keys don't match the Schema field names, so descriptions don't appear in Console.
**Why it happens:** The schemastery `.i18n()` implementation traverses the schema structure and maps YAML keys to field names. If a YAML key is `apikey` but the field is `apiKey`, the description is silently dropped.
**How to avoid:** YAML keys must exactly match TypeScript field names (camelCase). Use `$desc` for the object-level description.
**Warning signs:** Fields show no description in Koishi Console despite YAML being present.

### Pitfall 3: require() of YAML in ESM context

**What goes wrong:** The project uses `"type": "module"` in package.json. `require("./locales/zh-CN.yml")` is CommonJS syntax and may fail in ESM.
**Why it happens:** pkgroll bundles to both CJS and ESM. The reference v3 code used `require()` because it was CJS-only. The current project targets both.
**How to avoid:** Use `import` syntax instead of `require()`:

```typescript
import zhCN from "./locales/zh-CN.yml";
import enUS from "./locales/en-US.yml";
// ...
.i18n({ "zh-CN": zhCN._config, "en-US": enUS._config })
```

`yml-register` types already declare `*.yml` as a module with a default export. pkgroll handles YAML imports via its rollup plugin chain.
**Warning signs:** Build errors about `require is not defined` or module resolution failures.

### Pitfall 4: WillingnessSchema already uses intersect — don't double-wrap

**What goes wrong:** `WillingnessSchema` is already a `Schema.intersect([...])`. If you wrap it again in another intersect group, the Console UI may render it oddly.
**Why it happens:** Nested intersects are valid but the Console renders each intersect level as a group boundary.
**How to avoid:** Keep `WillingnessSchema` as-is. In the parent `AgentCoreConfigSchema`, reference it as a field value: `willingness: WillingnessSchema`. The willingness group will render its own sub-groups inside the parent 意愿值 group.
**Warning signs:** Duplicate group headers or unexpected nesting in Console UI.

### Pitfall 5: `files` array in package.json doesn't include locales

**What goes wrong:** Locale YAML files are not included in the published package because `package.json` `files` only lists `dist`.
**Why it happens:** pkgroll bundles JS/TS but YAML files need to be either bundled (inlined) or copied separately.
**How to avoid:** Since pkgroll inlines YAML imports (via rollup's YAML plugin), the locale content is embedded in the JS bundle. No need to add `locales/` to `files`. Verify by checking the built output contains the locale strings.
**Warning signs:** Locale descriptions missing at runtime despite correct build-time setup.

## Code Examples

Verified patterns from official sources:

### Schema.intersect with collapse (from schemastery API)

```typescript
// Source: schemastery lib/index.d.ts — collapse() and description() are Schema instance methods
const MySchema = Schema.intersect([
  Schema.object({
    fieldA: Schema.string(),
    fieldB: Schema.number().default(42),
  }).description("基础"), // first group: no .collapse() = expanded

  Schema.object({
    fieldC: Schema.boolean().default(false),
  })
    .description("高级")
    .collapse(), // subsequent groups: .collapse() = collapsed
]);
```

### Schema.i18n() with YAML import (from reference YesImBot-dev)

```typescript
// Source: references/YesImBot-dev/plugins/provider-openai/src/index.ts (lines 35-38)
// Adapted for ESM import syntax
import zhCN from "./locales/zh-CN.yml";
import enUS from "./locales/en-US.yml";

export const Config = Schema.object({
  apiKey: Schema.string().role("secret").required(),
  baseURL: Schema.string().default("https://api.openai.com/v1"),
}).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});
```

### YAML locale file structure (from reference YesImBot-dev)

```yaml
# Source: references/YesImBot-dev/plugins/provider-openai/src/locales/zh-CN.yml
_config:
  baseURL: OpenAI API 基础地址
  apiKey: OpenAI API 密钥
  modelConfig:
    $desc: 模型配置
    temperature:
    topP:
```

### ctx.i18n.define() API (from Koishi core type definitions)

```typescript
// Source: node_modules/@koishijs/core/lib/index.d.ts line 205
// Signature: define(locale: string, dict: I18n.Store): () => void
// Use for command/message strings, NOT for config descriptions
ctx.i18n.define("zh-CN", {
  "commands.mycommand.description": "我的指令",
});
```

### createProviderSchema with i18n (pattern for all three providers)

```typescript
// Each provider adds .i18n() to the schema returned by createProviderSchema
import zhCN from "./locales/zh-CN.yml";
import enUS from "./locales/en-US.yml";

namespace OpenAIProvider {
  export const Config = createProviderSchema({
    defaultId: "openai",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModels: [...],
  }).i18n({
    "zh-CN": zhCN._config,
    "en-US": enUS._config,
  });
}
```

## State of the Art

| Old Approach                           | Current Approach                               | When Changed            | Impact                                                        |
| -------------------------------------- | ---------------------------------------------- | ----------------------- | ------------------------------------------------------------- |
| Hardcoded `.description("中文描述")`   | `.description("_config.key")` + `.i18n({...})` | Koishi 4.x              | Descriptions are locale-aware; Console shows correct language |
| Flat `Schema.object({...})`            | `Schema.intersect([group1, group2, ...])`      | Koishi 4.x              | Console renders collapsible sections                          |
| `require("./locales/zh-CN.yml")` (CJS) | `import zhCN from "./locales/zh-CN.yml"` (ESM) | Project migrated to ESM | Compatible with pkgroll dual CJS/ESM output                   |

**Deprecated/outdated:**

- `require()` for YAML: The reference v3 code used `require()` because it was CJS. Current project is ESM-first — use `import` syntax.
- Hardcoded Chinese in `.description()`: Works but bypasses i18n system. Replace with key references.

## Open Questions

1. **Does pkgroll inline YAML imports or require separate file copying?**
   - What we know: `yml-register` is in tsconfig types, enabling `import ... from '*.yml'`. pkgroll uses rollup under the hood.
   - What's unclear: Whether pkgroll's rollup config includes a YAML plugin that inlines the content, or whether YAML files need to be in `files` array.
   - Recommendation: Test with a simple YAML import in one provider first. If the build output contains the locale strings inline, no further action needed. If not, add `@rollup/plugin-yaml` or copy locale files to dist.

2. **Should `createProviderSchema` in shared-model accept locale options?**
   - What we know: Currently `createProviderSchema` returns a schema without i18n. Each provider would need to call `.i18n()` separately.
   - What's unclear: Whether it's cleaner to pass locale dicts into `createProviderSchema` as options, or keep i18n at the provider level.
   - Recommendation: Keep i18n at the provider level (each provider calls `.i18n()` on the result). This keeps `shared-model` locale-agnostic and lets each provider have its own translations.

## Sources

### Primary (HIGH confidence)

- `node_modules/schemastery/lib/index.d.ts` — Schema API: `.i18n()`, `.collapse()`, `.description()`, `Schema.intersect()`
- `node_modules/schemastery/lib/index.mjs` — `.i18n()` implementation: recursive propagation, `$desc`/`$description` key handling
- `node_modules/@koishijs/core/lib/index.mjs` — `ctx.i18n.define()` implementation, locale loading pattern
- `node_modules/@koishijs/core/lib/index.d.ts` — `I18n.define()` type signature
- `node_modules/yml-register/types.d.ts` — `*.yml` module declaration

### Secondary (MEDIUM confidence)

- `references/YesImBot-dev/plugins/provider-openai/src/index.ts` — `.i18n({ "zh-CN": require(...), "en-US": require(...) })` pattern (CJS version, adapt to ESM)
- `references/YesImBot-dev/plugins/provider-openai/src/locales/zh-CN.yml` — `_config` YAML structure with `$desc` keys
- `core/src/services/agent/willingness.ts` — Existing `Schema.intersect` usage in this project

### Tertiary (LOW confidence)

- pkgroll YAML inlining behavior — not directly verified; needs build test

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — schemastery API verified from source; yml-register types confirmed in tsconfig
- Architecture: HIGH — `.i18n()` + `.collapse()` + `Schema.intersect` all confirmed from schemastery source
- Pitfalls: MEDIUM — ESM/CJS YAML import pitfall is inferred from project setup; pkgroll behavior not directly tested

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (schemastery API is stable; Koishi 4.x i18n API is stable)
