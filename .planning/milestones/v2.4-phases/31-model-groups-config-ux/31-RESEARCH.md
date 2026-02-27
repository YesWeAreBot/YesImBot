# Phase 31: Model Groups + Config UX - Research

**Researched:** 2026-02-27 (updated with build verification)
**Domain:** Koishi Schema i18n, Schema.intersect grouping, locale file registration
**Confidence:** HIGH (verified via schema-test plugin build)

## Summary

This phase is purely a Config UX improvement: grouping the flat config into collapsible sections in Koishi Console, adding Chinese descriptions to all fields, and wiring up zh-CN / en-US locale files. No new runtime logic is introduced.

The Koishi/schemastery ecosystem has first-class support for all three requirements. `Schema.intersect` with `.description()` on each sub-schema produces labeled groups in the Console UI. The `Schema.prototype.i18n()` method accepts a `{ "zh-CN": {...}, "en-US": {...} }` dict and merges descriptions into the schema metadata.

**Critical corrections from build testing:**

1. **`.collapse()` works on the intersect level, NOT on individual Schema.object inside intersect.** Each `Schema.object().description("分组名")` inside an intersect creates a labeled section, but `.collapse()` can only be set on the intersect itself to collapse the entire block. Individual objects within an intersect cannot be independently collapsed.
2. **pkgroll cannot inline YAML imports.** `import ... from "*.yml"` causes build failure: `Error: Expected ';', '}' or <eof>`. Use **JSON** locale files instead — pkgroll handles JSON natively via `@rollup/plugin-json`.
3. **`resolveJsonModule: true`** must be added to `tsconfig.base.json`, and each plugin's `tsconfig.json` `include` must cover `src/**/*.json`.

**Primary recommendation:** Use `Schema.object({...}).description("分组名")` inside `Schema.intersect([...])` for labeled groups. Use **JSON** (not YAML) locale files imported via `import zhCN from "./locales/zh-CN.json"`. Call `.i18n({ "zh-CN": zhCN._config, "en-US": enUS._config })` on the final schema.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- 五组划分：基础、模型、意愿值、提示词、高级（可根据实际配置项数量和逻辑关系微调）
- 使用 `Schema.intersect` 各子 schema 的 `.description()` 实现 UI 分组，保持平铺结构不引入嵌套 object
- `.collapse()` 只能设置在 intersect 级别，不能独立折叠内部各 object
- 每个分组仅显示纯中文标题，不加额外描述文字
- 组内字段按使用频率排列，常改的靠前，高级/少用的靠后
- 描述通过 i18n key 引用，不硬编码中文字符串
- 覆盖范围：core 插件 + 所有 provider 插件，全部做 i18n
- 每个插件独立维护 `locales/` 目录，包含 `zh-CN.json` 和 `en-US.json`（JSON 格式，非 YAML）
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

| Library     | Version               | Purpose                  | Why Standard                                                                      |
| ----------- | --------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| schemastery | (bundled with koishi) | Schema definition + i18n | Koishi's built-in schema system; `.i18n()` and `.collapse()` are first-party APIs |

### Supporting

| Library                    | Version | Purpose                     | When to Use                                                                                  |
| -------------------------- | ------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| koishi `ctx.i18n.define()` | 4.x     | Runtime locale registration | Alternative to Schema.i18n() for command/message strings; not needed for config descriptions |

### Alternatives Considered

| Instead of                               | Could Use                        | Tradeoff                                                                                                                          |
| ---------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Schema.i18n({ "zh-CN": json._config })` | `ctx.i18n.define("zh-CN", dict)` | `ctx.i18n.define` is for command/message strings; Schema.i18n() is the correct API for config field descriptions shown in Console |
| JSON locale files                        | YAML locale files                | YAML is more readable but pkgroll cannot inline YAML imports — JSON works natively with pkgroll                                   |
| JSON locale files                        | Inline TS objects                | JSON files are easier to maintain and review; inline objects clutter source code                                                  |

**Installation:** No new packages needed. `resolveJsonModule: true` must be added to `tsconfig.base.json` (already done during research verification).

## Architecture Patterns

### Recommended Project Structure

```
core/src/
├── services/agent/
│   ├── service.ts          # AgentCoreConfigSchema — wrap in intersect groups
│   └── willingness.ts      # WillingnessSchema — already uses intersect
├── locales/
│   ├── zh-CN.json          # core plugin locale (JSON, not YAML)
│   └── en-US.json
providers/provider-openai/src/
├── index.ts                # createProviderSchema result — add .i18n()
└── locales/
    ├── zh-CN.json
    └── en-US.json
providers/provider-deepseek/src/
└── locales/
    ├── zh-CN.json
    └── en-US.json
providers/provider-anthropic/src/
└── locales/
    ├── zh-CN.json
    └── en-US.json
```

### Pattern 1: Schema.intersect Grouping with .description()

**What:** Wrap each logical group of fields in a `Schema.object({...}).description("分组名")` and combine them in `Schema.intersect([...])`. The `.description()` on each object schema becomes the group header label in Koishi Console.

**Collapse behavior (verified via Koishi Console):**

- `.collapse()` on intersect → collapses the entire block into a single row
- Each `Schema.object().description("分组名")` inside intersect → renders as a **large text section header** (visual separator), fields listed below
- Individual objects inside intersect **cannot be independently collapsed**
- Nested intersect approach tested and **does not work** (duplicate headers, collapse ignored)
- **Final approach: no outer collapse, use section headers only.** This is clean and sufficient for config organization.
- i18n via `.i18n()` on the top-level intersect **works correctly** — field descriptions display in the correct locale (verified)

**When to use:** Any time you want labeled sections in Koishi Console without introducing nested config objects (which would break existing config compatibility).

**Example:**

```typescript
// Verified via schema-test plugin build
export const AgentCoreConfigSchema: Schema<AgentCoreConfig> = Schema.intersect([
  // Group 1: 基础
  Schema.object({
    model: Schema.dynamic("registry.chatModels"),
    fallbackChain: Schema.array(Schema.dynamic("registry.chatModels")).default([]),
    errorReportChannel: Schema.string(),
  }).description("基础"),

  // Group 2: 模型
  Schema.object({
    maxRounds: Schema.number().default(3),
    streamMode: Schema.boolean().default(false),
    globalTimeout: Schema.number().default(120000),
    maxToolResultLength: Schema.number().default(4000),
  }).description("模型"),

  // Group 3: 意愿值
  Schema.object({
    willingness: WillingnessSchema,
    aggregationWindow: Schema.number().default(1500),
  }).description("意愿值"),

  // Group 4: 高级
  Schema.object({
    charBudget: Schema.number().default(30000),
    keepLastRounds: Schema.number().default(2),
    enableThoughts: Schema.boolean().default(true),
  }).description("高级"),
]).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});
```

### Pattern 2: Locale JSON Structure

**What:** Each plugin has `locales/zh-CN.json` and `locales/en-US.json`. The JSON uses a `_config` top-level key (matching the reference implementation pattern). Field keys match the Schema field names. Nested objects use JSON nesting.

**Why JSON not YAML:** pkgroll cannot inline YAML imports (build error). JSON is natively supported via `@rollup/plugin-json` bundled with pkgroll. Verified via schema-test plugin build.

**Example `locales/zh-CN.json`:**

```json
{
  "_config": {
    "model": "主要对话模型",
    "fallbackChain": "备用模型链",
    "errorReportChannel": "错误上报频道（platform:channelId 格式）",
    "maxRounds": "最大工具调用轮数",
    "streamMode": "启用流式输出",
    "globalTimeout": "全局超时时间（毫秒）",
    "maxToolResultLength": "工具返回结果最大字符数",
    "willingness": {
      "$desc": "意愿值系统",
      "maxWillingness": "意愿值上限",
      "mentionBoost": "@提及时的概率加成（0-1）",
      "decay": {
        "$desc": "衰减设置",
        "halfLife": "意愿值半衰期（秒）",
        "elasticThreshold": "弹性衰减阈值（占上限比例）"
      }
    }
  }
}
```

**Example `locales/en-US.json`:**

```json
{
  "_config": {
    "model": "Primary chat model",
    "fallbackChain": "Fallback model chain",
    "errorReportChannel": "Error report channel (platform:channelId)",
    "maxRounds": "Max tool call rounds",
    "streamMode": "Enable streaming output",
    "globalTimeout": "Global timeout (ms)",
    "maxToolResultLength": "Max tool result length (chars)"
  }
}
```

### Pattern 3: Provider Schema i18n

**What:** `createProviderSchema` in `shared-model` returns a schema. Each provider calls `.i18n()` on the result.

**Example:**

```typescript
// providers/provider-openai/src/index.ts
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

namespace OpenAIProvider {
  export type Config = BaseProviderConfig;
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

### Pattern 4: i18n Key Naming Convention

Use `_config.<fieldName>` as the key path. For nested objects, use JSON nesting. The `$desc` key sets the description for the object itself (the group header shown in Console).

```json
{
  "_config": {
    "apiKey": "API 密钥",
    "baseURL": "API 基础地址",
    "models": { "$desc": "模型列表" },
    "defaultParams": {
      "$desc": "默认参数",
      "temperature": "温度（0-2，越高越随机）",
      "maxOutputTokens": "最大输出 token 数",
      "topP": "Top-P 采样参数"
    },
    "advancedOverride": "JSON 格式的高级覆盖参数（解析失败时忽略）"
  }
}
```

### Anti-Patterns to Avoid

- **Hardcoding Chinese strings in `.description()`:** Breaks i18n. Always use i18n key strings like `"_config.fieldName"` as the description value, then let `.i18n()` resolve them.
- **Introducing nested Schema.object for grouping:** This changes the config shape and breaks existing user configs. Use `Schema.intersect` with flat objects — each object in the intersect contributes its fields to the same flat config level.
- **Using `.collapse()` on individual objects inside intersect:** Does not work. `.collapse()` only collapses the entire intersect block.
- **Using nested intersect for independent collapse:** Tested and broken — duplicate headers, collapse ignored. Don't use this pattern.
- **Adding outer `.collapse().description()` on the top-level intersect:** Hides all config behind a click. Use section headers without outer collapse instead.
- **Putting `.i18n()` on individual field schemas:** Call `.i18n()` once on the top-level intersect schema. The schemastery `.i18n()` implementation recursively propagates locale data to nested schemas.
- **Using YAML locale files:** pkgroll cannot inline YAML imports. Use JSON files instead.
- **Duplicate field names across intersect objects:** `Schema.intersect` 将子 object 字段提升到顶层。同名字段若类型相同，前端会分别展示但修改同步应用到两处；若类型不同则编译报错。分组时必须确保各 object 内字段名唯一。

## Don't Hand-Roll

| Problem                   | Don't Build                  | Use Instead                                           | Why                                                         |
| ------------------------- | ---------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| Config field descriptions | Custom description injection | `Schema.prototype.i18n()`                             | schemastery handles recursive propagation to nested schemas |
| Locale file format        | YAML locale files            | JSON locale files (`*.json`)                          | pkgroll cannot inline YAML; JSON works natively             |
| Labeled groups            | Custom UI components         | `Schema.object({}).description("title")` in intersect | Koishi Console renders this natively                        |
| Locale fallback           | Custom fallback logic        | `ctx.i18n` (Koishi built-in)                          | Koishi handles zh-CN → en-US fallback automatically         |

**Key insight:** The entire Config UX improvement is achievable purely through schemastery API calls — no custom UI code, no new runtime services, no new dependencies.

## Common Pitfalls

### Pitfall 1: Schema.intersect breaks TypeScript type inference

**What goes wrong:** When you split a `Schema.object({...})` into multiple objects inside `Schema.intersect([...])`, TypeScript may fail to infer the combined type correctly, especially with optional fields.
**Why it happens:** `Schema.intersect` uses `IntersectS<X>` and `IntersectT<X>` type helpers that intersect the types. Optional fields in separate objects can cause `undefined` to appear in unexpected places.
**How to avoid:** Keep the `Config` interface as a single flat interface (intersection of all field types). The existing pattern in `core/src/index.ts` already does this correctly — `Config = AgentCoreConfig & HorizonServiceConfig & ...`. Within each service, the intersect groups should all contribute to the same flat `Config` interface.
**Warning signs:** TypeScript errors about `undefined` not assignable, or config fields not being recognized.

### Pitfall 2: pkgroll cannot inline YAML imports (VERIFIED)

**What goes wrong:** `import zhCN from "./locales/zh-CN.yml"` causes pkgroll build failure: `Error: Expected ';', '}' or <eof>`.
**Why it happens:** pkgroll uses esbuild for transpilation, which has no built-in YAML loader. `yml-register` only provides TypeScript type declarations, not a build-time transform.
**How to avoid:** Use JSON locale files instead. pkgroll handles JSON natively via `@rollup/plugin-json`. Verified: `import zhCN from "./locales/zh-CN.json"` builds successfully and JSON content is inlined into the bundle.
**Warning signs:** Build error pointing to `.yml` file with parse error.

### Pitfall 3: `.i18n()` key path mismatch

**What goes wrong:** JSON keys don't match the Schema field names, so descriptions don't appear in Console.
**Why it happens:** The schemastery `.i18n()` implementation traverses the schema structure and maps keys to field names. If a JSON key is `apikey` but the field is `apiKey`, the description is silently dropped.
**How to avoid:** JSON keys must exactly match TypeScript field names (camelCase). Use `$desc` for the object-level description.
**Warning signs:** Fields show no description in Koishi Console despite JSON locale being present.

### Pitfall 4: WillingnessSchema already uses intersect — don't double-wrap

**What goes wrong:** `WillingnessSchema` is already a `Schema.intersect([...])`. If you wrap it again in another intersect group, the Console UI may render it oddly.
**Why it happens:** Nested intersects are valid but the Console renders each intersect level as a group boundary.
**How to avoid:** Keep `WillingnessSchema` as-is. In the parent `AgentCoreConfigSchema`, reference it as a field value: `willingness: WillingnessSchema`. The willingness group will render its own sub-groups inside the parent 意愿值 group.
**Warning signs:** Duplicate group headers or unexpected nesting in Console UI.

### Pitfall 5: `files` array in package.json doesn't include locales

**What goes wrong:** Locale files are not included in the published package.
**Why it happens:** `package.json` `files` only lists `dist`.
**How to avoid:** Since pkgroll inlines JSON imports (verified — JSON content appears as JS objects in the built output), the locale content is embedded in the JS bundle. No need to add `locales/` to `files`.
**Warning signs:** Locale descriptions missing at runtime despite correct build-time setup.

### Pitfall 6: tsconfig must include JSON files

**What goes wrong:** `error TS6307: File '...json' is not listed within the file list of project`.
**Why it happens:** `resolveJsonModule: true` is needed in `tsconfig.base.json`, and each plugin's `tsconfig.json` `include` must cover JSON files (e.g., `"include": ["src", "src/**/*.json"]`).
**How to avoid:** Ensure both settings are in place before adding JSON locale imports.
**Warning signs:** TypeScript compilation error about JSON files not in project file list.

## Code Examples

Verified patterns from official sources:

### Schema.intersect with description (verified via schema-test build)

```typescript
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

const MySchema = Schema.intersect([
  Schema.object({
    fieldA: Schema.string(),
    fieldB: Schema.number().default(42),
  }).description("基础"), // labeled section header

  Schema.object({
    fieldC: Schema.boolean().default(false),
  }).description("高级"), // another labeled section
]).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});
```

### Schema.i18n() with JSON import (verified via schema-test build)

```typescript
// Verified: pkgroll inlines JSON content into the JS bundle
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

export const Config = Schema.object({
  apiKey: Schema.string().role("secret").required(),
  baseURL: Schema.string().default("https://api.openai.com/v1"),
}).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});
```

### JSON locale file structure

```json
{
  "_config": {
    "baseURL": "OpenAI API 基础地址",
    "apiKey": "OpenAI API 密钥",
    "modelConfig": {
      "$desc": "模型配置",
      "temperature": null,
      "topP": null
    }
  }
}
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

### createProviderSchema with i18n (pattern for all providers)

```typescript
// Each provider adds .i18n() to the schema returned by createProviderSchema
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

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

| Old Approach                           | Current Approach                                | When Changed             | Impact                                                        |
| -------------------------------------- | ----------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| Hardcoded `.description("中文描述")`   | `.description("_config.key")` + `.i18n({...})`  | Koishi 4.x               | Descriptions are locale-aware; Console shows correct language |
| Flat `Schema.object({...})`            | `Schema.intersect([group1, group2, ...])`       | Koishi 4.x               | Console renders labeled sections                              |
| YAML locale files (`*.yml`)            | JSON locale files (`*.json`)                    | Project build constraint | pkgroll cannot inline YAML; JSON works natively               |
| `require("./locales/zh-CN.yml")` (CJS) | `import zhCN from "./locales/zh-CN.json"` (ESM) | Project migrated to ESM  | Compatible with pkgroll dual CJS/ESM output                   |

**Deprecated/outdated:**

- YAML locale files: pkgroll cannot inline them. Use JSON instead.
- `require()` for locale files: The reference v3 code used `require()` because it was CJS. Current project is ESM-first — use `import` syntax.
- Hardcoded Chinese in `.description()`: Works but bypasses i18n system. Replace with key references.
- `.collapse()` on individual objects inside intersect: Does not work as expected. Only works on the intersect itself.

## Open Questions

1. **独立折叠各分组 — Koishi Console 不支持，已放弃**
   - 已测试：嵌套 intersect 方案导致标题重复、collapse 失效
   - 已测试：intersect 内部 object 的 `.collapse()` 无效
   - 最终方案：使用 `Schema.intersect` + `.description()` 标题分隔，不折叠。配置项通过分组标题清晰分隔，足够实用

2. **Should `createProviderSchema` in shared-model accept locale options?**
   - What we know: Currently `createProviderSchema` returns a schema without i18n. Each provider would need to call `.i18n()` separately.
   - Recommendation: Keep i18n at the provider level (each provider calls `.i18n()` on the result). This keeps `shared-model` locale-agnostic and lets each provider have its own translations.

3. **`resolveJsonModule` in tsconfig.base.json**
   - What we know: Adding `resolveJsonModule: true` to tsconfig.base.json is needed for JSON imports. This was tested and works. However, the setting was reverted — needs to be re-applied during implementation.
   - Each plugin's tsconfig.json `include` must also cover `src/**/*.json`.

## Sources

### Primary (HIGH confidence)

- `node_modules/schemastery/lib/index.d.ts` — Schema API: `.i18n()`, `.collapse()`, `.description()`, `Schema.intersect()`
- `node_modules/schemastery/lib/index.mjs` — `.i18n()` implementation: recursive propagation, `$desc`/`$description` key handling
- `plugins/schema-test/` — Build verification: JSON imports work with pkgroll, YAML imports fail
- `plugins/schema-test/dist/index.mjs` — Verified JSON content inlined as JS objects in bundle

### Secondary (MEDIUM confidence)

- `references/YesImBot-dev/plugins/provider-openai/src/index.ts` — `.i18n()` pattern (CJS version with YAML, adapt to ESM + JSON)
- `references/YesImBot-dev/plugins/provider-openai/src/locales/zh-CN.yml` — `_config` structure with `$desc` keys (use same structure in JSON)
- `core/src/services/agent/willingness.ts` — Existing `Schema.intersect` usage in this project

### Tertiary (LOW confidence)

- `.collapse()` behavior on intersect in Koishi Console UI — needs visual verification in running instance

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — schemastery API verified from source; JSON import verified via schema-test build
- Architecture: HIGH — `.i18n()` + `.description()` + `Schema.intersect` all confirmed; JSON inlining verified
- Pitfalls: HIGH — pkgroll YAML failure and JSON workaround both verified via actual build
- Collapse behavior: HIGH — verified via Koishi Console screenshot; intersect collapses entire block, inner objects render as section headers

**Research date:** 2026-02-27 (updated with build verification)
**Valid until:** 2026-03-27 (schemastery API is stable; Koishi 4.x i18n API is stable)
