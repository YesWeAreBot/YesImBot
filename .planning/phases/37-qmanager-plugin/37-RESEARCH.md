# Phase 37: QManager Plugin - Research

**Researched:** 2026-02-28
**Domain:** Koishi moderation tools — delete message, ban, kick via standard Bot API + OneBot API
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**工具行为设计:**

- 三个工具均为 Action 类型（有副作用，成功时默认不触发心跳，失败时请求心跳）
- `delmsg`: 接受 messageId 数组，支持批量撤回
- `ban`: duration 参数以秒为单位，0 = 解除禁言
- `kick`: 移除用户出群
- 工具层拦截：禁止操作 bot 自身、禁止操作管理员/群主（不调用平台 API，直接返回错误）

**权限激活机制:**

- 角色检测来源：读取 Phase 34 ENV-03 enriched entities 中的 bot 角色信息
- 角色判定标准：owner 或 admin 均视为"管理员角色"
- 激活粒度：全有全无——bot 有管理员角色时 Skill 激活，三个工具全部可见；无角色时全部隐藏
- 角色变更响应：实时——bot 被提升/降级管理员时，工具可见性立即更新

**LLM 调用引导:**

- 工具 description：中性描述，不含"谨慎使用"等警告语
- Skill description：包含典型使用场景示例（如违规发言、刷屏骚扰等）
- 执行方式：LLM 决定调用后直接执行，不需要向用户确认
- 描述语言：工具描述和 Skill 描述均使用中文

**错误处理与反馈:**

- 成功反馈：中文自然语言确认（如"已禁言用户 @Alice 10分钟"）
- 错误反馈：中文自然语言错误信息（如"禁言失败：目标用户是管理员"）
- 平台 API 错误：包装成友好中文信息后返回，不透传原始错误
- 重试策略：不自动重试，失败直接返回错误让 LLM 判断

### Claude's Discretion

- 具体的 Skill 场景示例措辞
- delmsg 批量操作的数组上限（如有必要）
- 工具参数的具体命名风格（与现有 Action 保持一致即可）

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                       | Research Support                                                                                                                    |
| ------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| QMGR-01 | `delmsg` 工具可撤回指定消息                                       | `session.bot.deleteMessage(channelId, messageId)` — verified in Koishi docs; short ID array → native IDs via `lookupNativeMsgId`    |
| QMGR-02 | `ban` 工具可禁言用户（支持时长参数，0=解除）                      | `session.bot.muteGuildMember(guildId, userId, durationMs)` — verified in Koishi docs; duration in seconds → ms conversion           |
| QMGR-03 | `kick` 工具可踢出用户                                             | `session.bot.kickGuildMember(guildId, userId)` — verified in Koishi docs                                                            |
| QMGR-04 | 所有工具需 bot 具有管理员角色才激活（`requireBotRole` activator） | `requireBotRole` already exists in `activators.ts` from Phase 36; `botRole` already injected into `toolCtxWithPercept` in `loop.ts` |
| QMGR-05 | 插件自带 Skill 定义，在 bot 有管理权限时自动激活管理工具          | `bot-role` trait signal already emitted by `SceneTrait` from Phase 36; `essence-mgmt` SKILL.md is the exact pattern to follow       |

</phase_requirements>

---

## Summary

Phase 37 adds three moderation tools (`delmsg`, `ban`, `kick`) to the bot. The entire activation infrastructure was already built in Phase 36: `requireBotRole` activator exists, `botRole` is injected into `ToolExecutionContext`, and `SceneTrait` emits `bot-role` signals. The Skill pattern is identical to `essence-mgmt` — a SKILL.md with `and(scene:group-chat, or(bot-role:admin, bot-role:owner))` conditions.

The three tools use the standard Koishi Bot API (`session.bot.deleteMessage`, `session.bot.muteGuildMember`, `session.bot.kickGuildMember`) rather than OneBot-specific `_request` calls. This is a deliberate choice: the Koishi Bot API is cross-platform and already typed. The v3 reference (`qmanager.ts`) confirms this exact pattern. The `delmsg` tool accepts an array of short IDs and resolves each via `lookupNativeMsgId` — the same helper already in `OnebotPlugin.resolveNativeMsgId`. The safety intercept (block operations on bot self and on admin/owner members) requires checking `view.entities` for the target user's role, which is available via `Entity.attributes.roles`.

The implementation is entirely additive: extend `OnebotPlugin` with three new `@Action` handlers and add one new `SKILL.md`. No new infrastructure, no new dependencies, no new trait signals needed.

**Primary recommendation:** Add `delmsg`, `ban`, `kick` as `@Action` handlers to `OnebotPlugin`, add a `qmanager` SKILL.md with `and(group-chat, or(admin, owner))` conditions. All three tools use `requireBotRole("admin")` activator and `hidden: true`.

---

## Standard Stack

### Core

| Library | Version | Purpose                                                           | Why Standard                                            |
| ------- | ------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| koishi  | 4.x     | `session.bot.deleteMessage`, `muteGuildMember`, `kickGuildMember` | Standard Koishi Bot API — cross-platform, already typed |

### Supporting

| Library                     | Version             | Purpose                       | When to Use                                |
| --------------------------- | ------------------- | ----------------------------- | ------------------------------------------ |
| `requireBotRole` activator  | internal (Phase 36) | Gate tools on bot admin role  | Already exists — just import and use       |
| `resolveNativeMsgId` helper | internal (Phase 36) | Short ID → native platform ID | Already in `OnebotPlugin` — reuse directly |

### No New Dependencies

Zero new npm packages. All three moderation operations use the standard Koishi Bot API which is already available via `session.bot`.

---

## Architecture Patterns

### Recommended Project Structure

```
core/src/services/plugin/builtin/onebot/
└── index.ts           # EXTEND: add delmsg, ban, kick @Action handlers

core/resources/skills/
└── qmanager/          # NEW: Skill for all three moderation tools
    └── SKILL.md
```

No new packages, no new files beyond the SKILL.md. Everything goes into the existing `OnebotPlugin`.

### Pattern 1: delmsg — batch delete via short ID array

The user decision specifies `delmsg` accepts a `messageId` array. Each short ID is resolved to a native platform ID via `resolveNativeMsgId`, then `session.bot.deleteMessage(channelId, nativeId)` is called for each. Failures are collected and reported together.

```typescript
// Source: Koishi docs — bot.deleteMessage(channelId, messageId)
// Source: existing resolveNativeMsgId helper in OnebotPlugin

@Action({
  name: "delmsg",
  description: "撤回指定消息。传入消息短 ID 列表，支持批量撤回。",
  parameters: withInnerThoughts({
    message_ids: Schema.array(Schema.string()).required()
      .description("要撤回的消息短 ID 列表（来自 <msg id=...> 标签）"),
  }),
  activators: [requireSession(), requireBotRole("admin")],
  hidden: true,
})
async delmsg(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const session = ctx.session;
  if (!session) return Failed("无活跃会话");
  if (!session.guildId) return Failed("撤回消息仅在群聊中可用");

  const rawIds = params["message_ids"];
  const ids = Array.isArray(rawIds) ? rawIds.map(String) : [String(rawIds ?? "")];
  if (!ids.length || ids.every((id) => !id)) return Failed("message_ids 不能为空");

  const channelId = session.channelId;
  const errors: string[] = [];
  let successCount = 0;

  for (const shortIdStr of ids) {
    const nativeId = this.resolveNativeMsgId(ctx, shortIdStr);
    if (!nativeId) {
      errors.push(`消息 ${shortIdStr} 不在当前上下文中`);
      continue;
    }
    try {
      await session.bot.deleteMessage(channelId, nativeId);
      successCount++;
    } catch (e) {
      errors.push(`撤回消息 ${shortIdStr} 失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length === 0) return Success(`已撤回 ${successCount} 条消息`);
  if (successCount === 0) return Failed(errors.join("；"));
  return Success(`已撤回 ${successCount} 条消息，${errors.length} 条失败：${errors.join("；")}`);
}
```

### Pattern 2: ban — mute with duration in seconds

`session.bot.muteGuildMember(guildId, userId, durationMs)` takes duration in **milliseconds**. The user decision specifies the tool parameter is in **seconds**. Conversion: `durationSeconds * 1000`. Duration 0 = lift ban (Koishi docs confirm: "如果传入的禁言时长为 0 则表示解除禁言").

Safety intercept: check if target user is bot self or has admin/owner role in `view.entities`.

```typescript
// Source: Koishi docs — bot.muteGuildMember(guildId, userId, duration?, reason?)
// duration is in milliseconds; 0 = lift ban

@Action({
  name: "ban",
  description: "禁言用户。duration 为禁言时长（秒），0 表示解除禁言。",
  parameters: withInnerThoughts({
    user_id: Schema.string().required().description("目标用户的平台 ID"),
    duration: Schema.number().required().description("禁言时长（秒），0 = 解除禁言"),
  }),
  activators: [requireSession(), requireBotRole("admin")],
  hidden: true,
})
async ban(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const session = ctx.session;
  if (!session) return Failed("无活跃会话");
  if (!session.guildId) return Failed("禁言仅在群聊中可用");

  const userId = String(params["user_id"] ?? "");
  if (!userId) return Failed("user_id 不能为空");

  const duration = Number(params["duration"]);
  if (!Number.isFinite(duration) || duration < 0) return Failed("duration 必须为非负数");

  // Safety intercept: block operating on bot self
  if (userId === session.bot.selfId) return Failed("禁言失败：不能对 bot 自身执行此操作");

  // Safety intercept: block operating on admin/owner
  const targetRole = this.getEntityRole(ctx, userId);
  if (targetRole === "admin" || targetRole === "owner") {
    return Failed("禁言失败：目标用户是管理员或群主");
  }

  try {
    await session.bot.muteGuildMember(session.guildId, userId, duration * 1000);
    if (duration === 0) return Success(`已解除用户 ${userId} 的禁言`);
    const minutes = Math.round(duration / 60);
    return Success(minutes > 0 ? `已禁言用户 ${userId} ${minutes} 分钟` : `已禁言用户 ${userId} ${duration} 秒`);
  } catch (e) {
    return Failed(`禁言失败：${e instanceof Error ? e.message : String(e)}`);
  }
}
```

### Pattern 3: kick — remove user from guild

`session.bot.kickGuildMember(guildId, userId, permanent?)` — `permanent` defaults to false (user can rejoin). The tool does not expose `permanent` to the LLM (not in scope).

```typescript
// Source: Koishi docs — bot.kickGuildMember(guildId, userId, permanent?)

@Action({
  name: "kick",
  description: "将用户移出群组。",
  parameters: withInnerThoughts({
    user_id: Schema.string().required().description("目标用户的平台 ID"),
  }),
  activators: [requireSession(), requireBotRole("admin")],
  hidden: true,
})
async kick(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const session = ctx.session;
  if (!session) return Failed("无活跃会话");
  if (!session.guildId) return Failed("踢人仅在群聊中可用");

  const userId = String(params["user_id"] ?? "");
  if (!userId) return Failed("user_id 不能为空");

  // Safety intercept: block operating on bot self
  if (userId === session.bot.selfId) return Failed("踢人失败：不能对 bot 自身执行此操作");

  // Safety intercept: block operating on admin/owner
  const targetRole = this.getEntityRole(ctx, userId);
  if (targetRole === "admin" || targetRole === "owner") {
    return Failed("踢人失败：目标用户是管理员或群主");
  }

  try {
    await session.bot.kickGuildMember(session.guildId, userId);
    return Success(`已将用户 ${userId} 移出群组`);
  } catch (e) {
    return Failed(`踢人失败：${e instanceof Error ? e.message : String(e)}`);
  }
}
```

### Pattern 4: getEntityRole helper — safety intercept

The safety intercept needs to check the target user's role. `view.entities` is available via `ctx.percept` — but `percept` doesn't carry `view`. The cleanest approach: access `HorizonService` directly and call `getEntities`, or use the `percept.metadata` which carries `senderId`. However, the simplest correct approach is to access the `HorizonView` entities from the `ToolExecutionContext` — but `view` is not currently in `toolCtx`.

**Resolution:** Add a private helper `getEntityRole(ctx, userId)` that accesses `HorizonService` to look up the entity's role from the entity cache. The `HorizonService.getEntities()` is async, but the entity data is already cached in the database. Alternatively, pass `view.entities` into `toolCtxWithPercept` in `loop.ts` — a small, safe addition.

**Recommended approach:** Add `entities?: Entity[]` to `ToolExecutionContext` (or use the existing `[key: string]: unknown` index) and pass `view.entities` from `loop.ts`. Then the helper reads `ctx["entities"]` to find the target user's role.

```typescript
// In loop.ts — extend toolCtxWithPercept:
const toolCtxWithPercept = {
  ...toolCtx,
  percept,
  botRole: view.self?.role,
  entities: view.entities,  // ADD THIS
};

// In OnebotPlugin — private helper:
private getEntityRole(ctx: ToolExecutionContext, userId: string): "owner" | "admin" | null {
  const entities = ctx["entities"] as Array<{ userId?: string; attributes?: Record<string, unknown> }> | undefined;
  if (!entities) return null;
  const entity = entities.find((e) => e.userId === userId);
  if (!entity?.attributes?.roles) return null;
  const roles = entity.attributes.roles as string[];
  if (roles.some((r) => /^owner$/i.test(r))) return "owner";
  if (roles.some((r) => /^(admin|administrator|moderator)$/i.test(r))) return "admin";
  return null;
}
```

### Pattern 5: qmanager SKILL.md

Identical structure to `essence-mgmt/SKILL.md` — same dual-gating with `and(scene:group-chat, or(bot-role:admin, bot-role:owner))`. All three tools included.

```yaml
---
name: qmanager
description: Enables moderation tools when bot has admin role in group chat
lifecycle: trait-bound
conditions:
  and:
    - match:
        dimension: scene
        value: group-chat
    - or:
        - match:
            dimension: bot-role
            value: admin
        - match:
            dimension: bot-role
            value: owner
effects:
  tools:
    include:
      - delmsg
      - ban
      - kick
---
在群聊中且 bot 有管理员权限时，可以执行群管操作。典型场景：用户发布违规内容时撤回消息、刷屏骚扰时禁言、严重违规时踢出群组。
```

### Anti-Patterns to Avoid

- **Using `session.onebot._request("delete_msg", ...)` instead of `session.bot.deleteMessage()`:** The standard Koishi Bot API is the correct choice — it's cross-platform, typed, and what v3 used. OneBot-specific `_request` is only needed for OneBot-exclusive features (reactions, essence, poke).
- **Passing duration in minutes to `muteGuildMember`:** The Koishi API takes **milliseconds**. The v3 reference used minutes (`duration * 60 * 1000`), but the user decision specifies seconds. Convert: `durationSeconds * 1000`.
- **Not checking `session.guildId` before calling guild APIs:** All three tools are group-only. Guard at the top of each handler.
- **Forgetting `requireBotRole` activator on `delmsg`:** Unlike `reaction_create` which only needs `requireSession()`, all three QManager tools need `requireBotRole("admin")` since they require admin permissions.
- **Skipping safety intercept for admin targets:** The user decision explicitly requires blocking operations on admin/owner members. This must happen before the API call.

---

## Don't Hand-Roll

| Problem             | Don't Build                            | Use Instead                                                | Why                                                    |
| ------------------- | -------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Message deletion    | Custom OneBot `delete_msg` request     | `session.bot.deleteMessage(channelId, msgId)`              | Standard Koishi API, already typed, cross-platform     |
| User mute           | Custom OneBot `set_group_ban` request  | `session.bot.muteGuildMember(guildId, userId, durationMs)` | Standard Koishi API, 0=lift ban built-in               |
| User kick           | Custom OneBot `set_group_kick` request | `session.bot.kickGuildMember(guildId, userId)`             | Standard Koishi API                                    |
| Short ID resolution | Custom lookup                          | `this.resolveNativeMsgId(ctx, shortIdStr)`                 | Already in `OnebotPlugin`, reuse directly              |
| Bot role check      | Inline `getGuildMember` call           | `requireBotRole("admin")` activator                        | Already exists from Phase 36, cached in HorizonService |
| Skill activation    | Programmatic registration              | `qmanager/SKILL.md` with conditions                        | File-based skills are the standard pattern             |

**Key insight:** Phase 36 built all the infrastructure this phase needs. The work is purely additive: three `@Action` handlers + one SKILL.md.

---

## Common Pitfalls

### Pitfall 1: muteGuildMember duration unit mismatch

**What goes wrong:** Bot bans user for 1000x longer than intended (e.g., 1000 seconds instead of 1 second).
**Why it happens:** `muteGuildMember` takes milliseconds; the tool parameter is in seconds; easy to forget the conversion.
**How to avoid:** Always multiply by 1000: `await session.bot.muteGuildMember(guildId, userId, duration * 1000)`.
**Warning signs:** Extremely long ban durations in practice.

### Pitfall 2: delmsg resolves forward IDs instead of message IDs

**What goes wrong:** LLM passes a forward bundle ID to `delmsg` instead of a message short ID.
**Why it happens:** Both `<msg id=...>` and `<forward id=...>` appear in context; LLM may confuse them.
**How to avoid:** Tool description must clearly state "来自 `<msg id=...>` 标签的短 ID". The `resolveNativeMsgId` helper will return null for forward IDs (they're not in the short ID map), so the tool will return a clear error.
**Warning signs:** `resolveNativeMsgId` returning null for IDs that look like forward IDs.

### Pitfall 3: Safety intercept misses bot self-ID check

**What goes wrong:** LLM tries to ban/kick the bot itself, causing API error or unexpected behavior.
**Why it happens:** The LLM sees the bot as a member in the entity list and might target it.
**How to avoid:** Check `userId === session.bot.selfId` before any API call. Return `Failed("不能对 bot 自身执行此操作")`.
**Warning signs:** API errors when bot tries to mute/kick itself.

### Pitfall 4: Entity role lookup fails silently

**What goes wrong:** Safety intercept doesn't block operations on admins because `getEntityRole` returns null.
**Why it happens:** `view.entities` may not include all guild members — only recently active ones (capped at `maxActiveEntities`). An admin who hasn't been active recently may not be in the entity cache.
**How to avoid:** This is an acceptable limitation — document it. The safety intercept is best-effort. The platform API will also reject the operation if the target is an admin (returning an error), which the handler catches and wraps.
**Warning signs:** Admin ban attempts reaching the API and returning platform errors.

### Pitfall 5: `requirePlatform("onebot")` not needed for standard Bot API

**What goes wrong:** Adding `requirePlatform("onebot")` to QManager tools unnecessarily restricts them to OneBot.
**Why it happens:** Phase 36 tools all use `requirePlatform("onebot")` because they use OneBot-specific `_request` calls. QManager uses standard Koishi Bot API.
**How to avoid:** Do NOT add `requirePlatform("onebot")` to QManager tools. The standard Bot API works on any platform that supports guild moderation. Only add `requireSession()` and `requireBotRole("admin")`.
**Warning signs:** Tools not appearing on non-OneBot platforms that support moderation.

### Pitfall 6: delmsg array parameter schema

**What goes wrong:** TypeScript error or runtime failure when LLM passes a single string instead of an array.
**Why it happens:** `Schema.array(Schema.string())` is strict — a single string won't coerce to array.
**How to avoid:** In the handler, normalize: `const ids = Array.isArray(rawIds) ? rawIds.map(String) : [String(rawIds ?? "")]`. This handles both array and single-string inputs gracefully.
**Warning signs:** TypeScript errors on `Schema.array()` usage, or runtime failures when LLM passes a string.

---

## Code Examples

### Koishi Bot API — verified signatures

```typescript
// Source: Koishi docs — references/koishi-docs/en-US/api/resources/message.md
// bot.deleteMessage(channelId, messageId): Promise<void>
await session.bot.deleteMessage(session.channelId, nativeMessageId);

// Source: Koishi docs — references/koishi-docs/en-US/api/resources/member.md
// bot.muteGuildMember(guildId, userId, duration?, reason?): Promise<void>
// duration in milliseconds; 0 = lift ban
await session.bot.muteGuildMember(session.guildId, userId, durationSeconds * 1000);

// Source: Koishi docs — references/koishi-docs/en-US/api/resources/member.md
// bot.kickGuildMember(guildId, userId, permanent?): Promise<void>
await session.bot.kickGuildMember(session.guildId, userId);
```

### Passing entities into ToolExecutionContext

```typescript
// Source: core/src/services/agent/loop.ts (line 71 — current state after Phase 36)
// Current:
const toolCtxWithPercept = { ...toolCtx, percept, botRole: view.self?.role };

// After Phase 37 change:
const toolCtxWithPercept = {
  ...toolCtx,
  percept,
  botRole: view.self?.role,
  entities: view.entities,
};
```

### qmanager SKILL.md — exact format

```yaml
---
name: qmanager
description: Enables moderation tools when bot has admin role in group chat
lifecycle: trait-bound
conditions:
  and:
    - match:
        dimension: scene
        value: group-chat
    - or:
        - match:
            dimension: bot-role
            value: admin
        - match:
            dimension: bot-role
            value: owner
effects:
  tools:
    include:
      - delmsg
      - ban
      - kick
---
在群聊中且 bot 有管理员权限时，可以执行群管操作。典型场景：用户发布违规内容时撤回消息、刷屏骚扰时禁言、严重违规时踢出群组。
```

### v3 reference — confirmed API pattern

```typescript
// Source: references/YesImBot-v3/packages/core/src/services/extension/builtin/qmanager.ts
// v3 used the same Koishi Bot API:
await session.bot.deleteMessage(targetChannel, message_id);
await session.bot.muteGuildMember(targetChannel, user_id, Number(duration) * 60 * 1000); // v3 used minutes
await session.bot.kickGuildMember(targetChannel, user_id);
// Note: v3 duration was in minutes; Phase 37 uses seconds per user decision
```

---

## State of the Art

| Old Approach                     | Current Approach                      | When Changed             | Impact                                                                   |
| -------------------------------- | ------------------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| v3: `@Tool` decorator (parallel) | v4: `@Action` decorator (sequential)  | Phase 35                 | Moderation actions execute sequentially — correct for side-effecting ops |
| v3: duration in minutes          | v4: duration in seconds               | User decision (Phase 37) | More granular control; requires `* 1000` for Koishi API                  |
| v3: no hidden/skill gating       | v4: `hidden: true` + Skill activation | Phase 35                 | Tools only visible when bot has admin role                               |
| v3: no safety intercept          | v4: block self + admin targets        | User decision (Phase 37) | Prevents accidental self-harm and privilege escalation                   |

---

## Open Questions

1. **Should `delmsg` have a batch size cap?**
   - What we know: User decision says "支持批量撤回" with no explicit cap; Claude's discretion
   - What's unclear: Whether to cap at e.g. 10 to prevent abuse
   - Recommendation: Cap at 10 (same as `get_forward_msg` message cap). Return partial success if some fail.

2. **Should `ban` expose a `reason` parameter?**
   - What we know: `muteGuildMember` accepts an optional `reason` string; user decision doesn't mention it
   - What's unclear: Whether the LLM should be able to provide a ban reason
   - Recommendation: Omit `reason` parameter — not in scope per user decisions, keeps tool simple.

3. **Does `session.bot.muteGuildMember` work on all OneBot implementations?**
   - What we know: Koishi docs mark it as "实验性" (experimental); v3 used it successfully
   - What's unclear: Which OneBot implementations support it (NapCat, LLOneBot, go-cqhttp)
   - Recommendation: Use it — it's the standard Koishi API. If a platform doesn't support it, the API will throw and the handler will return a friendly error.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — skipping this section.

---

## Sources

### Primary (HIGH confidence)

- `core/src/services/plugin/builtin/onebot/index.ts` — existing `@Action` pattern, `resolveNativeMsgId` helper, `requireBotRole` usage
- `core/src/services/plugin/activators.ts` — `requireBotRole` activator (already exists from Phase 36)
- `core/src/services/agent/loop.ts` — `toolCtxWithPercept` construction, `botRole` injection pattern
- `core/src/services/trait/detectors/scene.ts` — `bot-role` signal emission (already exists from Phase 36)
- `core/resources/skills/essence-mgmt/SKILL.md` — exact SKILL.md pattern to replicate for `qmanager`
- `references/koishi-docs/en-US/api/resources/message.md` — `bot.deleteMessage(channelId, messageId)` signature
- `references/koishi-docs/en-US/api/resources/member.md` — `bot.muteGuildMember(guildId, userId, durationMs)` and `bot.kickGuildMember(guildId, userId)` signatures
- `references/YesImBot-v3/packages/core/src/services/extension/builtin/qmanager.ts` — v3 reference implementation confirming API usage

### Secondary (MEDIUM confidence)

- `muteGuildMember` experimental badge in Koishi docs — may not work on all platforms; acceptable risk since error is caught and wrapped

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — zero new deps, all APIs verified in Koishi docs and v3 reference
- Architecture patterns: HIGH — `@Action` decorator, `requireBotRole`, SKILL.md all verified in Phase 36 implementation
- Koishi Bot API signatures: HIGH — verified directly in `references/koishi-docs/en-US/api/resources/`
- Safety intercept via entities: MEDIUM — `view.entities` availability confirmed, but entity cache may not include all members

**Research date:** 2026-02-28
**Valid until:** 2026-03-29 (stable internal codebase)
