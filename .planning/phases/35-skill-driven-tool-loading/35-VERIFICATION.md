---
phase: 35-skill-driven-tool-loading
verified: 2026-02-27T15:04:10Z
status: passed
score: 3/3 must-haves verified
re_verification: false
---

# Phase 35: Skill-Driven Tool Loading Verification Report

**Phase Goal:** Tools are hidden by default and only exposed to the LLM when an active Skill explicitly includes them
**Verified:** 2026-02-27T15:04:10Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                         | Status     | Evidence                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | In a channel with no active Skills, the LLM only sees `send_message` in its tool list — no other tools appear | ✓ VERIFIED | `getTools(includeHidden=false)` filters `fn.hidden && !includeHidden` at service.ts:105; all 4 non-send_message builtins have `hidden: true`; send_message has no hidden flag               |
| 2   | When a Skill with `effects.tools.include: [search]` activates, the search tool becomes visible to the LLM     | ✓ VERIFIED | `buildToolSchemaForPrompt()` in tools.ts:11-19 calls `getTools(toolCtx, true)` and unions hidden tools matching `toolFilter.include`; search SKILL.md has `effects.tools.include: [search]` |
| 3   | The search tool calls a configurable HTTP endpoint via `ctx.http` and returns results to the LLM              | ✓ VERIFIED | TavilyBackend.search() calls `this.ctx.http.post(endpoint, ...)` at tavily.ts:20; endpoint defaults to `https://api.tavily.com/search` but is configurable via `config.endpoint`            |

**Score:** 3/3 truths verified

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact                                           | Expected                                                  | Status     | Details                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `core/src/services/plugin/decorators.ts`           | `hidden?: boolean` in `DecoratorOpts` and `StaticEntry`   | ✓ VERIFIED | Line 17: `hidden?: boolean` in `DecoratorOpts`; `StaticEntry extends DecoratorOpts` inherits it |
| `core/src/services/plugin/base-plugin.ts`          | `hidden: entry.hidden` propagated to `FunctionDefinition` | ✓ VERIFIED | Lines 27 and 42: `hidden: entry.hidden` in both tools and actions loops                         |
| `core/src/services/plugin/builtin/demo.ts`         | `get_weather` and `web_search` marked `hidden: true`      | ✓ VERIFIED | Lines 25 and 48: both tools have `hidden: true`                                                 |
| `core/src/services/plugin/builtin/session-info.ts` | `get_session_info` marked `hidden: true`                  | ✓ VERIFIED | Line 19: `hidden: true`                                                                         |
| `core/src/services/plugin/builtin/onebot/index.ts` | `get_forward_msg` marked `hidden: true`                   | ✓ VERIFIED | Line 31: `hidden: true`                                                                         |

#### Plan 02 Artifacts

| Artifact                                                     | Expected                                                                       | Status     | Details                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `core/src/services/plugin/builtin/search/types.ts`           | Exports `SearchBackend`, `SearchResult`, `SearchOptions`, `SearchPluginConfig` | ✓ VERIFIED | All 4 interfaces exported; substantive (25 lines)                                                                    |
| `core/src/services/plugin/builtin/search/backends/tavily.ts` | `TavilyBackend` implementing `SearchBackend`                                   | ✓ VERIFIED | 44 lines; implements `search()` via `ctx.http.post`, `getParameterSchema()`, silent degradation on error/missing key |
| `core/src/services/plugin/builtin/search/index.ts`           | `SearchPlugin` with hidden `search` tool                                       | ✓ VERIFIED | 42 lines; `registerTool()` with `hidden: true`, formats results as numbered list                                     |
| `core/resources/skills/search/SKILL.md`                      | Skill definition with `effects.tools.include: [search]`                        | ✓ VERIFIED | YAML frontmatter present; `lifecycle: sticky`, `stickyTimeout: 2`, `conditions.match.dimension: intent`              |

---

### Key Link Verification

| From                     | To                   | Via                                                              | Status  | Details                                                                                                      |
| ------------------------ | -------------------- | ---------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `decorators.ts`          | `base-plugin.ts`     | `StaticEntry.hidden` propagated to `FunctionDefinition.hidden`   | ✓ WIRED | `hidden: entry.hidden` at base-plugin.ts:27 (tools) and :42 (actions)                                        |
| `base-plugin.ts`         | `service.ts`         | `getTools()` reads `fn.hidden` to filter                         | ✓ WIRED | `if (fn.hidden && !includeHidden) continue` at service.ts:105                                                |
| `service.ts`             | `search/index.ts`    | `PluginService` constructor registers `SearchPlugin`             | ✓ WIRED | `if (config.search) { this.register(new SearchPlugin(ctx, config.search)); }` at service.ts:46-48            |
| `search/index.ts`        | `backends/tavily.ts` | `SearchPlugin` creates `TavilyBackend` from config               | ✓ WIRED | `const backend: SearchBackend = new TavilyBackend(ctx, config)` at index.ts:15                               |
| `skills/search/SKILL.md` | `search/index.ts`    | Skill `effects.tools.include: [search]` un-hides the search tool | ✓ WIRED | SKILL.md line 13: `- search`; `buildToolSchemaForPrompt()` in tools.ts handles the union                     |
| `core/src/index.ts`      | `service.ts`         | Flat search config keys passed as `SearchPluginConfig`           | ✓ WIRED | `search: config.searchApiKey ? { provider, endpoint, apiKey, defaultLimit } : undefined` at index.ts:137-143 |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                | Status      | Evidence                                                                                                                                                                       |
| ----------- | ----------- | -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TOOL-01     | 35-01       | 除 `send_message` 外的内置工具默认标记为 `hidden: true`，仅通过 Skill 暴露 | ✓ SATISFIED | 4 tools marked `hidden: true` (get_weather, web_search, get_session_info, get_forward_msg); send_message has no hidden flag; `getTools()` filters by `fn.hidden`               |
| TOOL-02     | 35-02       | 搜索工具以 Skill 工具形式提供，通过 `ctx.http` 调用可配置搜索 API endpoint | ✓ SATISFIED | `TavilyBackend` calls `ctx.http.post(config.endpoint ?? "https://api.tavily.com/search", ...)`; endpoint is configurable via `searchEndpoint` config field                     |
| TOOL-03     | 35-01       | Skill 的 `effects.tools.include` 能正确取消 hidden 标记，使工具对 LLM 可见 | ✓ SATISFIED | `buildToolSchemaForPrompt()` in tools.ts:11-19 fetches all tools with `includeHidden=true` and unions those matching `toolFilter.include`; search SKILL.md uses this mechanism |

No orphaned requirements — all 3 IDs (TOOL-01, TOOL-02, TOOL-03) are claimed by plans and verified in code.

---

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments, no empty implementations, no `console.log` statements in any modified files.

---

### Human Verification Required

#### 1. End-to-end Skill activation flow

**Test:** Configure a Tavily API key, send a message that triggers `intent: search` trait detection, observe the tool list passed to the LLM
**Expected:** The `search` tool appears in the prompt tool list only when the search Skill is active; absent otherwise
**Why human:** Requires a running Koishi instance with trait analyzer active; can't verify the intent detection → Skill activation → tool visibility chain programmatically

#### 2. Tavily API response mapping

**Test:** Trigger a real search query; inspect the formatted result returned to the LLM
**Expected:** Numbered list with title, URL, and snippet per result; "No results found." on empty response
**Why human:** Requires a live Tavily API key and network access to verify actual response shape mapping

---

### Gaps Summary

No gaps. All 3 success criteria are met, all artifacts exist and are substantive, all key links are wired, all 3 requirements are satisfied, and TypeScript compiles cleanly (6/6 packages, full turbo cache hit).

The one design decision worth noting: `SearchPlugin` is only registered when `config.searchApiKey` is provided. If unconfigured, the search tool simply doesn't exist — the Skill's `effects.tools.include: [search]` will emit `[unavailable — tool not installed]` via the existing warning in `buildToolSchemaForPrompt()`. This is intentional per the plan.

---

_Verified: 2026-02-27T15:04:10Z_
_Verifier: Claude (gsd-verifier)_
