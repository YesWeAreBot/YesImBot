# Project Research Summary

**Project:** Athena (YesImBot v4) — v2.5 Multimodal & Rich Interaction
**Domain:** Koishi 4.x AI chatbot plugin — multimodal input, rich message elements, skill-driven tools, environment enrichment
**Researched:** 2026-02-27
**Confidence:** HIGH (all findings verified against v2.4 source code and installed node_modules)

---

## Executive Summary

Athena v2.5 is a focused capability expansion of an existing, production-quality Koishi AI chatbot plugin. The v2.4 baseline is architecturally sound — a layered service graph with clear dependency ordering, a Skill system with tool filtering already scaffolded, and an ai-sdk integration that already supports multimodal content types. The v2.5 work is not a rewrite; it is a series of targeted additions that fill well-defined gaps in the current message pipeline.

The recommended approach is to treat the six features as a dependency-ordered build sequence rather than parallel work. Message element formatting and environment enrichment are foundational — they modify the same core files (listener, horizon types, formatObservation) and must land first. Multimodal image input depends on the element formatter for image ID coordination. The Interactions and QManager plugins depend on the hidden-tool convention being established first. This ordering is not arbitrary: getting it wrong means double-touching the same files and introducing merge conflicts or regressions.

The dominant risk is security, not complexity. The current `formatObservation()` embeds user message content directly into XML-like `<msg>` tags without escaping — a prompt injection vector that becomes critical once rich element content flows through the pipeline. This must be addressed in Phase 1, before any other content enrichment lands. Secondary risks are operational: platform CDN image URLs expire (requiring eager download at receive time), GIF images are rejected by some LLM providers (requiring first-frame extraction), and the `LoopMessage` type assumes string content (requiring a type update before multimodal reaches the trimmer).

---

## Key Findings

### Recommended Stack

The v2.5 milestone requires **one new peer dependency**: `koishi-plugin-adapter-onebot` for the Interactions plugin's OneBot-specific APIs. Every other feature is implemented using packages already in the workspace.

**Core technologies (existing, confirmed):**

- `ai` 6.0.91 — `ImagePart` / `UserContent` types for native multimodal; no version change needed
- `koishi` ^4.18.3 — `h.parse()`, `h.transform()`, `session.quote`, `bot.getGuildMemberMap()`, `bot.getGuildMember()`
- `@ai-sdk/provider` ^3.0.8 — `ModelService.call()` already accepts `CoreMessage[]` with image parts; no changes needed
- `ctx.http` (Koishi built-in) — image download via `ctx.http.file(url)` → ArrayBuffer; proxy-aware; no new dep

**New dependency:**

- `koishi-plugin-adapter-onebot` peer ^4.x — optional peer dep in `plugins/interactions` only; type-only import for `ForwardMessage`

**Search tool:** Use `ctx.http` directly against a configurable endpoint. Tavily SDK is a thin wrapper around one HTTP call — the overhead is not justified.

### Expected Features

**Must have (table stakes):**

- Image perception — AI completely ignores images today; experience is broken when users send images
- Message element parsing (at/quote/image/face) — LLM currently sees raw `<at id="123"/>` XML, not `@Alice`
- Prompt injection escaping — users can forge admin messages via crafted `</msg>` content; critical security gap
- Environment member list — LLM has no knowledge of who is in the channel
- Bot's own role — LLM cannot determine if it has admin permissions; QManager tools are unusable without this
- Skill-driven tool loading — all tools globally visible today; ban/kick appear in every prompt regardless of context
- Rich text output from `send_message` — bot can only send plain text; no at-mentions, replies, or images

**Should have (differentiators):**

- Dual-mode image understanding (native VLM + external VLM description) — native is zero-latency; external covers non-vision models
- Message quote chain expansion — LLM cannot understand reply context without seeing quoted content
- Interactions plugin (reaction/essence/poke/forward) — social tools make the AI feel like a real group member
- QManager plugin (delmsg/ban/kick) — moderation capability for admin-role scenarios
- System event injection into Environment — member join/leave awareness
- username/nickname distinction — current `senderName` conflates account name and display name

**Defer to v2.6+:**

- External VLM mode (validate native mode first, add as config option later)
- System events (low value, adds listener complexity)
- Recursive quote chain expansion (basic `session.quote` inline first)
- AssetService (full image persistence — over-engineered for this milestone)
- Voice/video multimodal (explicitly out of scope per PROJECT.md)
- Google Lens / reverse image search (Puppeteer dependency, unrelated to core perception)

### Architecture Approach

The v2.4 service graph is a clean 5-layer dependency tree (ModelService/PluginService → PromptService/HorizonService → RoleService/TraitAnalyzer → SkillRegistry → AgentCore). The v2.5 additions do not change this graph structure. Two new external plugins (`interactions`, `qmanager`) follow the established `persona` plugin pattern — they inject into `PluginService` and `SkillRegistry` from outside the core dependency tree. Three new utility modules (`element-formatter.ts`, `image-extractor.ts`, `image-describer.ts`) are pure functions or thin services added within core.

**Major components (new or modified in v2.5):**

1. `ElementFormatter` (new) — pure function module; `formatElements()` + `sanitizeContent()`; called by EventListener
2. `ImageExtractor` (new) — extracts `ImageAttachment[]` from `session.elements`; shares image ID counter with ElementFormatter
3. `ImageDescriber` (new) — VLM description logic for external mode; called lazily in ThinkActLoop, not in listener
4. `InteractionsPlugin` (new package) — social tools (reaction/essence/poke/forward); all `hidden=true`; bundled Skill activates them
5. `QManagerPlugin` (new package) — moderation tools (delmsg/ban/kick); all `hidden=true`; requires `requireBotRole()` activator
6. `EventListener` (modified) — switches from `session.content` to `session.elements` as canonical source; populates `replyTo`; adds system event listeners
7. `HorizonService` (modified) — `getEntities()` enriched with userId/username/nickname; `formatObservation()` handles images; `formatHorizonText()` renders member list with userId
8. `ThinkActLoop` (modified) — native mode builds `UserContent[]` with `ImagePart`; `LoopMessage` type updated to `string | UserContent`

### Critical Pitfalls

1. **Prompt injection via unsanitized `<msg>` content** — `formatObservation()` embeds `obs.content` directly into XML tags with no escaping. Escape `<`, `>`, `&`, `"` in all user-provided text before DB storage. Must land in Phase 1 before any rich content flows through.

2. **`LoopMessage.content` typed as `string`** — trimmer does `Buffer.byteLength(msg.content)` which breaks when content is `Array<ImagePart | TextPart>`. Update `LoopMessage` to `content: string | UserContent` and guard the trimmer before multimodal reaches the loop.

3. **Platform CDN image URLs expire** — OneBot/QQ signed CDN links have 5–30 minute TTLs. Fetch and convert to base64 at message-receive time, not at LLM call time. The `native-url` mode requires a stable re-hosting endpoint.

4. **Plugin tool registration has no dispose hook** — `PluginService.register()` is a plain `Map.set()`. After hot-reload, stale handlers remain. External plugins must call `ctx["yesimbot.plugin"].unregister()` in `ctx.on("dispose", ...)`.

5. **Short message ID vs. platform message ID** — `<msg id="42">` uses the short working-memory ID, not the platform ID. `delmsg` always fails unless `platformId` is exposed as a separate attribute in the `<msg>` tag.

---

## Implications for Roadmap

Based on the dependency graph established in ARCHITECTURE.md, the natural phase structure is:

### Phase 1: Foundation — Element Formatting + Injection Prevention

**Rationale:** Touches `EventListener`, `horizon/types.ts`, and `formatObservation()` — the same files every other phase also touches. Landing this first avoids double-touching and establishes the sanitized content contract that all downstream features depend on. The prompt injection fix is a security requirement that must not be deferred.
**Delivers:** `element-formatter.ts` with `formatElements()` + `sanitizeContent()`; EventListener switches to `session.elements`; `<msg>` tags escape user content; `replyTo` populated from `session.quote`
**Addresses:** Table stakes — element parsing, injection prevention, basic quote chain
**Avoids:** Pitfall 1 (prompt injection), Pitfall 7 (session.content vs elements divergence), Pitfall 13 (quote double-counting)
**Research flag:** Standard patterns — no research phase needed.

### Phase 2: Environment Enrichment

**Rationale:** Enriches the entity/environment data model that QManager (Phase 4) depends on for userId resolution and bot role detection. Modifies overlapping files with Phase 1 — do sequentially after Phase 1 to avoid conflicts.
**Delivers:** `EntityRecord.attributes` gains `userId`/`username`/`nickname`; `formatHorizonText` renders member list with userId; bot role queried and cached in `Environment`; `percept.metadata.botRole` populated; `platformId` exposed in `<msg>` tags; system event listeners added
**Addresses:** Table stakes — member list, bot role; differentiator — username/nickname distinction
**Avoids:** Pitfall 5 (userId confusion for QManager), Pitfall 6 (short ID vs platform ID for delmsg), Pitfall 15 (bot role unknown)
**Research flag:** Standard patterns — Koishi Bot API verified from installed types.

### Phase 3: Skill-Driven Tool Loading

**Rationale:** Establishes the `hidden=true` contract that Interactions and QManager plugins depend on. A configuration-level change to existing builtins — low risk, high leverage.
**Delivers:** All builtin tools except `send_message` flipped to `hidden=true`; `SearchPlugin` stub with `ctx.http`; `default-tools.yaml` Skill; startup validation of Skill tool references; `[unavailable]` hint suppressed in production
**Addresses:** Table stakes — Skill-driven tool loading
**Avoids:** Pitfall 11 (noisy unavailable hints)
**Research flag:** Standard patterns — `hidden` flag and `toolFilter` already exist in source.

### Phase 4: Plugin Packages — Interactions + QManager

**Rationale:** Both depend on Phase 3 (hidden tools) and Phase 2 (botRole for QManager). Can be implemented in parallel with each other. Follow the `persona` plugin pattern exactly.
**Delivers:** `plugins/interactions/` with reaction/essence/poke/forward + bundled Skill; `plugins/qmanager/` with delmsg/ban/kick + `requireBotRole()` activator + bundled Skill; `@yesimbot/core` devDependency for typed coupling
**Addresses:** Differentiators — Interactions plugin, QManager plugin
**Avoids:** Pitfall 4 (dispose hook), Pitfall 8 (OneBot tools on wrong platform), Pitfall 12 (declare module drift)
**Research flag:** Standard patterns — v3 reference implementations are directly portable.

### Phase 5: Multimodal Image Input

**Rationale:** Depends on Phase 1 (element formatter for image ID coordination) and Phase 2 (enriched entities for @mention resolution). The `LoopMessage` type fix is a prerequisite that must land in this phase before image parts reach the trimmer.
**Delivers:** `image-extractor.ts`; `image-describer.ts` (VLM mode, lazy); `LoopMessage` type updated to `string | UserContent`; trimmer guarded for array content; `AgentCoreConfig` gains `imageMode` + `vlmModel`; eager base64 conversion at receive time; GIF first-frame extraction
**Addresses:** Table stakes — image perception; differentiator — dual-mode image understanding
**Avoids:** Pitfall 2 (LoopMessage type mismatch), Pitfall 3 (CDN URL expiry), Pitfall 9 (VLM blocking middleware), Pitfall 10 (GIF rejection), Pitfall 14 (large image size limits)
**Research flag:** Needs `/gsd:research-phase` — GIF processing library choice (jimp vs sharp vs canvas), image resize/compress strategy, per-provider image format constraints.

### Phase 6: Rich Output — send_message Extension

**Rationale:** Depends on Phase 2 (replyTo populated in DB so LLM has message IDs to reference). Low risk, self-contained change to a single file. Can slip to v2.6 if needed.
**Delivers:** `send_message` gains `reply_to` and `mention` params; handler builds `h()` element tree; Koishi XML passthrough for arbitrary elements
**Addresses:** Table stakes — rich text output
**Research flag:** Standard patterns — `session.send()` native XML support verified.

### Phase Ordering Rationale

- Phases 1–2 must precede everything else because they modify the shared data model (`MessageEventData`, `EntityRecord`, `horizon/types.ts`) and the shared rendering path (`formatObservation`, `formatHorizonText`). Doing them first means all subsequent phases build on a stable, sanitized foundation.
- Phase 3 must precede Phase 4 because the plugin packages are meaningless without the hidden-tool contract.
- Phase 5 must follow Phase 1 because `formatElements()` and `extractImages()` share an image ID counter — they must be implemented in strict sequence.
- Phase 6 is the most independent and lowest risk; it can slip to v2.6 without blocking anything else.

### Research Flags

Phases needing deeper research during planning:

- **Phase 5 (Multimodal):** GIF processing library choice, image resize/compress strategy, per-provider image format constraints (Anthropic rejects GIF, OpenAI has size limits). Recommend `/gsd:research-phase` before implementation.

Phases with standard patterns (skip research-phase):

- **Phase 1** — pure function escaping, well-understood
- **Phase 2** — Koishi Bot API verified from installed types
- **Phase 3** — existing `hidden` flag + `toolFilter` infrastructure
- **Phase 4** — v3 reference code is directly portable; activator pattern established
- **Phase 6** — `session.send()` XML passthrough verified

---

## Confidence Assessment

| Area         | Confidence | Notes                                                                                            |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| Stack        | HIGH       | All types verified from installed node_modules; one new peer dep confirmed                       |
| Features     | HIGH       | Sourced from v2.4 codebase gaps + v3 reference implementations + PROJECT.md milestone goals      |
| Architecture | HIGH       | All integration points verified against actual source files; touch points enumerated per feature |
| Pitfalls     | HIGH       | All pitfalls derived from direct source analysis; no inference-only findings                     |

**Overall confidence:** HIGH

### Gaps to Address

- **GIF processing library:** No decision made on jimp vs sharp vs canvas for first-frame extraction. Needs evaluation during Phase 5 planning — consider bundle size, Bun compatibility, and whether the dependency is worth it vs. simply rejecting GIFs with a user-facing message.
- **Search endpoint provider:** `SearchPlugin` uses `ctx.http` against a configurable endpoint, but no default provider is specified. Needs a decision (Brave Search API, SerpApi, Tavily HTTP, or DuckDuckGo) before Phase 3 implementation. This is config, not code — low risk to defer.
- **`native-url` image mode viability:** Platform CDN URL expiry makes `native-url` mode unreliable without a re-hosting endpoint. The `native-base64` mode is safe but increases payload size. The tradeoff needs a documented decision in Phase 5.
- **Skill condition schema for platform-aware activation:** Interactions plugin Skills should only activate on OneBot platforms. The current Skill condition schema (`match: { dimension, value }`) may not have a `platform` dimension. Needs verification during Phase 4 planning.

---

## Sources

### Primary (HIGH confidence — direct source analysis)

- `core/src/services/horizon/service.ts` — `formatObservation()`, `formatHorizonText()`, `getEntities()`
- `core/src/services/horizon/listener.ts` — `session.content` storage, element handling gaps
- `core/src/services/horizon/types.ts` — `MessageEventData`, `Entity`, `Environment` extension points
- `core/src/services/plugin/types.ts` — `FunctionDefinition.hidden`, `ToolExecutionContext`, `Activator`
- `core/src/services/plugin/service.ts` — `getTools()` hidden flag handling, `register()` lifecycle gap
- `core/src/services/plugin/activators.ts` — `requireSession()`, `requirePlatform()` patterns
- `core/src/services/skill/types.ts` — `SkillEffects.tools: ToolFilter`, `SkillDefinition.source`
- `core/src/services/agent/loop.ts` — `messages` construction, `buildToolSchemaForPrompt()` call
- `core/src/services/agent/trimmer.ts` — `LoopMessage` typed as `{ role: string; content: string }`
- `core/src/services/shared/types.ts` — `Percept.metadata` extension point
- `node_modules/@ai-sdk/provider-utils/dist/index.d.ts` — `ImagePart` (line 568), `UserContent` (line 969)
- `node_modules/@koishijs/core/lib/index.d.ts` — `bot.getGuildMemberMap()` (line 775)
- `node_modules/@satorijs/element/lib/index.d.ts` — `h.parse()`, `h.transform()`, `session.quote`

### Primary (HIGH confidence — reference implementations)

- `references/YesImBot-v3/packages/core/src/services/extension/builtin/interactions.ts` — v3 tool implementations
- `references/YesImBot-v3/packages/core/src/services/extension/builtin/qmanager.ts` — v3 tool implementations
- `references/YesImBot-v3/packages/core/src/services/assets/service.ts` — eager image download, GIF processing pattern
- `plugins/persona/src/index.ts` — reference pattern for independent plugin with `declare module`
- `.planning/PROJECT.md` — v2.5 milestone goals, out-of-scope constraints

---

_Research completed: 2026-02-27_
_Ready for roadmap: yes_
