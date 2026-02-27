---
phase: 29-runtime-bug-fixes
verified: 2026-02-26T13:37:42Z
status: passed
score: 3/3 success criteria verified
re_verification: false
---

# Phase 29: Runtime Bug Fixes — Verification Report

**Phase Goal:** Three known runtime defects are eliminated and the system behaves correctly under message bursts, silence, and long conversations
**Verified:** 2026-02-26T13:37:42Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| #   | Truth                                                                                                                                                                      | Status     | Evidence                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | When messages arrive while a response is in-flight, they are queued and merged into a single follow-up response rather than triggering separate responses or being dropped | ✓ VERIFIED | `pending = new Map<string, LoopPayload[]>()` (line 139); 5 array-push sites (lines 242-244, 286-288, 303-305, 323-325, 339-341); `mergeBacklog` defined (line 386) and called in drain (line 416) |
| 2   | When the LLM chooses silence, no empty `[Bot Action]` record appears in the timeline                                                                                       | ✓ VERIFIED | `actions.length === 0` guard (line 281) renders `[Bot]: (chose silence)` instead of `[Bot Action]: ` (line 282-283 in `horizon/service.ts`)                                                       |
| 3   | After many conversation rounds, working memory token count stays bounded — the initial user context block is trimmed like any other message                                | ✓ VERIFIED | `initialContextCharBudget` trim pass in `trimMessages` (trimmer.ts lines 42-56); wired through `loop.ts` line 208; schema field with default 20000 in `service.ts` lines 107-109                  |

**Score:** 3/3 success criteria verified

---

### Required Artifacts

| Artifact                               | Expected                                                              | Status     | Details                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `core/src/services/agent/service.ts`   | Array-based pending queue, mergeBacklog helper, updated enqueue drain | ✓ VERIFIED | `Map<string, LoopPayload[]>` at line 139; `mergeBacklog` at line 386; drain uses `backlog?.length` at line 414 |
| `core/src/services/horizon/service.ts` | Silence marker rendering in formatObservation                         | ✓ VERIFIED | `actions.length === 0` guard at line 281; returns `(chose silence)` at line 282                                |
| `core/src/services/agent/trimmer.ts`   | initialContextCharBudget trim pass for messages[0]                    | ✓ VERIFIED | Interface field at line 6; trim logic at lines 42-56 with head-trim-at-newline-boundary                        |
| `core/src/services/agent/loop.ts`      | TrimConfig wiring with initialContextCharBudget                       | ✓ VERIFIED | `initialContextCharBudget: this.config.initialContextCharBudget ?? 20000` at line 208                          |

---

### Key Link Verification

| From                                   | To                                | Via                                  | Status  | Details                                                                                             |
| -------------------------------------- | --------------------------------- | ------------------------------------ | ------- | --------------------------------------------------------------------------------------------------- |
| `service.ts handleEvent`               | `this.pending` array push         | `queues.has(channelKey)` guard       | ✓ WIRED | Lines 241-244: `get ?? []` → `push` → `set` pattern confirmed                                       |
| `service.ts enqueue drain`             | `mergeBacklog`                    | `backlog?.length` check              | ✓ WIRED | Lines 413-417: `pending.get` → `?.length` guard → `mergeBacklog` → `enqueue`                        |
| `service.ts AgentCoreConfigSchema`     | `loop.ts TrimConfig` construction | `config.initialContextCharBudget`    | ✓ WIRED | Schema field at service.ts:107; consumed at loop.ts:208                                             |
| `loop.ts TrimConfig`                   | `trimmer.ts trimMessages`         | `trimMessages(messages, trimConfig)` | ✓ WIRED | `trimMessages` called at loop.ts:223 and 343; `initialContextCharBudget` flows through `trimConfig` |
| `horizon/service.ts formatObservation` | timeline rendering                | `actions.length === 0` guard         | ✓ WIRED | Guard at line 281 fires before the fallback `[Bot Action]` render at line 284                       |

---

### Requirements Coverage

| Requirement | Source Plan   | Description                                               | Status      | Evidence                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------- | --------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-01      | 29-01-PLAN.md | 消息队列积压合并 — pending 改为数组，drain 合并为一次请求 | ✓ SATISFIED | Array queue type confirmed; 5 push sites confirmed; mergeBacklog confirmed; isBacklogDrain flag set                                                                                                                                                                                                                  |
| REQ-02      | 29-02-PLAN.md | Bot Action 空记录过滤 — LLM 沉默时不产生空 [Bot Action]   | ✓ SATISFIED | Silence guard in formatObservation confirmed; empty `[Bot Action]: ` string no longer reachable when actions is empty. Note: CONTEXT.md locked decision changed approach from "skip recordAgentResponse" to "renderer-level guard" — the observable outcome (no empty [Bot Action] in rendered timeline) is achieved |
| REQ-03      | 29-02-PLAN.md | Tool trim 修复 — messages[0] 受独立裁剪预算约束           | ✓ SATISFIED | initialContextCharBudget field in TrimConfig; head-trim pass with newline-boundary cut; messages.length > 1 guard prevents trimming when messages[0] is the only message                                                                                                                                             |

No orphaned requirements — all three REQ IDs declared in plans are accounted for, and REQUIREMENTS.md maps only REQ-01, REQ-02, REQ-03 to Phase 29.

---

### Anti-Patterns Found

| File         | Line | Pattern                                               | Severity | Impact                                                                                                    |
| ------------ | ---- | ----------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `trimmer.ts` | 28   | Empty catch block `catch {}` in `hardClearToolResult` | ℹ️ Info  | Pre-existing; not introduced by this phase. Silently swallows JSON parse errors. No impact on phase goal. |

No blockers or warnings introduced by this phase.

---

### Human Verification Required

None — all three fixes are structural code changes verifiable statically. The silence rendering and trim logic do not require visual or real-time testing to confirm correctness.

---

### Notes on REQ-02 Approach Divergence

The REQUIREMENTS.md acceptance criteria states "actions 为空时跳过 `recordAgentResponse` 调用". The CONTEXT.md locked decision explicitly overrode this: "不是'空 actions 不记录'，而是改变渲染方式 — timeline 照常记录完整的原始 response". The implementation follows CONTEXT.md. The `recordAgentResponse` call in `loop.ts` remains unconditional (lines 317-327), but `formatObservation` now renders empty-actions responses as `(chose silence)` rather than `[Bot Action]: `. The observable outcome from the ROADMAP.md success criterion — "no empty `[Bot Action]` record appears in the timeline" — is fully satisfied by the renderer fix.

---

## Summary

All three runtime defects are eliminated:

- REQ-01: The pending queue is now an array (`Map<string, LoopPayload[]>`). All 5 enqueue sites use the `get ?? [] → push → set` pattern. The drain merges accumulated payloads via `mergeBacklog` with `isBacklogDrain: true` flagging.
- REQ-02: `formatObservation` guards `actions.length === 0` before rendering, producing `(chose silence)` instead of an empty `[Bot Action]: ` line.
- REQ-03: `trimMessages` applies an independent head-trim pass to `messages[0]` when it exceeds `initialContextCharBudget` (default 20000 chars), wired end-to-end from schema → loop → trimmer.

Build was confirmed passing in both summaries (commits `a4e4101`, `7ad5c82`, `dab261d`).

---

_Verified: 2026-02-26T13:37:42Z_
_Verifier: Claude (gsd-verifier)_
