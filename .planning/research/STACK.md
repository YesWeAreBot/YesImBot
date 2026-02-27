# Stack Research

**Domain:** Koishi 4.x AI chatbot plugin — v2.5 Multimodal & Rich Interaction
**Researched:** 2026-02-27
**Confidence:** HIGH (verified against installed node_modules and codebase source)

---

## Scope

This is a **subsequent milestone** research file. The base stack is already in production (v2.4). This file covers only what is **new or changed** for v2.5's six feature areas:

1. Skill-driven tool architecture (core keeps only `send_message`, Skills declare tools)
2. Interactions plugin (v3 social tools → independent Koishi plugin)
3. QManager plugin (v3 channel management tools → independent Koishi plugin)
4. Multimodal image input (native VLM pass-through + external VLM description mode)
5. Environment enrichment (members, username/nickname, bot role, system events, reply chain)
6. Message element formatting (input parsing + output extension + injection prevention)

---

## Current Stack (DO NOT RE-ADD)

Already in `core/package.json` or workspace — verified from installed node_modules:

| Package                  | Installed Version | Role                                                                   |
| ------------------------ | ----------------- | ---------------------------------------------------------------------- |
| `ai`                     | 6.0.91            | ModelService, generateText/streamText, `ImagePart`/`UserContent` types |
| `koishi`                 | ^4.18.3           | Framework, `h` element API, Session, Bot                               |
| `zod`                    | ^3.25.76          | Schema validation                                                      |
| `mustache`               | ^4.2.0            | Prompt templating                                                      |
| `p-queue`                | ^5.0.0            | Concurrency control                                                    |
| `jsonrepair`             | ^3.13.2           | JSON repair fallback                                                   |
| `gray-matter`            | ^4.0.3            | Frontmatter parsing for Skill files                                    |
| `@ai-sdk/provider`       | ^3.0.8            | Provider abstraction                                                   |
| `@yesimbot/shared-model` | workspace:\*      | Shared types, AbstractProvider                                         |

---

## Feature 1: Skill-Driven Tool Architecture

### What changes

Core `PluginService` currently registers all tools as visible by default. The new model: only `send_message` is always-visible. All other tools are registered with `hidden: true` and surfaced only when a Skill's `toolFilter.include` names them explicitly.

### Stack decision: zero new packages

The `hidden` flag already exists on `FunctionDefinition` in `core/src/services/plugin/types.ts`:

```typescript
/** Hidden tools are excluded from getTools() unless explicitly included via skill toolFilter */
hidden?: boolean;
```

The `SkillEffect.toolFilter` with `include`/`exclude` arrays already exists in `core/src/services/skill/types.ts`. This is a **configuration change** to existing builtins, not a new library.

**Default search Skill tool** — needs a search API. Two options:

| Option     | Package                      | Version | Why                                                                                 |
| ---------- | ---------------------------- | ------- | ----------------------------------------------------------------------------------- |
| Tavily SDK | `tavily`                     | ^0.5.x  | Purpose-built for LLM agents; typed; ~5KB; structured results with relevance scores |
| Raw HTTP   | `ctx.http` (already present) | —       | Zero new dep; works against any search API (Brave, SerpApi, DuckDuckGo)             |

**Recommendation: use `ctx.http` directly** against a configurable search endpoint. Tavily SDK is a thin wrapper around a single HTTP call — the overhead of a new dep is not justified. The search Skill's config accepts an `apiKey` + `endpoint` pair, making it provider-agnostic.

**Confidence: HIGH** — `hidden` flag and `toolFilter` verified from source.

---

## Feature 2: Interactions Plugin

### What's needed

New package `plugins/interactions` — a Koishi sub-plugin that registers four tools via `PluginService`:

- `reaction_create` — emoji reaction on a message
- `essence_create` / `essence_delete` — set/remove essence message
- `send_poke` — poke/nudge a user
- `get_forward_msg` — fetch merged-forward message content

All four tools are OneBot-specific. The v3 reference (`references/YesImBot-v3/packages/core/src/services/extension/builtin/interactions.ts`) uses `session.onebot._request()` and `session.onebot.setEssenceMsg()`.

### Stack decision: peer dependency on adapter-onebot

| Package                        | Version   | Location                            | Purpose                                              |
| ------------------------------ | --------- | ----------------------------------- | ---------------------------------------------------- |
| `koishi-plugin-adapter-onebot` | peer ^4.x | `plugins/interactions/package.json` | OneBot-specific session methods (`session.onebot.*`) |

This is a **peer dependency** (user installs the adapter separately). The plugin declares it as `peerDependencies` with `optional: true`. Tools are gated behind an `activator`:

```typescript
activators: [
  {
    check: (ctx) => ctx.session?.platform === "onebot",
    reason: "OneBot platform required",
    onFail: "remove",
  },
];
```

For `get_forward_msg`, the v3 code uses `session.onebot.getForwardMsg(id)` which returns `ForwardMessage[]`. The type import is `import type { ForwardMessage } from 'koishi-plugin-adapter-onebot/lib/types'` — type-only, no runtime dep.

**No new runtime packages beyond the peer dep.**

**Confidence: HIGH** — v3 reference code verified, OneBot adapter pattern confirmed.

---

## Feature 3: QManager Plugin

### What's needed

New package `plugins/qmanager` — a Koishi sub-plugin registering three tools:

- `delmsg` — delete/recall a message (`bot.deleteMessage()`)
- `ban` — mute a guild member (`bot.muteGuildMember()`)
- `kick` — kick a guild member (`bot.kickGuildMember()`)

The v3 reference (`references/YesImBot-v3/packages/core/src/services/extension/builtin/qmanager.ts`) uses standard Koishi Bot API — no OneBot-specific calls. These methods are on the base `Bot` class.

### Stack decision: no new packages

`bot.deleteMessage()`, `bot.muteGuildMember()`, `bot.kickGuildMember()` are all standard Koishi Bot API methods available via the `koishi` peer dep already declared. No adapter-specific imports needed.

**Confidence: HIGH** — v3 reference uses only `session.bot.*` standard API.

---

## Feature 4: Multimodal Image Input

### What's needed

Two modes, configurable per-channel or globally:

- **Native mode**: pass `ImagePart` objects directly in the `messages` array to a VLM-capable model
- **External VLM mode**: call a separate VLM model to get a text description, inject as `[Image: <description>]`

### ai-sdk already supports native multimodal — no new packages

`ImagePart` is exported from `@ai-sdk/provider-utils` (confirmed in installed 6.0.91):

```typescript
// From node_modules/@ai-sdk/provider-utils/dist/index.d.ts, line 568
interface ImagePart {
  type: "image";
  image: DataContent | URL; // base64 Uint8Array, ArrayBuffer, Buffer, or URL
  mimeType?: string;
}

// line 969
type UserContent = string | Array<TextPart | ImagePart | FilePart>;
```

`UserModelMessage.content` is typed as `UserContent`, and `generateText`/`streamText` already accept `messages: ModelMessage[]`. Passing images requires **only a new code path in the message builder** — no library changes.

### Image download: ctx.http (already present)

Koishi's `ctx.http.file(url)` downloads a URL to a `{ data: ArrayBuffer, type: string }` response. This is already available via the `@koishijs/plugin-http` peer dep. No new HTTP library needed.

### Integration point: ThinkActLoop message builder

`ThinkActLoop` currently builds `userContent` as a plain `string` (line 198 in `loop.ts`). For native multimodal, this becomes `UserContent` (string | Array<TextPart | ImagePart>).

The `LoopMessage` type in `trimmer.ts` needs to accept `content: string | UserContent`. The `ModelService.call()` signature already accepts `Prompt` from `ai` which includes `messages: ModelMessage[]` — **no changes to ModelService**.

### Image processing pipeline

```
session.elements (h.parse)
  → find <img src="..."> elements
  → ctx.http.file(src) → ArrayBuffer + mimeType
  → mode switch (per config):
      native:   ImagePart { type: 'image', image: buffer, mimeType }
                → inject into UserContent array alongside TextPart
      external: modelService.call(vlmModel, {
                  messages: [{ role: 'user', content: [imagePart, { type: 'text', text: 'Describe this image.' }] }]
                }) → description string → TextPart "[Image: <desc>]"
```

**No new npm packages needed for either mode.**

**Confidence: HIGH** — `ImagePart`, `UserContent` types verified from installed node_modules.

---

## Feature 5: Environment Enrichment

### What's needed

- `Environment.members`: list of `{ userId, username, nickname, roles }` for guild members
- Distinguish `username` (account name) vs `nickname` (display name in guild)
- Bot's own role in the guild (admin/member/owner)
- System events: member join/leave/ban captured in Timeline
- Message reply chain: `replyTo` already in `MessageEventData` — needs population from `session.quote`

### Koishi Bot API — no new packages

All required APIs are already on the Koishi `Bot` class (verified from `@koishijs/core/lib/index.d.ts`):

| API                 | Method                                            | Notes                                                           |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| Guild member map    | `bot.getGuildMemberMap(guildId)` → `Dict<string>` | userId → nickname                                               |
| Guild member detail | `bot.getGuildMember(guildId, userId)`             | Full member object with roles                                   |
| System events       | `ctx.on('guild-member-added', ...)`               | Standard Koishi event                                           |
| System events       | `ctx.on('guild-member-removed', ...)`             | Standard Koishi event                                           |
| Reply chain         | `session.quote`                                   | Already on Session; `session.quote.id` is the quoted message ID |

`session.author.name` = username (account name), `session.author.nick` = nickname (guild display name). Both already read in `EventListener.recordUserMessage()` — the distinction just needs to be surfaced in `Entity.attributes`.

**No new npm packages needed.**

**Confidence: HIGH** — `bot.getGuildMemberMap` verified at line 775 of `@koishijs/core/lib/index.d.ts`; `session.quote` verified from `@satorijs/element` IntrinsicElements.

---

## Feature 6: Message Element Formatting

### What's needed

- **Input parsing**: convert `<at id>`, `<img>`, `<quote id>`, `<forward id>`, `<face>`, `<mface>` elements in incoming messages to structured text for LLM context
- **Output extension**: `send_message` handler parses `<at>`, `<quote>`, `<img>` tags from LLM output and renders them as real Koishi elements
- **Injection prevention**: escape user message content before it reaches the LLM prompt to prevent prompt injection via crafted messages

### Koishi `h` API — no new packages

`h.parse(content)` → `Element[]`, `h.transform()`, `h.transformAsync()` are the canonical Koishi element APIs. Confirmed in `@satorijs/element/lib/index.d.ts`:

```typescript
export function parse(source: string, context?: any): Element[];
export function transform<S = never>(
  source: Element[],
  rules: SyncVisitor<S>,
  ...rest: Rest<S>
): Element[];
export function transformAsync<S = never>(
  source: Element[],
  rules: AsyncVisitor<S>,
  ...rest: Rest<S>
): Promise<Element[]>;
```

Element types confirmed in `@satorijs/element` IntrinsicElements:

- `quote`: `{ id: string }` — reply reference
- `img` / `image`: `ResourceElement` — image with `src`
- `at`: `{ id: string, name?: string }` — user mention
- `audio`, `video`, `file`: `ResourceElement`

For injection prevention, a small utility function is sufficient — no library needed. The pattern is: strip or escape XML-like tags from user-provided text before it enters the LLM prompt string.

**No new npm packages needed.**

**Confidence: HIGH** — `h` API verified from installed `@satorijs/element` types.

---

## New Packages Summary

| Package                        | Version   | Location                       | Purpose                                          | Confidence |
| ------------------------------ | --------- | ------------------------------ | ------------------------------------------------ | ---------- |
| `koishi-plugin-adapter-onebot` | peer ^4.x | `plugins/interactions` peerDep | OneBot-specific session methods for social tools | HIGH       |

That's it. **One peer dependency** for the entire v2.5 milestone.

---

## Zero-New-Dep Features

| Feature                      | Existing Dep Used              | How                                                                     |
| ---------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| Native multimodal image      | `ai` 6.0.91                    | `ImagePart` in `UserContent[]` passed to `generateText`                 |
| External VLM description     | `ai` + existing `ModelService` | Separate `modelService.call()` with VLM model selector                  |
| Image download               | `koishi` (`ctx.http`)          | `ctx.http.file(url)` → ArrayBuffer → `ImagePart.image`                  |
| Message element parsing      | `koishi` (`h` API)             | `h.parse()` + `h.transform()`                                           |
| Output element rendering     | `koishi` (`h` API)             | `h()` element construction in `send_message` handler                    |
| Injection prevention         | none                           | Utility function: strip/escape XML tags from user text                  |
| Environment members          | `koishi` Bot API               | `bot.getGuildMemberMap()` + `bot.getGuildMember()`                      |
| Reply chain                  | `koishi` Session               | `session.quote.id` → `MessageEventData.replyTo`                         |
| System events                | `koishi` events                | `guild-member-added/removed` listeners in `EventListener`               |
| QManager tools               | `koishi` Bot API               | `bot.deleteMessage()`, `bot.muteGuildMember()`, `bot.kickGuildMember()` |
| Skill-driven tool visibility | existing `PluginService`       | `hidden: true` on `FunctionDefinition` + `toolFilter.include`           |
| Default search tool          | `ctx.http`                     | Raw HTTP against configurable search endpoint                           |

---

## New Package Structures

```
plugins/
  interactions/          # new — social interaction tools
    package.json         # peerDep: koishi, koishi-plugin-adapter-onebot
    src/index.ts
  qmanager/              # new — channel management tools
    package.json         # peerDep: koishi only
    src/index.ts
```

Both follow the existing `plugins/persona/` structure exactly.

---

## Alternatives Considered

| Recommended                             | Alternative                       | Why Not                                                                                                                                  |
| --------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Native `ImagePart` in ai-sdk            | Always-external VLM preprocessing | Native pass-through is zero-latency and preserves full fidelity for capable VLMs; external VLM is the fallback for non-multimodal models |
| `ctx.http.file()` for image download    | `undici` fetch (v3 used this)     | `ctx.http` is already injected by Koishi, respects proxy config, no extra dep                                                            |
| `h.parse()` + manual element walk       | `cheerio` or DOM parser           | `h` is the canonical Koishi element API; cheerio adds 200KB for no benefit                                                               |
| `koishi-plugin-adapter-onebot` peer dep | Bundling onebot types in plugin   | Peer dep is correct — adapter is user-installed, not bundled with the plugin                                                             |
| `ctx.http` for search                   | Tavily SDK                        | Tavily SDK is a thin wrapper around one HTTP call; `ctx.http` is already present and proxy-aware                                         |

---

## Installation

```bash
# No changes to core/package.json

# plugins/interactions — new package
# package.json peerDependencies:
#   "koishi": "^4.0.0"
#   "koishi-plugin-adapter-onebot": "^4.0.0"  (optional)

# plugins/qmanager — new package
# package.json peerDependencies:
#   "koishi": "^4.0.0"
```

---

## Sources

- `ai` 6.0.91 `ImagePart` type: verified from `node_modules/@ai-sdk/provider-utils/dist/index.d.ts` line 568
- `UserContent = string | Array<TextPart | ImagePart | FilePart>`: same file, line 969
- `bot.getGuildMemberMap()`: verified from `node_modules/@koishijs/core/lib/index.d.ts` line 775
- `h.parse()`, `h.transform()`, `h.transformAsync()`: verified from `node_modules/@satorijs/element/lib/index.d.ts`
- `session.quote` IntrinsicElement: verified from `node_modules/@satorijs/element/lib/index.d.ts` line 11
- `FunctionDefinition.hidden` field: `core/src/services/plugin/types.ts` line 41
- `SkillEffect.toolFilter`: `core/src/services/skill/types.ts`
- v3 OneBot usage (`session.onebot._request`, `session.onebot.setEssenceMsg`): `references/YesImBot-v3/packages/core/src/services/extension/builtin/interactions.ts`
- v3 QManager tools (standard Bot API only): `references/YesImBot-v3/packages/core/src/services/extension/builtin/qmanager.ts`
- v3 image/asset pipeline: `references/YesImBot-v3/packages/core/src/services/assets/service.ts`
- Existing `LoopMessage` / `ThinkActLoop` message builder: `core/src/services/agent/loop.ts` line 198
