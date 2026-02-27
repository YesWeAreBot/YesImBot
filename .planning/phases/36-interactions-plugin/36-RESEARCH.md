# Phase 36: Interactions Plugin - Research

**Researched:** 2026-02-27
**Domain:** Koishi OneBot plugin — social interaction tools (reaction, essence, poke, forward)
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Reaction:**

- Only native face IDs (e.g. `[CQ:face,id=178]`), no Unicode emoji
- LLM passes face ID number directly — no semantic mapping
- Max one reaction per message to prevent spam
- Can react to any message in context, including bot's own
- Only messages that appeared in context (via `<msg>` short ID) are valid targets

**Essence:**

- Tool description guides usage; LLM decides autonomously — no hard limits
- `essence_delete` can cancel any essence, not just bot-set ones
- Only context-visible messages are valid targets (same unified limit)

**Poke:**

- LLM decides when to use; tool description guides
- Per-user cooldown to prevent repeated pokes

**Forward:**

- `get_forward_msg` returns plain text summary
- Reuses existing element parsing logic
- Message count cap with truncation notice

**Skill grouping:**

- Skill A (social): `reaction_create` + `send_poke` — activates in group AND private chat; `reaction_create` self-limits to group at tool level
- Skill B (essence-mgmt): `essence_create` + `essence_delete` — group + bot needs admin role
- `get_forward_msg`: NOT via Skill — context-triggered when forwarded messages present in context

**Plugin pattern:** Follows persona plugin pattern exactly (declare module, ctx.on dispose hook)

### Claude's Discretion

- Poke cooldown duration
- Forward message count cap value
- Tool description wording
- face ID parameter validation strategy

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                   | Research Support                                                                                |
| ------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| INTR-01 | `reaction_create` tool adds emoji reaction to a message (OneBot)              | `session.onebot._request("set_msg_emoji_like")` — verified pattern from existing OnebotPlugin   |
| INTR-02 | `essence_create` / `essence_delete` tools set/remove group highlight (OneBot) | `set_essence_msg` / `delete_essence_msg` OneBot API actions                                     |
| INTR-03 | `send_poke` tool sends poke/nudge to a user (OneBot)                          | `send_poke` OneBot API action; per-user cooldown via Map                                        |
| INTR-04 | `get_forward_msg` reads forwarded message bundle (OneBot)                     | Already scaffolded in `OnebotPlugin` — needs enhancement (cap + element parsing)                |
| INTR-05 | Plugin ships bundled Skills; group-chat tools auto-activate via Skill         | Skill file pattern confirmed from `search` skill; `requireBotRole` activator needed for Skill B |

</phase_requirements>

---

## Summary

Phase 36 adds four OneBot-specific social interaction tools to the bot. The codebase already has a complete plugin infrastructure (`Plugin` base class, `@Action`/`@Tool` decorators, `requirePlatform`/`requireSession` activators, `PluginService.register()`) and a reference implementation in `OnebotPlugin` that already contains a stub `get_forward_msg`. The work is primarily additive: extend `OnebotPlugin` with three new actions, enhance the existing `get_forward_msg`, add a `requireBotRole` activator, and ship two SKILL.md files.

The Skill condition system uses `TraitSignal` dimensions (`scene`, `attention`, `heat`). The `scene` detector emits `scene: group-chat` or `scene: private-chat` with confidence 1.0. Skill B needs bot-admin gating — this is NOT a trait signal; it must be a custom `activate` function or a new activator. The blocker from STATE.md ("Skill condition schema may not have `platform` dimension") is confirmed: there is no `platform` dimension in the trait system. The solution is to use a code activator (`activate.cjs`) for Skill B that checks `view.self.role`.

The `get_forward_msg` stub in `OnebotPlugin` already calls `session.onebot._request("get_forward_msg")` and formats messages. It needs: (1) a message count cap with truncation notice, (2) reuse of `ElementFormatterService` for content parsing instead of `raw_message`. The context-trigger mechanism for `get_forward_msg` (not via Skill) means it stays `hidden: true` and is unhidden by a different path — the planner needs to decide whether this is a new Skill with a custom activator that checks context content, or a permanent unhide when forwarded messages are detected.

**Primary recommendation:** Extend `OnebotPlugin` with the three new actions, enhance `get_forward_msg`, add `requireBotRole` activator, and ship two SKILL.md files. Skill B uses a `activate.cjs` script that reads `view.self.role` from the trait signal metadata or uses a custom activator approach.

---

## Standard Stack

### Core

| Library                      | Version  | Purpose                                       | Why Standard                       |
| ---------------------------- | -------- | --------------------------------------------- | ---------------------------------- |
| koishi                       | 4.x      | Framework, `Session`, `Bot` types             | Project foundation                 |
| koishi-plugin-adapter-onebot | peer dep | `session.onebot._request()` type augmentation | Already declared in `OnebotPlugin` |

### Supporting

| Library                   | Version  | Purpose                                 | When to Use                         |
| ------------------------- | -------- | --------------------------------------- | ----------------------------------- |
| gray-matter               | existing | SKILL.md frontmatter parsing            | Already used by skill loader        |
| `ElementFormatterService` | internal | Parse message segments to readable text | Reuse for `get_forward_msg` content |

### No New Dependencies

Zero new npm packages required. All OneBot API calls go through `session.onebot._request()` which is already typed via the `declare module "koishi"` augmentation in `OnebotPlugin`.

---

## Architecture Patterns

### Recommended Project Structure

```
core/src/services/plugin/
├── activators.ts              # ADD: requireBotRole activator
├── builtin/
│   └── onebot/
│       ├── index.ts           # EXTEND: add reaction_create, essence_create/delete, enhance get_forward_msg
│       └── types.ts           # EXTEND: add response types for new API calls
core/resources/skills/
├── social-interactions/       # NEW: Skill A
│   └── SKILL.md
└── essence-mgmt/              # NEW: Skill B
    ├── SKILL.md
    └── scripts/
        └── activate.cjs       # Bot-admin check
```

### Pattern 1: Extending OnebotPlugin with @Action decorator

All new tools follow the existing `@Action` decorator pattern in `OnebotPlugin`. Actions execute sequentially (vs Tools which run in parallel) — correct for side-effecting operations like reactions.

```typescript
// Source: core/src/services/plugin/builtin/onebot/index.ts (existing pattern)
@Action({
  name: "reaction_create",
  description: "Add an emoji reaction to a message. Only works in group chats. ...",
  parameters: withInnerThoughts({
    message_id: Schema.string().required().description("Short message ID from <msg id=...>"),
    face_id: Schema.number().required().description("QQ face ID number (e.g. 178)"),
  }),
  activators: [requireSession(), requirePlatform("onebot")],
  hidden: true,
})
async reactionCreate(
  params: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const session = ctx.session;
  if (!session) return Failed("No active session");
  if (!session.guildId) return Failed("Reactions are only available in group chats");
  const messageId = String(params["message_id"] ?? "");
  const faceId = Number(params["face_id"]);
  if (!messageId) return Failed("message_id is required");
  if (!Number.isInteger(faceId) || faceId < 0) return Failed("face_id must be a non-negative integer");
  await session.onebot._request("set_msg_emoji_like", {
    message_id: messageId,
    emoji_id: String(faceId),
  });
  return Success("Reaction added");
}
```

### Pattern 2: requireBotRole activator

New activator in `activators.ts` that checks `ToolExecutionContext` for bot role. The `ToolExecutionContext` has `session` and `bot` — bot role is available via `HorizonService.getBotRole()` but that's async. The simpler approach: pass bot role through `percept.metadata` or check `session.bot.getGuildMember` inline with caching.

**Recommended approach:** Add `botRole` to `ToolExecutionContext` (it's already an open `[key: string]: unknown` index signature). The agent loop already calls `horizon.buildView()` which fetches bot role — pass it into `toolCtx`.

```typescript
// Source: core/src/services/plugin/activators.ts (new addition)
export function requireBotRole(role: "admin" | "owner" = "admin", reason?: string): Activator {
  return {
    check: (ctx) => {
      const botRole = ctx["botRole"] as string | undefined;
      if (role === "admin") return botRole === "admin" || botRole === "owner";
      return botRole === "owner";
    },
    reason: reason ?? `Requires bot to have ${role} role`,
    onFail: "remove",
  };
}
```

Then in `agent/loop.ts`, after `buildView()`, add `botRole: view.self.role` to `toolCtxWithPercept`.

### Pattern 3: Skill A — social-interactions SKILL.md

Uses `scene` dimension. Skill A activates in both group and private chat (tool self-limits for group-only tools).

```yaml
# core/resources/skills/social-interactions/SKILL.md
---
name: social-interactions
description: Enables social interaction tools (reactions, poke) in conversations
lifecycle: trait-bound
conditions:
  or:
    - match:
        dimension: scene
        value: group-chat
    - match:
        dimension: scene
        value: private-chat
effects:
  tools:
    include:
      - reaction_create
      - send_poke
---
在对话中可以使用社交互动工具。reaction_create 仅在群聊中有效，send_poke 在群聊和私聊均可使用。
```

### Pattern 4: Skill B — essence-mgmt with code activator

Skill B needs bot-admin check. Since trait signals don't carry platform role info, use a code activator (`activate.cjs`) that receives `signals` and checks for a custom signal, OR use the `activate` function approach with a custom trait detector.

**Simpler approach:** Register a custom trait signal `bot-role: admin` from a new detector, then use a SKILL.md condition. But adding a new detector is more invasive.

**Recommended approach:** Use `activate.cjs` that always returns `false` for the file-based check, and instead register Skill B programmatically from the plugin using `SkillRegistry.register()` with a custom `activate` function that checks `signals` for a `bot-role` dimension — but this requires a new trait detector.

**Simplest correct approach:** Register Skill B from the `InteractionsPlugin` constructor using `ctx["yesimbot.skill"].register()` with a custom `activate` function that checks `ctx["botRole"]` — but `activate` only receives `TraitSignal[]`, not `ToolExecutionContext`.

**Resolution:** The cleanest path is:

1. Add a `bot-role` trait signal emitted by a new `BotRoleTrait` detector (or extend `SceneTrait`)
2. Skill B SKILL.md uses `conditions: { and: [{ match: scene group-chat }, { match: bot-role admin }] }`

OR simpler: Register Skill B programmatically from `InteractionsPlugin` with `activate: (signals) => signals.some(s => s.dimension === 'scene' && s.value === 'group-chat') && signals.some(s => s.dimension === 'bot-role' && (s.value === 'admin' || s.value === 'owner'))` — but this still needs the `bot-role` signal.

**Final recommendation:** Add `bot-role` signal to `SceneTrait.detect()` using `view.self.role` (already available in `buildView`). Then Skill B is a pure SKILL.md with conditions.

### Pattern 5: Per-user poke cooldown

Simple in-memory Map in `OnebotPlugin`. No external dependency needed.

```typescript
// In OnebotPlugin class
private pokeCooldowns = new Map<string, number>(); // userId -> lastPokeTimestamp
private readonly POKE_COOLDOWN_MS = 60_000; // 60 seconds — Claude's discretion

// In send_poke handler:
const targetUserId = String(params["target_user_id"] ?? "");
const now = Date.now();
const lastPoke = this.pokeCooldowns.get(targetUserId) ?? 0;
if (now - lastPoke < this.POKE_COOLDOWN_MS) {
  return Failed(`Poke cooldown active for user ${targetUserId}`);
}
this.pokeCooldowns.set(targetUserId, now);
```

### Pattern 6: get_forward_msg enhancement

The existing stub uses `raw_message` (raw CQ code string). Enhancement: apply message count cap and use `ElementFormatterService` for content.

```typescript
// Cap at N messages (Claude's discretion: 10)
const MAX_FORWARD_MESSAGES = 10;
const messages = response.data.messages.slice(0, MAX_FORWARD_MESSAGES);
const truncated = response.data.messages.length > MAX_FORWARD_MESSAGES;
const formatted = await formatForwardMessage(messages, this.ctx);
const suffix = truncated
  ? `\n\n[Showing ${MAX_FORWARD_MESSAGES} of ${response.data.messages.length} messages]`
  : "";
return Success(formatted + suffix);
```

### Pattern 7: Context-triggered get_forward_msg

The CONTEXT.md decision: `get_forward_msg` is NOT via Skill — it's context-triggered when forwarded messages are present. Implementation options:

**Option A:** Register a Skill programmatically with `activate: (signals) => signals.some(s => s.dimension === 'has-forward' && s.value === 'true')` — requires a new `has-forward` trait signal from a detector that scans message content for `<forward>` elements.

**Option B:** Keep `get_forward_msg` permanently visible (not hidden) when on OneBot platform — simpler but violates the hidden-by-default contract.

**Option C:** The `get_forward_msg` tool is already in `OnebotPlugin` with `hidden: true` and `activators: [requirePlatform("onebot")]`. Add a new Skill C (no name in CONTEXT.md) with a code activator that checks if recent messages contain forwarded content.

**Recommended:** Option C — add a `forward-present` Skill with `activate.cjs` that scans `signals` for a `has-forward` dimension, and add a `HasForwardTrait` detector that emits this signal when the trigger message contains a `<forward>` element. This is consistent with the trait-skill pipeline.

### Anti-Patterns to Avoid

- **Calling `session.onebot._request()` without null-checking session:** Always guard with `if (!session) return Failed(...)` first
- **Using `FunctionType.Tool` for side-effecting operations:** Reactions/essence/poke are `@Action` (sequential), not `@Tool` (parallel)
- **Hardcoding message IDs:** Always resolve via `horizon.lookupNativeMsgId(channelKey, shortId)` — the LLM sees short IDs, not platform IDs
- **Registering Skills in PluginService constructor:** Skills belong in `SkillRegistry`, not `PluginService`
- **Forgetting `source: "plugin"` on programmatically registered skills:** File-based skills use `"file"`, plugin-registered use `"plugin"`

---

## Don't Hand-Roll

| Problem                       | Don't Build                          | Use Instead                                        | Why                                                 |
| ----------------------------- | ------------------------------------ | -------------------------------------------------- | --------------------------------------------------- |
| OneBot API calls              | Custom HTTP client                   | `session.onebot._request()`                        | Already typed, handles auth/connection              |
| Tool registration             | Manual Map manipulation              | `@Action`/`@Tool` decorators + `Plugin` base class | Decorator pattern handles binding, metadata         |
| Platform gating               | Manual `if (platform === "onebot")`  | `requirePlatform("onebot")` activator              | Consistent, composable, already exists              |
| Skill file loading            | Custom YAML parser                   | `loadSkillsFromDir()` + gray-matter                | Already handles frontmatter + code activators       |
| Short ID → platform ID lookup | Custom lookup                        | `horizon.lookupNativeMsgId(channelKey, shortId)`   | Already implemented with eviction                   |
| Bot role check                | Direct `getGuildMember` call in tool | `requireBotRole` activator + `botRole` in toolCtx  | Cached in HorizonService, avoids repeated API calls |

**Key insight:** The plugin infrastructure is complete. This phase is 90% configuration/wiring, 10% new logic (cooldown map, bot-role signal, forward cap).

---

## Common Pitfalls

### Pitfall 1: Short ID vs Platform ID confusion

**What goes wrong:** LLM passes short ID (e.g. `"42"`) but OneBot API needs platform message ID (e.g. `"7890123456"`).
**Why it happens:** The `<msg id="42">` tag shows short IDs to the LLM. Tools receive whatever the LLM passes.
**How to avoid:** In every message-targeting tool handler, resolve via `horizon.lookupNativeMsgId(channelKey, Number(params.message_id))`. Return `Failed("Message not found in current context")` if lookup returns undefined.
**Warning signs:** OneBot API returning "message not found" errors.

### Pitfall 2: Skill B activates without bot having admin role

**What goes wrong:** `essence_create`/`essence_delete` appear in tool list even when bot is a regular member, causing API failures.
**Why it happens:** If Skill B uses only `scene: group-chat` condition without role check.
**How to avoid:** Ensure `bot-role` signal is emitted by trait system AND Skill B conditions include it. Test with bot as regular member.
**Warning signs:** `essence_create` visible in tool list when bot has no admin role.

### Pitfall 3: `get_forward_msg` message_id parameter type

**What goes wrong:** The existing stub takes `message_id` as a string, but the LLM may pass a short integer ID.
**Why it happens:** The `<forward>` element in formatted messages may expose a platform ID or a short ID depending on how `ElementFormatterService` formats it.
**How to avoid:** Verify how `ElementFormatterService` formats `<forward>` elements — check if it exposes a short ID or platform ID. Ensure the tool parameter description matches what the LLM will see.
**Warning signs:** `get_forward_msg` failing with "message not found".

### Pitfall 4: Poke cooldown not scoped to channel

**What goes wrong:** Bot can't poke user A in channel X because it recently poked user A in channel Y.
**Why it happens:** Cooldown keyed only on `userId`, not `platform:channelId:userId`.
**How to avoid:** Key cooldown map on `${platform}:${channelId}:${userId}`.
**Warning signs:** Poke failures in unrelated channels.

### Pitfall 5: Skill A activating in private chat exposes reaction_create

**What goes wrong:** `reaction_create` appears in tool list during private chat, LLM tries to use it, fails.
**Why it happens:** Skill A activates in both group and private (by design), but `reaction_create` is group-only.
**How to avoid:** `reaction_create` handler checks `session.guildId` and returns `Failed("Reactions are only available in group chats")`. The tool description should also state this limitation.
**Warning signs:** LLM calling `reaction_create` in DMs.

### Pitfall 6: `session.onebot` undefined on non-OneBot sessions

**What goes wrong:** TypeScript compiles but runtime throws when accessing `session.onebot` on a Discord session.
**Why it happens:** The `declare module "koishi"` augmentation adds `onebot` to all sessions, but it only exists at runtime on OneBot sessions.
**How to avoid:** `requirePlatform("onebot")` activator ensures tool only runs on OneBot. Still add a runtime guard: `if (!session.onebot) return Failed("OneBot adapter not available")`.
**Warning signs:** Runtime TypeError on non-OneBot platforms.

---

## Code Examples

### Resolving short ID to platform ID in a tool handler

```typescript
// Source: core/src/services/horizon/service.ts — lookupNativeMsgId
async reactionCreate(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const session = ctx.session;
  if (!session) return Failed("No active session");
  if (!session.guildId) return Failed("Reactions are only available in group chats");

  const shortId = Number(params["message_id"]);
  const channelKey = `${ctx.platform}:${ctx.channelId}`;
  const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
  const nativeMsgId = horizon.lookupNativeMsgId(channelKey, shortId);
  if (!nativeMsgId) return Failed("Message not found in current context");

  await session.onebot._request("set_msg_emoji_like", {
    message_id: nativeMsgId,
    emoji_id: String(Number(params["face_id"])),
  });
  return Success("Reaction added");
}
```

### Programmatic skill registration from a plugin

```typescript
// Source: core/src/services/skill/service.ts — register()
// In InteractionsPlugin constructor or a separate Koishi plugin apply():
export function apply(ctx: Context) {
  ctx.inject(["yesimbot.skill"], (ctx) => {
    ctx["yesimbot.skill"].register({
      name: "essence-mgmt",
      description: "Enables essence management when bot has admin role in group",
      lifecycle: "trait-bound",
      source: "plugin",
      activate: (signals) =>
        signals.some((s) => s.dimension === "scene" && s.value === "group-chat") &&
        signals.some(
          (s) => s.dimension === "bot-role" && (s.value === "admin" || s.value === "owner"),
        ),
      effects: {
        tools: { include: ["essence_create", "essence_delete"] },
        prompt: "在群聊中且 bot 有管理员权限时，可以设置或取消精华消息。",
      },
    });
  });
}
```

### Adding bot-role signal to SceneTrait

```typescript
// Source: core/src/services/trait/detectors/scene.ts — detect() method
// Add at end of detect():
if (view.self.role) {
  signals.push({
    dimension: "bot-role",
    value: view.self.role, // "owner" | "admin"
    confidence: 1.0,
  });
}
```

### Skill A SKILL.md (file-based, no code activator needed)

```yaml
---
name: social-interactions
description: Enables reaction and poke tools in conversations
lifecycle: trait-bound
conditions:
  or:
    - match:
        dimension: scene
        value: group-chat
    - match:
        dimension: scene
        value: private-chat
effects:
  tools:
    include:
      - reaction_create
      - send_poke
---
可以使用社交互动工具。reaction_create 仅在群聊中有效（工具自身会检查），send_poke 在群聊和私聊均可使用。
```

### Essence API calls

```typescript
// set_essence_msg — add message as group highlight
await session.onebot._request("set_essence_msg", { message_id: nativeMsgId });

// delete_essence_msg — remove group highlight
await session.onebot._request("delete_essence_msg", { message_id: nativeMsgId });
```

### Poke API call

```typescript
// send_poke — nudge a user
await session.onebot._request("send_poke", {
  group_id: session.guildId, // for group poke
  user_id: targetUserId,
});
// For private poke (no group_id):
await session.onebot._request("send_poke", { user_id: targetUserId });
```

---

## State of the Art

| Old Approach                      | Current Approach                            | When Changed | Impact                                                   |
| --------------------------------- | ------------------------------------------- | ------------ | -------------------------------------------------------- |
| `ctx.provide()` for services      | `Service` subclass pattern                  | Koishi 4.x   | Plugin auto-registers/disposes                           |
| Inline tool registration          | `@Action`/`@Tool` decorators                | Phase 35     | Consistent metadata, binding                             |
| Global tool visibility            | `hidden: true` + Skill `toolFilter.include` | Phase 35     | Tools only appear when contextually relevant             |
| Hardcoded platform IDs in prompts | Short ID system + `lookupNativeMsgId`       | Phase 34     | LLM uses stable short IDs, tools resolve to platform IDs |

**Confirmed current:** `session.onebot._request()` is the correct OneBot raw API call pattern — already used in `OnebotPlugin.getForwardMessage()`.

---

## Open Questions

1. **How does `get_forward_msg` get triggered without a Skill?**
   - What we know: CONTEXT.md says "context-triggered when forwarded messages present" — not via Skill
   - What's unclear: The mechanism. Options: (a) new `has-forward` trait signal + Skill C with code activator, (b) always-visible on OneBot (violates hidden contract), (c) a new "context activator" concept
   - Recommendation: Use option (a) — add `has-forward` signal to `SceneTrait` by scanning trigger message content for `<forward>` element pattern. Skill C with `activate.cjs` checks this signal. This is consistent with the existing trait-skill pipeline.

2. **Does `set_msg_emoji_like` require a specific NapCat/LLOneBot version?**
   - What we know: Standard go-cqhttp uses `set_msg_emoji_like` for reactions; NapCat/LLOneBot may use different action names
   - What's unclear: Which OneBot implementation the user runs
   - Recommendation: Use `set_msg_emoji_like` (most common), document in tool description that it requires a compatible OneBot implementation. Return descriptive error on API failure.

3. **Should `botRole` be added to `ToolExecutionContext` interface or kept as index signature?**
   - What we know: `ToolExecutionContext` has `[key: string]: unknown` index signature, so `ctx["botRole"]` works without type changes
   - What's unclear: Whether to formalize it in the interface
   - Recommendation: Add `botRole?: "owner" | "admin"` to the `ToolExecutionContext` interface for type safety. Low-risk change.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in config.json — skipping this section.

---

## Sources

### Primary (HIGH confidence)

- `core/src/services/plugin/builtin/onebot/index.ts` — existing `get_forward_msg` implementation, `session.onebot._request` pattern
- `core/src/services/plugin/activators.ts` — `requirePlatform`, `requireSession` activator patterns
- `core/src/services/plugin/decorators.ts` — `@Action`, `@Tool`, `withInnerThoughts` patterns
- `core/src/services/plugin/types.ts` — `ToolExecutionContext`, `Activator`, `FunctionDefinition` interfaces
- `core/src/services/skill/service.ts` — `SkillRegistry.register()`, `resolve()`, trait-skill pipeline
- `core/src/services/skill/types.ts` — `SkillDefinition`, `ConditionNode`, `ToolFilter` types
- `core/src/services/skill/loader.ts` — SKILL.md frontmatter schema, `activate.cjs` loading
- `core/src/services/trait/detectors/scene.ts` — `scene` and `attention` signal emission, `view.self.role` availability
- `core/src/services/horizon/service.ts` — `lookupNativeMsgId`, `getBotRole`, `view.self.role`
- `core/src/services/agent/loop.ts` — how `toolCtxWithPercept` is built, where `botRole` can be injected
- `core/resources/skills/search/SKILL.md` — reference Skill file format

### Secondary (MEDIUM confidence)

- OneBot API action names (`set_msg_emoji_like`, `set_essence_msg`, `delete_essence_msg`, `send_poke`) — inferred from existing `get_forward_msg` pattern and common OneBot documentation conventions; exact action names may vary by implementation

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — zero new deps, all patterns verified in existing code
- Architecture patterns: HIGH — decorator pattern, activator pattern, Skill file format all verified
- OneBot API action names: MEDIUM — `get_forward_msg` verified in code; reaction/essence/poke names inferred from OneBot conventions
- Pitfalls: HIGH — short ID confusion, platform gating, cooldown scoping all verified from code inspection

**Research date:** 2026-02-27
**Valid until:** 2026-03-29 (stable internal codebase)
