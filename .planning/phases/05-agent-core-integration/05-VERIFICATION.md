---
phase: 05-agent-core-integration
verified: 2026-02-18T00:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
human_verification:
  - test: "Send @mention message to bot in a guild channel"
    expected: "Bot receives message, runs think-act loop, sends reply via send_message tool"
    why_human: "Requires live Koishi runtime with a registered model provider to exercise full pipeline"
  - test: "Send message with <sep/> in content"
    expected: "Bot sends two separate messages, one per segment"
    why_human: "Requires live session to observe split delivery"
---

# Phase 5: Agent Core Integration Verification Report

**Phase Goal:** Orchestrate the complete agent loop from stimulus to response
**Verified:** 2026-02-18
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                         | Status     | Evidence                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AgentCore accepts Percept input and retrieves Observation from Horizon                        | ✓ VERIFIED | `service.ts` listens on `horizon/percept`, calls `loop.run(percept, config)` which calls `horizon.buildView(userPercept)`                      |
| 2   | Think-act loop executes: context build → LLM call → tool execution → response generation      | ✓ VERIFIED | `loop.ts` builds view, system prompt, context text, tools, then calls `modelService.call()`/`streamCall()` with tools and stopWhen             |
| 3   | Koishi plugin receives messages, creates Percepts, and sends agent responses back to platform | ✓ VERIFIED | `listener.ts` middleware records messages and emits `horizon/percept`; `send-message.ts` sends via `ctx.session.send()` or `bot.sendMessage()` |
| 4   | Agent can participate in basic conversation with @mention detection                           | ✓ VERIFIED | `listener.ts:87` checks `el.type === "at" && el.attrs?.id === session.selfId` → `triggerType = "mention"`                                      |
| 5   | AgentCore exists as Koishi Service at yesimbot.agent                                          | ✓ VERIFIED | `service.ts:13` — `class AgentCore extends Service<AgentCoreConfig>`, `super(ctx, "yesimbot.agent", false)`                                    |
| 6   | Tool adapter converts PluginService FunctionDefinitions to ai-sdk ToolSet                     | ✓ VERIFIED | `tools.ts:16-37` — `buildAiSdkTools` iterates `pluginService.getTools()`, wraps each with `inputSchema: jsonSchema(entry.function.parameters)` |
| 7   | Non-UserMessage percepts rejected before buildView()                                          | ✓ VERIFIED | `loop.ts:23-26` — `if (percept.type !== PerceptType.UserMessage)` logs warning and returns early                                               |
| 8   | AgentSummary recorded in Timeline after loop completes                                        | ✓ VERIFIED | `loop.ts:83-87` — `horizon.events.recordAgentSummary({ scope, timestamp, summary })` after steps complete                                      |
| 9   | AgentCore wired into core plugin with config schema                                           | ✓ VERIFIED | `index.ts:72-79` — `ctx.plugin(AgentCore, { provider: config.agentProvider, ... })` with all 6 schema fields                                   |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact                                                   | Expected                                  | Status     | Details                                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `plugins/core/src/services/agent/config.ts`                | AgentCoreConfig + AgentIdentity           | ✓ VERIFIED | Exports both interfaces; `AgentCoreConfig` has all 7 fields including `identity?: AgentIdentity`                              |
| `plugins/core/src/services/agent/tools.ts`                 | buildAiSdkTools + finishTool              | ✓ VERIFIED | Exports `buildAiSdkTools`, `finishTool`, `buildStopCondition`; uses ai-sdk v6 plain object Tool format                        |
| `plugins/core/src/services/agent/service.ts`               | AgentCore Service with queue              | ✓ VERIFIED | `class AgentCore extends Service<AgentCoreConfig>`, per-channel `Map<string, Promise<void>>` queue, `ThinkActLoop` delegation |
| `plugins/core/src/services/agent/loop.ts`                  | ThinkActLoop routing through ModelService | ✓ VERIFIED | `modelService.call()` / `modelService.streamCall()` called; type guard, timeout, summary recording all present                |
| `plugins/core/src/services/agent/index.ts`                 | Barrel exports                            | ✓ VERIFIED | Re-exports `AgentCore`, `AgentCoreConfig`, `AgentIdentity`                                                                    |
| `plugins/core/src/services/plugin/builtin/send-message.ts` | send_message with sep and target          | ✓ VERIFIED | `<sep/>` split at line 29-31; `target` parameter with `platform:channelId` parsing at lines 34-40                             |
| `plugins/core/src/index.ts`                                | AgentCore wired into apply()              | ✓ VERIFIED | `ctx.plugin(AgentCore, ...)` at line 72; all agent config fields in Schema                                                    |

### Key Link Verification

| From         | To                          | Via                                                 | Status  | Details                                                                                                                        |
| ------------ | --------------------------- | --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `loop.ts`    | `model/service.ts`          | `modelService.call()` / `modelService.streamCall()` | ✓ WIRED | Lines 63, 70 — both paths present; `as CallParams` cast passes tools/toolChoice/stopWhen through                               |
| `service.ts` | `loop.ts`                   | `ThinkActLoop.run()` in `runLoop()`                 | ✓ WIRED | `service.ts:58` — `await this.loop.run(percept, this.config)`                                                                  |
| `loop.ts`    | `horizon/manager.ts`        | `horizon.events.recordAgentSummary()`               | ✓ WIRED | `loop.ts:83` — called after steps complete                                                                                     |
| `index.ts`   | `services/agent/service.ts` | `ctx.plugin(AgentCore, config)`                     | ✓ WIRED | `index.ts:72` — `ctx.plugin(AgentCore, { provider: config.agentProvider, ... })`                                               |
| `service.ts` | `horizon/service.ts`        | `static inject` dependency                          | ✓ WIRED | `service.ts:14` — `static inject = ["yesimbot.horizon", ...]`                                                                  |
| `tools.ts`   | `plugin/service.ts`         | `pluginService.getTools()` → `jsonSchema()`         | ✓ WIRED | `tools.ts:22` — iterates `pluginService.getTools()`; `schemaToJSONSchema` called inside `getTools()` at `plugin/service.ts:84` |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                     | Status      | Evidence                                                                                                                                  |
| ----------- | ----------- | ------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AGENT-01    | 05-01-PLAN  | AgentCore as framework-agnostic orchestrator with AgentIdentity extension point | ✓ SATISFIED | `AgentCore extends Service`, `AgentIdentity` interface exported, `identity?: AgentIdentity` on config                                     |
| AGENT-03    | 05-02-PLAN  | Heartbeat loop: stimulus → context build → LLM → tool exec → respond            | ✓ SATISFIED | Full pipeline in `loop.ts`: percept → `buildView` → `prompt.render` → `modelService.call` → tools → `send_message` → `recordAgentSummary` |
| PLATFORM-01 | 05-02-PLAN  | Koishi integration — Service injection, lifecycle management                    | ✓ SATISFIED | `AgentCore extends Service`, `static inject` declares dependencies, `start()` lifecycle hook, `ctx.plugin(AgentCore)` in `apply()`        |

No orphaned requirements — all three IDs claimed in plan frontmatter are accounted for.

### Anti-Patterns Found

| File               | Line    | Pattern                                                                                                              | Severity   | Impact                                                                                                                                                                                                          |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loop.ts`          | 39-42   | `finishTool` added twice to `allTools` — once inside `buildAiSdkTools` (key `"finish"`) and once via explicit spread | ℹ️ Info    | Harmless — second assignment overwrites with identical value; no functional impact                                                                                                                              |
| `model/service.ts` | 108-133 | `streamCall` bypasses PQueue — not wrapped in `this.queue.add()`                                                     | ⚠️ Warning | When `config.streamMode = true`, concurrent stream calls are not rate-limited by PQueue. Plan claimed "preserving PQueue concurrency" for both paths. Functional for v1 since `streamMode` defaults to `false`. |

### Human Verification Required

### 1. Full Pipeline Smoke Test

**Test:** Configure a model provider, set `allowedChannels` to include a test channel, send an @mention message to the bot
**Expected:** Bot processes the message through the think-act loop and sends a reply
**Why human:** Requires live Koishi runtime with a registered model provider

### 2. `<sep/>` Message Splitting

**Test:** Trigger a response where the LLM calls `send_message` with content containing `<sep/>`
**Expected:** Two separate messages delivered to the channel, not one message with literal `<sep/>`
**Why human:** Requires live session to observe split delivery behavior

### Gaps Summary

No gaps. All automated checks pass. Two minor findings noted:

1. `finishTool` double-inclusion in `loop.ts` is redundant but harmless — the `"finish"` key is overwritten with the same object reference.
2. `streamCall` bypasses PQueue concurrency control. This is a pre-existing condition in `model/service.ts` (Phase 2 artifact), not introduced in Phase 5. The plan's claim of "preserving PQueue concurrency" is only fully true for the non-streaming path. Since `streamMode` defaults to `false`, this does not block v1 functionality.

---

_Verified: 2026-02-18_
_Verifier: Kiro (gsd-verifier)_
