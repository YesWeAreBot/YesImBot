# Phase 7: Core Wiring Fixes - Research

**Researched:** 2026-02-19
**Domain:** Mustache template bundling + PromptService runtime warnings
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- Default system template: 最小人格 + 功能性指令的 fallback 保底模板
- Language style: 混合——结构性 XML 标签用英文，指令内容用中文
- Structure: 精简版单体模板，三个核心模块：identity、style、how_you_work
- Content depth: 从 dev 版 identity.mustache 精简，去掉过于具体的行为条目（打错字、自嘲等）
- Mustache variables: 引用 view 数据（`{{view.self.name}}`、`{{view.environment.name}}` 等）
- Excludes: memory/tools/output 模块
- Override mechanism: 用户通过 config.templates.system 完全替换，已有机制无需改动
- AgentIdentity: config 字段保留但不注入 prompt scope，不做代码注入
- Empty template warning: PromptService.render() 返回空字符串时打 warn 级别日志，仅警告不 fallback

### Claude's Discretion

- 默认模板中 identity/style/how_you_work 各模块的具体措辞
- Mustache 条件渲染的具体写法（如 environment 缺失时的处理）
- warn 日志的具体消息文本

### Deferred Ideas (OUT OF SCOPE)

- AgentIdentity 代码注入机制
- 模板 partial 拆分（identity/environment/tools 分离）
- memory blocks 在 system prompt 中的渲染
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID        | Description                                                                                                                      | Research Support                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AGENT-01  | AgentCore 作为框架无关的编排器，接受 Percept 输入，通过 Horizon 获取 Observation，驱动 think-act 循环；预留 AgentIdentity 扩展点 | AgentIdentity field already exists in AgentCoreConfig; no code injection needed per decisions                                  |
| PROMPT-01 | 基础提示词配置 — 人设/性格配置，系统提示词模板加载与渲染                                                                         | Default template bundled via registerTemplate("system", ...) in PromptService constructor; empty-render warn added to render() |

</phase_requirements>

## Summary

Phase 7 has exactly two deliverables: (1) bundle a default "system" Mustache template into PromptService so the LLM never receives an empty system prompt when no user-provided template exists, and (2) add a `warn` log in `PromptService.render()` when the rendered result is an empty string.

The codebase is already well-structured for both changes. `PromptService` has a `registerTemplate(name, content)` method and the `render()` method already returns `""` when no template is found — the warning just needs to be added there. The default template is registered in the `PromptService` constructor via `this.registerTemplate("system", DEFAULT_SYSTEM_TEMPLATE)` before user config overrides take effect (config overrides happen at render time via `this.config.templates?.[templateName] ?? this.templates.get(templateName)`, so the built-in default is always the fallback).

The template content draws from the dev version's `identity.mustache` (trimmed) and v3's `control_flow` section. The view object passed to `render("system", { view })` in `ThinkActLoop` already contains `view.self.name`, `view.environment?.name`, and `view.environment?.type` — these are the only dynamic variables the minimal template needs.

**Primary recommendation:** Add `DEFAULT_SYSTEM_TEMPLATE` constant in `service.ts`, call `this.registerTemplate("system", DEFAULT_SYSTEM_TEMPLATE)` in the constructor, and add a `warn` after the empty-string check in `render()`.

## Architecture Patterns

### How the existing template resolution works

In `PromptService.render()` (line 44-46 of `service.ts`):

```typescript
const templateContent = this.config.templates?.[templateName] ?? this.templates.get(templateName);
if (!templateContent) return "";
```

- `config.templates` = user-provided overrides (from Koishi config)
- `this.templates` = built-in defaults registered via `registerTemplate()`
- Resolution order: user config wins, built-in is fallback

This means registering the default in the constructor is sufficient — no other wiring needed.

### Where to add the warning

The empty-string return at line 46 is the "template not found" case. But the warning should fire when `render()` returns `""` for any reason — including when the template exists but renders to empty. The correct place is after `this.renderer.render(...)` returns, not at the early-return.

However, looking at the code: the early return at line 46 (`if (!templateContent) return ""`) is also a case worth warning on. Both cases should warn.

### View data available in the template

From `HorizonView` (types.ts) and `buildView()` in `horizon/service.ts`:

```typescript
interface HorizonView {
  percept: Percept;
  self: SelfInfo; // { id: string; name: string }
  environment?: Environment; // { type, id, name, description?, metadata }
  entities?: Entity[];
  history?: Observation[];
}
```

ThinkActLoop passes `{ view }` as `initialScope`, so template variables are:

- `{{view.self.name}}` — bot's display name
- `{{view.environment.name}}` — channel name (optional, may be absent)
- `{{view.environment.type}}` — "channel" (optional)
- `{{#view.environment}}` / `{{/view.environment}}` — conditional block for environment presence

### Mustache conditional rendering for optional environment

```mustache
{{#view.environment}}
你正在「{{view.environment.name}}」中。
{{/view.environment}}
```

Mustache treats a missing/falsy value as false for section tags — this is the correct pattern for optional fields. Verified against Mustache.js behavior (mustache ^4.2.0 is in package.json).

### Anti-Patterns to Avoid

- **Registering the default template in `apply()` (index.ts):** The template must be registered before any render call. The constructor is the right place — it runs synchronously when the service is created.
- **Checking `templateContent` for empty-string warning:** The warning should fire when the _rendered output_ is empty, not just when the template is missing. Add the warn after `renderer.render()` returns, checking the result.
- **Using `view.bot.name` or `bot.platform`:** The dev version uses `{{bot.name}}` and `{{bot.platform}}` — these are NOT in the v4 view structure. v4 uses `{{view.self.name}}` and `{{view.environment.name}}`.

## Don't Hand-Roll

| Problem                                  | Don't Build             | Use Instead                                     | Why                                                    |
| ---------------------------------------- | ----------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| Mustache conditional for optional fields | Custom null-check logic | `{{#view.environment}}...{{/view.environment}}` | Mustache section tags handle falsy/missing natively    |
| Template file loading                    | fs.readFile at runtime  | Inline string constant in service.ts            | No file I/O needed; simpler, no path resolution issues |

## Common Pitfalls

### Pitfall 1: Wrong variable paths in template

**What goes wrong:** Using `{{bot.name}}` (dev version) or `{{self.name}}` instead of `{{view.self.name}}`.
**Why it happens:** Dev version uses a different scope structure (`bot.*`). v4 wraps everything under `view`.
**How to avoid:** Check `ThinkActLoop.run()` — it calls `prompt.render("system", { view })`. The top-level key is `view`.
**Warning signs:** Template renders but shows empty name fields.

### Pitfall 2: Warning fires on missing template, not empty render

**What goes wrong:** Adding warn only at the `if (!templateContent) return ""` early exit, missing the case where template exists but renders to `""`.
**Why it happens:** Two distinct empty-result paths exist.
**How to avoid:** Add warn at both exit points, or check the final rendered string before returning.

### Pitfall 3: Template registered after config override check

**What goes wrong:** Registering the default template in `apply()` after `PromptService` is already constructed.
**Why it happens:** `apply()` runs after constructor.
**How to avoid:** Register in the `PromptService` constructor body, before `super()` returns (or immediately after).

## Code Examples

### Pattern: Register default template in constructor

```typescript
// Source: plugins/core/src/services/prompt/service.ts (current pattern)
const DEFAULT_SYSTEM_TEMPLATE = `...`;

export class PromptService extends Service<PromptServiceConfig> {
  constructor(ctx: Context, config: PromptServiceConfig) {
    super(ctx, "yesimbot.prompt", true);
    this.config = config;
    this.registerTemplate("system", DEFAULT_SYSTEM_TEMPLATE);
  }
}
```

### Pattern: Empty-render warning in render()

```typescript
async render(templateName: string, initialScope?: Record<string, unknown>): Promise<string> {
  const templateContent =
    this.config.templates?.[templateName] ?? this.templates.get(templateName);
  if (!templateContent) {
    this.ctx.logger("yesimbot.prompt").warn(`No template registered for key: "${templateName}"`);
    return "";
  }
  // ... existing scope/injection logic ...
  const result = this.renderer.render(templateContent, scope, partials);
  if (!result) {
    this.ctx.logger("yesimbot.prompt").warn(`Template "${templateName}" rendered to empty string`);
  }
  return result;
}
```

Note: `PromptService` currently creates `this.renderer` as a field but has no stored logger. The logger should be created once — check CLAUDE.md: "MUST create logger once, then use it." Add `private logger = this.ctx.logger("yesimbot.prompt")` as a field, or use `ctx.logger` directly in the constructor.

### Pattern: Minimal default system template structure

```mustache
<identity>
你是 {{view.self.name}}，一个有血有肉的人，正在与朋友们聊天。
</identity>

<style>
...
</style>

<how_you_work>
...
</how_you_work>
```

## State of the Art

| Old Approach                                            | Current Approach                                          | Impact                                           |
| ------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Dev version uses `{{bot.name}}`, `{{bot.platform}}`     | v4 uses `{{view.self.name}}`, `{{view.environment.name}}` | Template variables must match v4 scope structure |
| Dev version uses partial composition (`{{> identity}}`) | v4 Phase 7 uses single monolithic template                | Simpler; partial splitting deferred              |

## Open Questions

1. **Logger field in PromptService**
   - What we know: No `private logger` field currently exists in `PromptService`; CLAUDE.md requires creating logger once
   - What's unclear: Whether to add `private logger` field or use `this.ctx.logger` inline
   - Recommendation: Add `private logger = this.ctx.logger("yesimbot.prompt")` as a class field alongside `private renderer`

## Sources

### Primary (HIGH confidence)

- Direct codebase read: `plugins/core/src/services/prompt/service.ts` — full PromptService implementation
- Direct codebase read: `plugins/core/src/services/agent/loop.ts` — how render("system", { view }) is called
- Direct codebase read: `plugins/core/src/services/horizon/types.ts` — HorizonView structure
- Direct codebase read: `plugins/core/src/services/horizon/service.ts` — buildView() output
- Direct codebase read: `YesImBot-dev/packages/core/resources/templates/partials/identity.mustache` — content reference
- Direct codebase read: `YesImBot-v3/packages/core/resources/prompts/memgpt_v2_chat.txt` — control_flow reference

### Secondary (MEDIUM confidence)

- mustache ^4.2.0 (package.json) — section tag behavior for falsy values is standard Mustache spec

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies; mustache already in use
- Architecture: HIGH — read actual source, both touch points are clear
- Pitfalls: HIGH — derived from direct code inspection, not speculation
- Template content: MEDIUM — wording is Claude's discretion; structure is HIGH confidence

**Research date:** 2026-02-19
**Valid until:** 2026-03-21 (stable internal codebase)
