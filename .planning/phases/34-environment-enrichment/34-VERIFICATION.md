---
phase: 34-environment-enrichment
verified: 2026-02-27T13:52:19Z
status: gaps_found
score: 3/4 success criteria verified
re_verification: false
gaps:
  - truth: "The <msg> tag in working memory exposes a platformId attribute so tools like delmsg can reference the real message ID"
    status: failed
    reason: "formatObservation() builds <msg> tags with id/sender/senderId/replyTo attributes but never adds platformId. The reverse short-ID map (lookupPlatformId) exists but is not used to populate the tag. The platform message ID is available as obs.messageId at render time but is not emitted."
    artifacts:
      - path: "core/src/services/horizon/service.ts"
        issue: "formatObservation() at line 309 builds attrs string without platformId. obs.messageId is in scope but unused in the tag."
    missing:
      - 'Add platformId attribute to <msg> tag in formatObservation(): append `platformId="${obs.messageId}"` to the attrs string alongside id/sender/senderId'
---

# Phase 34: Environment Enrichment Verification Report

**Phase Goal:** Enrich the working-memory environment so the LLM sees stable member identities, bot permissions, and can resolve short message IDs — enabling human-like awareness of who's in the channel and what the bot can do.
**Verified:** 2026-02-27T13:52:19Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria (from ROADMAP.md)

| #   | Truth                                                                                                                       | Status   | Evidence                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Each entity in HorizonView shows a stable `userId` (platform account ID) distinct from the display name                     | VERIFIED | `EntityRecord.userId: string` in types.ts:86; `getEntities()` maps `r.userId` in service.ts:235; `updateMemberInfo()` uses `session.userId` for entity ID and stores it as `userId` field in listener.ts:134,149                                                                                                                                                                       |
| 2   | The LLM can distinguish between a user's account name and their group nickname when they differ                             | VERIFIED | `EntityRecord` has `username: string` and `nickname?: string` in types.ts:87-88; listener.ts:135-136 extracts `username = session.event.user?.name ?? userId` and `nickname = session.author.nick ?? undefined`; nickname stored as `undefined` when equal to username (listener.ts:151); `formatHorizonText()` renders `nickname (username)` format when they differ (service.ts:370) |
| 3   | The LLM can determine whether it has admin/moderator permissions in the current channel                                     | VERIFIED | `SelfInfo.role?: "owner" \| "admin"` in types.ts:117; `getBotRole()` fetches via `session.bot.getGuildMember()` with 10-min TTL cache (service.ts:127-144); `buildView()` injects role into self (service.ts:156-161); `formatHorizonText()` renders `role="..."` on bot's `<member>` tag (service.ts:359)                                                                             |
| 4   | The `<msg>` tag in working memory exposes a `platformId` attribute so tools like `delmsg` can reference the real message ID | FAILED   | `formatObservation()` at service.ts:309 builds `attrs = id/sender/senderId/replyTo` — no `platformId`. `obs.messageId` (the platform ID) is in scope at line 300 but never added to the tag. `lookupPlatformId()` exists for reverse lookup but the forward direction (embedding platformId in the tag) was not implemented.                                                           |

**Score:** 3/4 success criteria verified

---

## Required Artifacts

| Artifact                                                  | Expected                                                                        | Status             | Details                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `core/src/services/horizon/types.ts`                      | EntityRecord with userId/username/nickname fields, SelfInfo with role           | VERIFIED           | Lines 82-93: EntityRecord has userId, username, nickname; lines 114-118: SelfInfo has role     |
| `core/src/services/horizon/service.ts`                    | Bot role cache, member tag rendering, reverse short-ID lookup, lookupPlatformId | VERIFIED (partial) | All listed items exist and are substantive. platformId on `<msg>` tag is missing (ENV-04 gap). |
| `core/src/services/horizon/listener.ts`                   | updateMemberInfo storing enriched entity data from correct session fields       | VERIFIED           | Lines 132-165: uses session.userId, session.event.user?.name, session.author.nick correctly    |
| `core/resources/templates/partials/horizon-view.mustache` | Triple-mustache for activeMembers                                               | VERIFIED           | Line 14: `{{{activeMembers}}}` — triple-mustache confirmed                                     |

---

## Key Link Verification

| From          | To                      | Via                                            | Status   | Details                                                                                        |
| ------------- | ----------------------- | ---------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `listener.ts` | `types.ts`              | EntityRecord fields used in upsert             | VERIFIED | listener.ts:144-161 upserts with userId, username, nickname matching EntityRecord shape        |
| `service.ts`  | `types.ts`              | SelfInfo.role populated by getBotRole()        | VERIFIED | service.ts:156-161: `role: botRole ?? undefined` assigned to SelfInfo                          |
| `service.ts`  | `horizon-view.mustache` | activeMembers variable rendered as member tags | VERIFIED | service.ts:422 passes `activeMembers` to Mustache scope; mustache line 14 renders it unescaped |

---

## Requirements Coverage

| Requirement | Source Plan   | Description                                                            | Status    | Evidence                                                                                                     |
| ----------- | ------------- | ---------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| ENV-01      | 34-01-PLAN.md | Entity 记录包含 `userId`（平台账号 ID）作为稳定标识                    | SATISFIED | EntityRecord.userId: string; listener uses session.userId for entity ID and field                            |
| ENV-02      | 34-01-PLAN.md | Entity 区分 `username`（账号名）和 `nickname`（群昵称/显示名）         | SATISFIED | Separate username/nickname fields; nickname dedup on write; nickname (username) display format               |
| ENV-03      | 34-02-PLAN.md | Bot 自身 role 信息可查询并注入 HorizonView，LLM 知道自己是否有管理权限 | SATISFIED | getBotRole() + SelfInfo.role + member tag rendering with role attribute                                      |
| ENV-04      | 34-02-PLAN.md | `<msg>` 标签中暴露 `platformId`，使 delmsg 等工具可引用真实消息 ID     | BLOCKED   | formatObservation() does not add platformId to <msg> tag; obs.messageId is available but unused in tag attrs |

---

## Anti-Patterns Found

| File                                   | Line | Pattern                                                | Severity | Impact                                                                               |
| -------------------------------------- | ---- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `core/src/services/horizon/service.ts` | 190  | Empty catch block `catch {}` in getOrCreateEnvironment | Info     | Silent failure on channel fetch — pre-existing pattern, not introduced by this phase |

No TODO/FIXME/placeholder comments found in phase-modified files. No stub implementations detected.

---

## Human Verification Required

None — all items are programmatically verifiable.

---

## Gaps Summary

One gap blocks full goal achievement. ENV-04 requires that `<msg>` tags in working memory carry a `platformId` attribute so future tools (Phase 37 `delmsg`) can reference the real platform message ID. The infrastructure is 90% there: `obs.messageId` holds the platform ID at render time, `lookupPlatformId()` provides the reverse map for tools, and the bidirectional short-ID map is correctly maintained with synced eviction. The single missing piece is adding `platformId="${obs.messageId}"` to the attrs string in `formatObservation()` at service.ts:309.

The fix is a one-line change. All other ENV-01/02/03 work is solid and correctly wired.

---

_Verified: 2026-02-27T13:52:19Z_
_Verifier: Claude (gsd-verifier)_
