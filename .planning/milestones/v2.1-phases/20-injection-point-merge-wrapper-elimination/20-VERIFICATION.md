---
phase: 20-injection-point-merge-wrapper-elimination
verified: 2026-02-23T12:38:13Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 20: Injection Point Merge & Wrapper Elimination Verification Report

**Phase Goal:** Prompt system uses 4 clean injection points (soul/instructions/memory/extra) with inline XML tag generation, no wrapper partials
**Verified:** 2026-02-23T12:38:13Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | InjectionPoint type is `soul \| instructions \| memory \| extra` | ✓ VERIFIED | `types.ts` line 1: exact union type |
| 2 | inject() throws Error on unrecognized injection point names | ✓ VERIFIED | `service.ts` line 91: `throw new Error(\`Unrecognized injection point: "${point}"\`)` |
| 3 | All 4 points cacheable (CACHEABLE_POINTS intent) | ✓ VERIFIED | `service.ts` line 136: `cacheable: true` inlined in render() for every point; CACHEABLE_POINTS constant removed as unnecessary after render() rewrite |
| 4 | loop.ts injects into `soul` and `instructions` instead of old names | ✓ VERIFIED | `loop.ts` line 78: `"soul"`, line 93: `"instructions"` |
| 5 | render() generates XML tags inline — no Mustache partials for prompt structure | ✓ VERIFIED | `service.ts` lines 132-137: `\`<${point}>\n${content}\n</${point}>\`` |
| 6 | system.mustache does not exist — render() assembles full prompt in code | ✓ VERIFIED | `ls core/resources/templates/` shows only `core-memory.mustache` and `default-persona.md` |
| 7 | No wrapper .mustache partials exist (only memory-block and horizon-view remain) | ✓ VERIFIED | `ls core/resources/templates/partials/` shows only `horizon-view.mustache` and `memory-block.mustache` |
| 8 | Empty injection points still emit their tags | ✓ VERIFIED | `service.ts` lines 132-137: tag always pushed regardless of `fragments` length |
| 9 | render() outputs injection points in fixed order: soul → instructions → memory → extra | ✓ VERIFIED | `service.ts` line 118: `for (const point of INJECTION_POINTS)` — INJECTION_POINTS is `["soul","instructions","memory","extra"]` |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `core/src/services/prompt/types.ts` | New InjectionPoint type and INJECTION_POINTS array | ✓ VERIFIED | Lines 1-3: exact 4-point union and array |
| `core/src/services/prompt/service.ts` | Rewritten render() with inline XML, runtime guard in inject() | ✓ VERIFIED | Lines 88-104 (guard), 113-141 (render) |
| `core/src/services/agent/loop.ts` | Migrated call sites to soul/instructions | ✓ VERIFIED | Lines 78, 93 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `types.ts` | `service.ts` | INJECTION_POINTS import | ✓ WIRED | `service.ts` line 8: `import { INJECTION_POINTS } from "./types"` |
| `service.ts` | `loop.ts` | inject() calls with new point names | ✓ WIRED | `loop.ts` lines 78, 93: `prompt.inject(this.ctx, "soul", ...)` and `prompt.inject(this.ctx, "instructions", ...)` |
| `service.ts` | `renderer.ts` | MustacheRenderer still used for snippet interpolation | ✓ WIRED | `service.ts` line 6: `import { MustacheRenderer }`, line 33: `private renderer = new MustacheRenderer()` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PROMPT-01 | 20-01 | 注入点从 6 个合并为 4 个 (identity+style→soul, control_flow+basic_functions→instructions) | ✓ SATISFIED | `types.ts` line 1: `"soul" \| "instructions" \| "memory" \| "extra"` |
| PROMPT-02 | 20-02 | 消除 5 个 wrapper partials，render() 代码内生成 XML 标签 | ✓ SATISFIED | 6 wrapper partials deleted; `service.ts` lines 132-137 generate XML inline |
| PROMPT-03 | 20-02 | system.mustache 模板适配新的 4 注入点结构 | ✓ SATISFIED | RESEARCH.md confirms intent = delete system.mustache entirely; confirmed absent from disk |
| PROMPT-04 | 20-01 | CACHEABLE_POINTS 与 InjectionPoint 类型同步更新 | ✓ SATISFIED | CACHEABLE_POINTS constant removed; render() inlines `cacheable: true` for all 4 points unconditionally — semantically equivalent, no sync drift possible |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODOs, placeholders, empty implementations, or stub patterns found in modified files.

### Human Verification Required

None — all behaviors are verifiable programmatically.

### Gaps Summary

No gaps. All 9 observable truths verified against actual codebase. TypeScript compilation succeeds with zero errors. All 11 obsolete files deleted. Only 4 resource files remain. Old injection point names (`identity`, `style`, `control_flow`, `basic_functions`) absent from all `.ts` source files.

Note on CACHEABLE_POINTS: Plan 01 must-have specified a derived constant `new Set<InjectionPoint>(INJECTION_POINTS)`. The implementation instead removed the constant entirely and inlines `cacheable: true` directly in render(). This is a better outcome — the constant was only needed when render() used a template-based filter; with unconditional evaluation the constant is dead code. The requirement intent (all 4 points cacheable, no sync drift) is fully satisfied.

---

_Verified: 2026-02-23T12:38:13Z_
_Verifier: Claude (gsd-verifier)_
