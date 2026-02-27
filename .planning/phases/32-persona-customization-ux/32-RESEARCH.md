# Phase 32: Persona Customization UX - Research

**Researched:** 2026-02-27
**Domain:** Koishi plugin development, SkillRegistry injection, Schema UX
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Plugin form:**

- Independent plugin (not built into core), user can enable/disable in Koishi Console independently
- When disabled, has zero effect on existing functionality — SOUL.md + RoleService continue working normally

**Injection mechanism:**

- Register as a skill in SkillRegistry, lifecycle = `per-turn`, no conditions (unconditional always-active)
- Inject into the `soul` injection point, distinct from SOUL.md's `__role_soul` content
- Use a semantic prefix to distinguish (e.g. "以下是补充人格特质：") so LLM understands this extends SOUL, not replaces it

**Priority relationship:**

- SOUL.md takes priority; persona skill is complementary and coexists
- When SOUL.md has content: SOUL.md first (core identity), persona skill content appended after
- When SOUL.md is empty/default: persona skill becomes the primary persona source
- When persona skill is not enabled: zero effect on existing behavior

**Config panel form:**

- Minimal fields + large textarea style
- 3-4 core fields: name, core personality (short text), tone/style (short text), free-form supplement (large textarea)
- Conversation examples go in the free-form textarea for now; dedicated skill for that is future work
- No injection content preview (Koishi config panel does not support this)

**Preset template system:**

- 2-3 curated built-in preset templates
- Config panel provides a dropdown selector; selecting a preset auto-fills all form fields
- User can freely modify any field after filling
- Switching presets directly overwrites all current fields (Koishi panel does not support pre-switch confirmation)

### Claude's Discretion

- Specific preset template content design (style direction and copy)
- Form field i18n description copy
- Injection text concatenation format and semantic prefix wording
- Plugin internal Schema structure design

### Deferred Ideas (OUT OF SCOPE)

- Layered injection (base persona + overlay) — per-group/scene stacking of different persona fragments, left for future enhancement
- Conversation examples dedicated skill — decide based on actual usage whether to develop structured few-shot examples skill
- Persona content preview — if Koishi adds support for custom panel components in the future
  </user_constraints>

## Summary

Phase 32 creates a standalone Koishi plugin (`koishi-plugin-yesimbot-persona`) that provides a form-based UI for persona customization. It sits between the raw SOUL.md file and the programmatic skill system — a middle layer that non-technical users can configure entirely through the Koishi Console config panel.

The plugin registers itself as a `SkillDefinition` with `source: "plugin"` into the existing `SkillRegistry`. Because it has no `conditions` and no `activate` function, it will never be activated by the trait-skill pipeline. Instead, it must use `SkillRegistry.register()` directly and inject into the `soul` point via `PromptService.inject()` — bypassing the condition evaluation path entirely. This is the correct pattern for an unconditional always-on injection.

The preset system is implemented entirely within the Schema using `Schema.union` of `Schema.const` values for the dropdown, combined with a `Schema.transform` or a computed field approach. Since Koishi's Schema system does not support reactive field-filling from a dropdown, the preset selector must be a separate config field that the plugin reads at render time to merge with user overrides — or the preset values are used as defaults that the user then edits.

**Primary recommendation:** Implement as a `plugins/persona/` workspace package following the same structure as provider plugins. Register into `SkillRegistry` via `register()` in the plugin's `apply()` function, injecting directly into the `soul` point with `after: "__role_soul"` ordering.

## Standard Stack

### Core

| Library               | Version      | Purpose                              | Why Standard         |
| --------------------- | ------------ | ------------------------------------ | -------------------- |
| koishi                | ^4.18.3      | Plugin host, Schema, Service         | Project standard     |
| @yesimbot/core (peer) | workspace:\* | SkillRegistry + PromptService access | The injection target |

### Supporting

| Library | Version | Purpose                   | When to Use                         |
| ------- | ------- | ------------------------- | ----------------------------------- |
| pkgroll | ^2.21.4 | Build CJS+ESM dual output | All plugins in this monorepo use it |

### Alternatives Considered

| Instead of                       | Could Use                         | Tradeoff                                                                                                                 |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Direct PromptService.inject()    | SkillRegistry.register()          | Direct inject is simpler but bypasses the skill lifecycle; register() is the declared contract for plugin-sourced skills |
| Schema.transform for preset fill | Separate preset + override fields | Transform approach is cleaner but Koishi Schema transform is one-way at parse time; separate fields are more predictable |

**Installation:**

```bash
# No new dependencies needed — pure Koishi + koishi-plugin-yesimbot peer
```

## Architecture Patterns

### Recommended Project Structure

```
plugins/persona/
├── src/
│   ├── index.ts          # Plugin entry: apply(), Config schema, inject logic
│   └── presets.ts        # Preset template definitions
├── package.json          # koishi.service.required: [yesimbot.skill, yesimbot.prompt]
└── tsconfig.json
```

### Pattern 1: Unconditional Skill Registration

The `SkillRegistry.register()` method accepts any `SkillDefinition`. For an always-on persona injection, omit `conditions` and `activate` entirely. The `resolve()` loop in `SkillRegistry` only activates skills that have either `activate` or `conditions` — so a skill with neither will never fire through the normal pipeline.

**Correct approach:** Do NOT use `SkillRegistry.register()` for unconditional injection. Instead, call `PromptService.inject()` directly from the plugin's `apply()` function. This is exactly how `RoleService` injects `__role_soul`. The skill registry's `resolve()` method skips skills with no `activate` and no `conditions` (they evaluate to `false`).

```typescript
// Source: core/src/services/skill/service.ts lines 91-95
const activated = skill.activate
  ? skill.activate(filtered)
  : skill.conditions
    ? evaluateCondition(skill.conditions, filtered)
    : false; // <-- no conditions + no activate = never fires
```

**Therefore:** Use `PromptService.inject()` directly, not `SkillRegistry.register()`.

```typescript
// Source: core/src/services/role/service.ts pattern
export const inject = ["yesimbot.prompt"];

export function apply(ctx: Context, config: Config) {
  ctx["yesimbot.prompt"].inject(ctx, "soul", {
    name: "__persona_supplement",
    after: "__role_soul", // always after SOUL.md content
    renderFn: () => buildPersonaText(config),
  });
}
```

### Pattern 2: Preset + Override Schema Design

The preset dropdown sets a `preset` field. The plugin reads `preset` at render time and merges preset defaults with user-provided field overrides. Fields left empty by the user fall back to the preset value.

```typescript
// Discretion area: Claude designs this
const PRESETS = {
  none: { name: "", personality: "", tone: "", extra: "" },
  friendly: {
    name: "",
    personality: "活泼开朗，充满好奇心",
    tone: "轻松随意，喜欢用颜文字",
    extra: "",
  },
  professional: {
    name: "",
    personality: "沉稳理性，逻辑清晰",
    tone: "简洁专业，言简意赅",
    extra: "",
  },
};

function buildPersonaText(config: Config): string {
  const preset = PRESETS[config.preset ?? "none"];
  const name = config.name || preset.name;
  const personality = config.personality || preset.personality;
  const tone = config.tone || preset.tone;
  const extra = config.extra || preset.extra;

  const parts: string[] = ["以下是补充人格特质："];
  if (name) parts.push(`名字：${name}`);
  if (personality) parts.push(`核心性格：${personality}`);
  if (tone) parts.push(`语气风格：${tone}`);
  if (extra) parts.push(extra);

  return parts.length > 1 ? parts.join("\n") : "";
}
```

### Pattern 3: Plugin Package Structure

Following the provider plugin pattern exactly:

```typescript
// plugins/persona/src/index.ts
export const name = 'yesimbot-persona'
export const inject = ['yesimbot.prompt']

export interface Config { ... }
export const Config: Schema<Config> = Schema.intersect([...]).i18n({...})

export function apply(ctx: Context, config: Config) {
  const text = buildPersonaText(config)
  if (!text) return  // nothing to inject if all fields empty and no preset

  ctx['yesimbot.prompt'].inject(ctx, 'soul', {
    name: '__persona_supplement',
    after: '__role_soul',
    renderFn: () => buildPersonaText(config),
  })
}
```

### Pattern 4: Schema for Preset Dropdown

```typescript
// Koishi Schema.union for dropdown
Schema.union([
  Schema.const("none").description("无预设"),
  Schema.const("friendly").description("活泼友好"),
  Schema.const("professional").description("专业沉稳"),
]).default("none");
```

### Anti-Patterns to Avoid

- **Registering via SkillRegistry with no conditions:** Skills with no `activate` and no `conditions` evaluate to `false` in `resolve()` and never fire. Use `PromptService.inject()` directly.
- **Injecting before `__role_soul`:** The SOUL.md content must come first per the locked decision. Always use `after: '__role_soul'`.
- **Returning empty string from renderFn when all fields blank:** An empty injection still wraps in `<soul></soul>` tags. Guard with an early return in `apply()` — don't register the injection at all if config is fully empty.
- **Hardcoding descriptions in Schema:** Phase 31 established the pattern of using i18n locale files. Follow the same pattern with `locales/zh-CN.json` and `locales/en-US.json`.

## Don't Hand-Roll

| Problem                  | Don't Build             | Use Instead                                          | Why                                        |
| ------------------------ | ----------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Injection ordering       | Custom ordering logic   | `after: '__role_soul'` in InjectionEntry             | PromptService already has topological sort |
| Plugin lifecycle cleanup | Manual dispose tracking | `ctx.on('dispose', ...)` or pass `ctx` to `inject()` | inject() auto-registers dispose via ctx    |
| Schema i18n              | Hardcoded strings       | `.i18n({})` + locale JSON files                      | Established pattern from Phase 31          |

**Key insight:** The injection infrastructure is already complete. This phase is purely about building the config form and the text-assembly function.

## Common Pitfalls

### Pitfall 1: SkillRegistry vs PromptService for unconditional injection

**What goes wrong:** Developer registers the persona as a skill via `SkillRegistry.register()` with `lifecycle: 'per-turn'` and no conditions, expecting it to always fire. It never fires because `resolve()` returns `false` for skills with no activate/conditions.

**Why it happens:** The CONTEXT.md says "register as a skill in SkillRegistry, lifecycle per-turn, no conditions" — but the actual code path shows this won't work. The CONTEXT.md describes the _intent_ (always-on, per-turn), not the exact API call.

**How to avoid:** Use `PromptService.inject()` directly. This is the same mechanism RoleService uses for `__role_soul`. It's unconditional by nature.

**Warning signs:** Persona text never appears in the system prompt during testing.

### Pitfall 2: inject() called with empty content

**What goes wrong:** When all config fields are empty and no preset is selected, `buildPersonaText()` returns an empty string. The injection still runs and adds an empty fragment to the `soul` section.

**How to avoid:** In `apply()`, check if the built text is non-empty before calling `inject()`. Or in `renderFn`, return empty string — PromptService already filters empty fragments (`if (r.status === 'fulfilled' && r.value)`).

**Warning signs:** Extra blank lines in the system prompt soul section.

### Pitfall 3: Preset overwrite UX confusion

**What goes wrong:** User fills in custom fields, then accidentally selects a preset, losing their work. The CONTEXT.md acknowledges Koishi doesn't support pre-switch confirmation.

**How to avoid:** Document this clearly in field descriptions. The preset field description should warn "选择预设将覆盖所有字段". This is a known limitation, not a bug to fix.

### Pitfall 4: Package naming

**What goes wrong:** Package named `koishi-plugin-persona` conflicts with other Koishi ecosystem plugins.

**How to avoid:** Name it `koishi-plugin-yesimbot-persona` (following the `@yesimbot/koishi-plugin-provider-*` pattern but without the scoped namespace for simplicity, or use `@yesimbot/koishi-plugin-persona`).

## Code Examples

### Injection registration (verified pattern from RoleService)

```typescript
// Source: core/src/services/role/service.ts lines 136-141
this.disposers.push(
  this.prompt.inject(this.ctx, "soul", {
    name: "__role_soul",
    renderFn: (scope) => this.renderSafe("SOUL.md", soulContent, scope),
  }),
);
```

For persona plugin (after \_\_role_soul):

```typescript
// plugins/persona/src/index.ts
export function apply(ctx: Context, config: Config) {
  ctx["yesimbot.prompt"].inject(ctx, "soul", {
    name: "__persona_supplement",
    after: "__role_soul",
    renderFn: () => buildPersonaText(config),
  });
}
```

### Schema with i18n (verified pattern from Phase 31)

```typescript
// Source: core/src/index.ts lines 52, 104-107
Schema.object({
  preset: Schema.union([...]).default('none'),
  name: Schema.string().default(''),
  personality: Schema.string().default(''),
  tone: Schema.string().default(''),
  extra: Schema.string().role('textarea').default(''),
}).description({ 'zh-CN': '人设配置', 'en-US': 'Persona' } as never)
```

### package.json koishi service declaration (verified from provider-openai)

```json
{
  "koishi": {
    "service": {
      "required": ["yesimbot.prompt"]
    }
  }
}
```

## State of the Art

| Old Approach                                | Current Approach                                               | When Changed              | Impact                                |
| ------------------------------------------- | -------------------------------------------------------------- | ------------------------- | ------------------------------------- |
| Single SOUL.md file for all persona content | SOUL.md for core identity + skill/plugin layer for supplements | Phase 26 (memory cleanup) | Users need a non-file UI layer        |
| Hardcoded Schema descriptions               | i18n locale JSON files                                         | Phase 31                  | New plugins must follow i18n pattern  |
| Provider plugins as model                   | Independent Koishi plugins in `plugins/` workspace             | Established pattern       | New plugin goes in `plugins/persona/` |

## Open Questions

1. **Should `renderFn` receive `scope` and use Mustache templating?**
   - What we know: RoleService uses Mustache for `{{bot.name}}` etc. in SOUL.md
   - What's unclear: Whether persona fields should support template variables
   - Recommendation: No Mustache for now — keep it simple. Plain string concatenation. Users can reference bot name in SOUL.md. This is a UX simplification layer, not a power-user tool.

2. **Should the plugin be in `plugins/` or `packages/`?**
   - What we know: `plugins/` contains `schema-test/` (a test plugin). `providers/` contains provider plugins. `packages/` contains `shared-model`.
   - What's unclear: The intended distinction between `plugins/` and `providers/`
   - Recommendation: Use `plugins/persona/` — it's a user-facing feature plugin, not a model provider.

3. **Preset field: separate selector or inline with field defaults?**
   - What we know: Koishi Schema doesn't support reactive field-filling from a dropdown
   - What's unclear: Whether the preset selector should be a separate field that merges at render time, or whether presets are just documented examples users copy-paste
   - Recommendation: Separate `preset` field that merges at render time in `buildPersonaText()`. Fields left empty fall back to preset values. This gives the "auto-fill" UX described in CONTEXT.md without requiring Koishi panel reactivity.

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — skipping this section.

## Sources

### Primary (HIGH confidence)

- `/home/workspace/Athena/core/src/services/skill/service.ts` — SkillRegistry.resolve() logic, register() API, condition evaluation
- `/home/workspace/Athena/core/src/services/prompt/service.ts` — PromptService.inject() API, InjectionEntry ordering
- `/home/workspace/Athena/core/src/services/role/service.ts` — Canonical pattern for soul-point injection
- `/home/workspace/Athena/core/src/services/skill/types.ts` — SkillDefinition interface, source field
- `/home/workspace/Athena/core/src/index.ts` — Plugin wiring, Schema.intersect grouping, i18n pattern
- `/home/workspace/Athena/providers/provider-openai/src/index.ts` — Independent plugin structure pattern
- `/home/workspace/Athena/providers/provider-openai/package.json` — koishi.service declaration pattern

### Secondary (MEDIUM confidence)

- CONTEXT.md Phase 32 — User decisions (locked and discretion areas)
- STATE.md — Pending todo context: "探索更直观的人设自定义方式"

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries already in use in the project
- Architecture: HIGH — injection mechanism verified directly in source code; SkillRegistry bypass confirmed by reading resolve() logic
- Pitfalls: HIGH — SkillRegistry pitfall verified by reading the actual condition evaluation code

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable codebase, no external dependencies)
