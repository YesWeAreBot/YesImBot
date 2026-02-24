---
phase: 21-fixed-role-file-loading
verified: 2026-02-23T14:50:54Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 21: Fixed Role File Loading Verification Report

**Phase Goal:** Bot personality and behavior instructions are defined in SOUL.md/AGENTS.md/TOOLS.md files that replace legacy defaults, with template variable support and graceful fallback
**Verified:** 2026-02-23T14:50:54Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SOUL.md content is rendered with Mustache variables and injected at the soul injection point | VERIFIED | `service.ts:93` calls `this.prompt.inject(this.ctx, "soul", { name: "__role_soul", renderFn: ... })` with `Mustache.render` |
| 2 | AGENTS.md content is rendered with Mustache variables and injected at the instructions injection point | VERIFIED | `service.ts:102` calls `this.prompt.inject(this.ctx, "instructions", { name: "__role_agents", renderFn: ... })` |
| 3 | TOOLS.md is optional — present: injected at instructions point after AGENTS.md; absent: silently skipped | VERIFIED | `service.ts:109-118` checks `toolsContent !== null` before injecting; uses `after: "__role_agents"` |
| 4 | Missing role files on first launch are seeded from bundled defaults in core/resources/roles/ | VERIFIED | `service.ts:49-65` `ensureFiles()` copies from `builtinRolesDir` only when user file absent |
| 5 | Existing user files are never overwritten — only log a notice | VERIFIED | `service.ts:55-57` skips with `logger.debug('Role file %s already exists, skipping seed', name)` |
| 6 | Editing a role file on disk triggers hot-reload within 300ms debounce | VERIFIED | `service.ts:121-137` `startWatching()` uses `fs.watch` + `setTimeout(..., 300)` calling `loadAndInject()` |
| 7 | Mustache syntax errors in role files warn-log and retain last valid content | VERIFIED | `service.ts:75-84` `renderSafe()` catches errors, calls `logger.warn`, returns `lastValid.get(name) ?? content` |
| 8 | Skill style overrides reference __role_soul (not __default_soul) | VERIFIED | `loop.ts:80` has `after: "__role_soul"` |
| 9 | Bundled SOUL.md defines bot personality with Mustache variables and ## heading structure | VERIFIED | `SOUL.md` line 3: `{{bot.name}}`, `{{date.now}}`; headings: Identity, Personality, Communication Style, Boundaries |
| 10 | Bundled AGENTS.md defines behavioral instructions with ## heading structure | VERIFIED | `AGENTS.md` has `{{bot.name}}`; headings: Control Flow, Response Format, Inner Monologue, Group Chat Behavior, Memory Awareness |
| 11 | Bundled TOOLS.md defines tool usage guidance with ## heading structure | VERIFIED | `TOOLS.md` contains `send_message`, `actions`; headings: Tool Calling, Response Format, Tools vs Actions, Key Actions, Available Tools |
| 12 | TypeScript compiles cleanly | VERIFIED | `yarn typecheck` — 4/4 tasks successful |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `core/resources/roles/SOUL.md` | Default bot personality with `{{bot.name}}` | VERIFIED | Exists, substantive (4 sections), contains `{{bot.name}}` and `{{date.now}}` |
| `core/resources/roles/AGENTS.md` | Default behavioral instructions with `{{bot.name}}` | VERIFIED | Exists, substantive (5 sections), contains `{{bot.name}}` |
| `core/resources/roles/TOOLS.md` | Default tool usage guidance with `actions` | VERIFIED | Exists, substantive (5 sections), contains `send_message` and `actions` |
| `core/src/services/role/service.ts` | RoleService extending Service with file loading, Mustache rendering, hot-reload, injection | VERIFIED | `class RoleService extends Service<RoleServiceConfig>` with full lifecycle |
| `core/src/services/role/types.ts` | RoleServiceConfig interface | VERIFIED | Exports `RoleServiceConfig` and `RoleServiceConfigSchema` |
| `core/src/services/role/index.ts` | Barrel exports for role service module | VERIFIED | Exports `RoleService`, `RoleServiceConfig`, `RoleServiceConfigSchema` |
| `core/src/index.ts` | RoleService wired into plugin apply() | VERIFIED | Line 61: `ctx.plugin(RoleService, { rolePath: config.rolePath })` |
| `core/src/services/agent/loop.ts` | Style override references `__role_soul` | VERIFIED | Line 80: `after: "__role_soul"` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `core/src/services/role/service.ts` | `core/src/services/prompt/service.ts` | `prompt.inject(this.ctx, 'soul', ...)` and `prompt.inject(this.ctx, 'instructions', ...)` | WIRED | Lines 93, 102, 112 — three inject calls with renderFn |
| `core/src/index.ts` | `core/src/services/role/service.ts` | `ctx.plugin(RoleService, ...)` | WIRED | Line 61 — plugin registered with config; line 107 in waitForServiceReady |
| `core/src/services/agent/loop.ts` | `core/src/services/role/service.ts` | `after: '__role_soul'` ordering reference | WIRED | Line 80 — correct name used |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ROLE-01 | 21-02 | SOUL.md replaces default-identity.md + default-style.md, injected at soul point | SATISFIED | `service.ts:91-97` injects SOUL.md at `soul` point as `__role_soul` |
| ROLE-02 | 21-02 | AGENTS.md replaces default-control-flow.md + default-basic-functions.md, injected at instructions point | SATISFIED | `service.ts:99-106` injects AGENTS.md at `instructions` point |
| ROLE-03 | 21-02 | TOOLS.md optional, silently skipped if absent | SATISFIED | `service.ts:109-118` null-check before injecting TOOLS.md |
| ROLE-04 | 21-01 | Default prompt content rewritten referencing OpenClaw template style | SATISFIED | Three files in `core/resources/roles/` with natural tone, anti-sycophancy, letta-inspired control flow |
| ROLE-05 | 21-02 | Role files support Mustache template variables | SATISFIED | `renderSafe()` uses `Mustache.render(content, scope)`; files use `{{bot.name}}`, `{{date.now}}` |
| ROLE-06 | 21-02 | Graceful fallback when role files missing | SATISFIED | `service.ts:91,100` inline fallbacks `"You are {{bot.name}}."` / `"Respond helpfully."` on ENOENT |
| ROLE-07 | 21-02 | Hot-reload with fs.watch + debounce | SATISFIED | `startWatching()` uses `fs.watch` + 300ms `setTimeout` debounce |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `core/src/services/role/service.ts` | 71 | `return null` | Info | Intentional — `loadFile()` returns null on ENOENT to signal missing file; handled by callers |

No blockers or warnings found.

### Human Verification Required

#### 1. First-launch file seeding

**Test:** Delete `data/yesimbot/roles/` directory, start the bot, check that SOUL.md/AGENTS.md/TOOLS.md appear in that directory.
**Expected:** Three files seeded from `core/resources/roles/` bundled defaults.
**Why human:** Requires running the bot with a real Koishi instance.

#### 2. Hot-reload behavior

**Test:** Edit `data/yesimbot/roles/SOUL.md` while bot is running, wait 300ms, trigger a prompt render.
**Expected:** Updated content appears in the rendered prompt without restart.
**Why human:** Requires live bot instance and prompt inspection.

#### 3. Mustache error recovery

**Test:** Write malformed Mustache (`{{unclosed`) into SOUL.md while bot is running.
**Expected:** Warning logged, last valid content retained in rendered prompt.
**Why human:** Requires live bot instance and log inspection.

### Gaps Summary

No gaps. All 12 truths verified, all 7 requirements satisfied, TypeScript compiles cleanly.

---

_Verified: 2026-02-23T14:50:54Z_
_Verifier: Claude (gsd-verifier)_
