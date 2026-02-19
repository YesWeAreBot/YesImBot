---
phase: 09-dynamic-schema-linkage
verified: 2026-02-20T08:00:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 9: Dynamic Schema Linkage Verification Report

**Phase Goal:** Provider-registered models appear as selectable dropdown options in the main plugin config UI
**Verified:** 2026-02-20T08:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | When a provider registers, its models appear in ctx.schema registry.chatModels | VERIFIED | `refreshSchemas()` called in `registerProvider()` at service.ts:63; iterates providers, calls `listModels()`, builds `Schema.union`, calls `ctx.schema.set("registry.chatModels", ...)` at line 53 |
| 2  | When a provider unregisters, its models are removed from registry.chatModels | VERIFIED | `refreshSchemas()` called in `unregisterProvider()` at service.ts:69; dispose hook at service.ts:60-62 auto-calls `unregisterProvider` on caller context dispose |
| 3  | Schema options use provider:model format as value | VERIFIED | service.ts:49 — `Schema.const(\`${name}:${modelId}\`)` |
| 4  | A custom free-text input option exists at the end of the union | VERIFIED | service.ts:52 — `Schema.string().description("Custom model (provider:model)")` appended last |
| 5  | Main plugin config UI shows model and fallbackModel as dynamic dropdowns | VERIFIED | index.ts:61-62 — `Schema.dynamic("registry.chatModels")` for both `model` and `fallbackModel`; `willingnessModel` also dynamic at line 67 |
| 6  | Selecting a model from the dropdown correctly wires it as the active model for the agent loop | VERIFIED | loop.ts:51 — `parseModelId(config.model)` splits provider:model; result used in `modelService.getModel(parsed.provider, parsed.model)` at line 60 |
| 7  | When provider is unloaded, config value is preserved and a log warning is emitted at runtime | VERIFIED | loop.ts:52-55 — if primary parse fails, warns "Primary model missing or invalid, trying fallback" and tries `config.fallbackModel`; willingness.ts:56-57 returns false gracefully if parse fails |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/shared-model/src/types/model.ts` | IModelProvider.listModels(), ModelInfo.description | VERIFIED | `listModels(): Record<string, ModelInfo>` at line 32; `description?: string` at line 25 |
| `plugins/core/src/services/model/service.ts` | refreshSchemas() calling ctx.schema.set | VERIFIED | `refreshSchemas()` at lines 44-54; called in constructor (line 41), registerProvider (line 63), unregisterProvider (line 69) |
| `plugins/core/src/index.ts` | model and fallbackModel fields using Schema.dynamic | VERIFIED | Lines 61-62 use `Schema.dynamic("registry.chatModels")`; willingnessModel at line 67 |
| `plugins/core/src/services/agent/loop.ts` | Parsing provider:model string via parseModelId | VERIFIED | Imports `parseModelId` from `@yesimbot/shared-model` at line 11; used at lines 51-54 |
| `packages/shared-model/src/utils/model-id.ts` | parseModelId() exported from shared-model | VERIFIED | Defined at lines 5-9; re-exported via `src/index.ts` line 3 |
| `plugins/core/src/services/agent/config.ts` | No provider/willingnessProvider fields; fallbackModel present | VERIFIED | AgentCoreConfig has `model?`, `fallbackModel?`, `willingnessModel?` — no separate provider fields |
| `plugins/core/src/services/agent/willingness.ts` | parseModelId on willingnessModel ?? model | VERIFIED | Lines 55-57 — `parseModelId(config.willingnessModel ?? config.model)` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `service.ts` | `ctx.schema.set` | `refreshSchemas()` called in register/unregister | WIRED | Line 53: `this.ctx.schema.set("registry.chatModels", Schema.union(options).default(""))` |
| `index.ts` | `registry.chatModels` | `Schema.dynamic('registry.chatModels')` | WIRED | Lines 61, 62, 67 — three fields all use `Schema.dynamic("registry.chatModels")` |
| `loop.ts` | `model/service.ts` | `parseModelId` splits provider:model, calls `modelService.getModel` | WIRED | Lines 51-60 — parse then `modelService.getModel(parsed.provider, parsed.model)` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MODEL-04 | 09-01, 09-02 | Provider 注册的模型自动出现在主插件配置下拉列表中 | SATISFIED | `refreshSchemas()` on register + `Schema.dynamic` in config UI |
| MODEL-05 | 09-01, 09-02 | Provider 热插拔时配置界面自动刷新可选模型列表 | SATISFIED | Dispose hook auto-unregisters + `refreshSchemas()` on unregister |

### Anti-Patterns Found

None.

### Human Verification Required

#### 1. Dropdown population in Koishi console UI

**Test:** Load the core plugin with a provider plugin (e.g. provider-openai) active. Open the Koishi console config panel for yesimbot-core.
**Expected:** The `model`, `fallbackModel`, and `willingnessModel` fields render as dropdowns listing `providerName:modelId` options from the registered provider, plus a free-text "Custom model" option.
**Why human:** `Schema.dynamic` rendering in the Koishi console UI cannot be verified programmatically — requires visual inspection of the config panel.

#### 2. Hot-reload schema refresh

**Test:** With the core plugin running, unload then reload a provider plugin. Check the config dropdown.
**Expected:** After unload, provider's models disappear from the dropdown. After reload, they reappear.
**Why human:** Runtime hot-reload behavior requires a live Koishi instance to observe.

### Gaps Summary

No gaps. All seven observable truths are verified against the actual codebase. Both requirement IDs (MODEL-04, MODEL-05) are fully satisfied by the implementation. Two items require human verification in a live Koishi environment but do not block goal achievement — the code wiring is complete and correct.

---

_Verified: 2026-02-20T08:00:00Z_
_Verifier: Claude (gsd-verifier)_
