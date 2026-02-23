# Pitfalls Research

**Domain:** LLM agent plugin — injection point refactor, memory block restructure, Koishi plugin testing
**Researched:** 2026-02-23
**Confidence:** HIGH (based on direct codebase analysis)

## Critical Pitfalls

### Pitfall 1: Skill `point: "extra"` Hardcode Breaks Silently on Point Rename

**What goes wrong:**
`SkillRegistry.mergeEffects()` hardcodes `point: "extra"` (skill/service.ts line 139). `SkillEffect.promptInjections` carries `point: InjectionPoint`. When injection points are renamed (`identity`+`style` → `soul`, `control_flow`+`basic_functions` → `instructions`), skills that should target a renamed point silently route to a nonexistent point name, producing empty output with no error.

**Why it happens:**
The `point` field is typed as `InjectionPoint` but the value is a hardcoded string literal. TypeScript only catches this if the type is updated before the string — if the string is updated first, the old type still accepts it until the union narrows.

**How to avoid:**
Update `INJECTION_POINTS` and the `InjectionPoint` union in `prompt/types.ts` first. Let TypeScript errors guide all call sites — the hardcoded `"extra"` in `mergeEffects` will error immediately. Add a runtime guard in `PromptService.inject()`: throw (not warn) if `point` is not in `INJECTION_POINTS`.

**Warning signs:**
- Skill prompt injections produce no output after rename, but no log warnings appear.
- `SkillEffect.promptInjections` is non-empty but rendered sections contain no skill content.

**Phase to address:** Injection point rename — must be the first change, before memory block routing.

---

### Pitfall 2: `CACHEABLE_POINTS` Set Becomes Stale After Rename

**What goes wrong:**
`PromptService` has a module-level constant `CACHEABLE_POINTS = new Set<InjectionPoint>(["identity", "style", "control_flow", "memory"])`. After renaming to `soul`/`instructions`, the old names no longer match any active point. All `Section.cacheable` flags become `false`, breaking any upstream cache logic silently.

**Why it happens:**
`CACHEABLE_POINTS` is defined separately from `INJECTION_POINTS` with no cross-reference. Easy to update `INJECTION_POINTS` and forget this set. No TypeScript error because `Set<InjectionPoint>` accepts the new names — the old names just become dead entries.

**How to avoid:**
Update `CACHEABLE_POINTS` in the same commit as `INJECTION_POINTS`. Consider deriving cacheability from the point declaration rather than a separate set.

**Warning signs:**
- All `Section.cacheable` values are `false` after rename.

**Phase to address:** Injection point rename — update atomically with `INJECTION_POINTS`.

---

### Pitfall 3: Wrapper Partial Deletion Leaves Orphaned `{{> name }}` References

**What goes wrong:**
`system.mustache` references partials by name (`{{> identity }}`, `{{> style }}`, etc.). If wrapper partials are deleted but `system.mustache` still references them, Mustache silently renders them as empty string — no error, no warning. The rendered prompt loses those sections entirely.

**Why it happens:**
Mustache partial resolution is silent-fail by design. `MustacheRenderer` passes `allPartials` as the third argument to `Mustache.render()`, so a missing key produces empty output.

**How to avoid:**
When eliminating a wrapper partial, update `system.mustache` in the same commit. Never delete a partial file without grepping for all `{{> name }}` references first.

**Warning signs:**
- Rendered system prompt is shorter than expected.
- A section that previously appeared (e.g., `<identity>...</identity>`) is absent from LLM input.
- No error in logs.

**Phase to address:** Wrapper partial elimination — treat `system.mustache` and its referenced partials as an atomic unit.

---

### Pitfall 4: `partialMap` in Constructor Registers Stale Partial Names After Rename

**What goes wrong:**
The `partialMap` in `PromptService` constructor (lines 58–70) maps partial names to filenames and loads them at construction time. After renaming injection points, old partial files (`identity.mustache`, `style.mustache`, etc.) still exist on disk and are still registered under old names. New point names (`soul`, `instructions`) have no corresponding partial files, so `render()` falls through to the raw `${point}_content` path — which works, but loses any XML wrapper the partial was providing.

**Why it happens:**
Partial registration and the injection point list are maintained separately. Adding a new point name to `INJECTION_POINTS` does not automatically create a partial for it.

**How to avoid:**
For each new injection point, decide explicitly: does it need a wrapper partial or does injection content include its own XML tags? Remove old partial files and their `partialMap` entries together with the rename.

**Warning signs:**
- New injection point content appears without XML wrapper tags in the rendered prompt.
- Old partial files still exist in `resources/templates/partials/` after rename.

**Phase to address:** Injection point rename — audit `partialMap` entries against new point names before merging.

---

### Pitfall 5: Memory Block Routing Produces Double-Injection When Entry Names Collide

**What goes wrong:**
The new design routes memory blocks to different injection points based on label/filename (e.g., `SOUL.md` → `soul` point, `AGENTS.md` → `instructions` point). If the refactor registers multiple entries and two blocks produce the same derived entry name, the duplicate-name guard in `PromptService.inject()` silently drops the second one.

**Why it happens:**
`PromptService.inject()` checks `list.some((e) => e.name === entry.name)` and returns early with a warn log. If two blocks route to the same point with the same derived name, the second is silently dropped.

**How to avoid:**
Use unique entry names per block: `"memory-block:${filename}"` rather than a shared prefix. Verify no two blocks produce the same entry name during `loadBlocks()`.

**Warning signs:**
- Log line: `Duplicate injection "..." in point "...", ignoring` during startup.
- Memory directory has two files that both resolve to the same label/point combination.

**Phase to address:** Memory block routing — name generation must be deterministic and unique per file.

---

### Pitfall 6: Koishi Service `static inject` Causes Silent Plugin Non-Load in Tests

**What goes wrong:**
`MemoryService` declares `static inject = ["yesimbot.prompt"]` and `SkillRegistry` declares `static inject = ["yesimbot.trait"]`. In vitest tests, if the required service is not provided before the plugin under test is loaded, Koishi silently defers plugin initialization — `start()` is never called, no error is thrown, and assertions against service state pass vacuously (empty/undefined).

**Why it happens:**
Koishi's dependency injection is designed for graceful degradation in production. In tests, a missing mock service causes the plugin to never initialize, but the test runner doesn't know to fail.

**How to avoid:**
In every test that exercises a service with `static inject`, provide all required services as mocks before loading the plugin under test. Add an assertion that the service instance exists before testing its behavior: `expect(app['yesimbot.memory']).toBeDefined()`.

**Warning signs:**
- Tests pass but service methods are never called (verify with `vi.spyOn`).
- `start()` is never invoked.
- Service state (e.g., `blocks` array) remains at initial empty value despite test setup.

**Phase to address:** Vitest infrastructure — establish mock service patterns before writing any service tests.

---

### Pitfall 7: `trait-bound` Lifecycle Declared But Not Implemented

**What goes wrong:**
`LifecycleStrategy` in `skill/types.ts` includes `"trait-bound"` as a valid value, but `SkillRegistry.resolve()` only handles `"sticky"` explicitly. A skill with `lifecycle: "trait-bound"` falls through to the default path (treated as `per-turn`), silently ignoring the intended behavior.

**Why it happens:**
The type was defined speculatively but implementation was deferred. No runtime error occurs because the fallthrough is valid TypeScript.

**How to avoid:**
Either implement `trait-bound` semantics or remove it from the `LifecycleStrategy` union until implemented. A `switch` with an exhaustive check (`default: satisfies never`) would catch this at compile time.

**Warning signs:**
- Skill with `lifecycle: "trait-bound"` deactivates every turn even when the triggering trait persists.
- No error in logs.

**Phase to address:** Tech debt fix — resolve before adding new skills that might use this lifecycle.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode `point: "extra"` in `mergeEffects` | Simple, no config needed | Breaks silently on point rename | Never |
| Separate `CACHEABLE_POINTS` from `INJECTION_POINTS` | Easy to read | Diverges silently on rename | Never |
| Register all partials from disk at constructor time | Simple boot | Stale partials survive rename with no validation | Acceptable if existence is validated at boot |
| `trait-bound` in type but not implemented | Type completeness | Silent wrong behavior | Never ship unimplemented type variants |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `MemoryService` → `PromptService` | Call prompt methods in constructor before service is ready | Store reference in constructor (safe due to `static inject`), call methods only in `start()` |
| `SkillRegistry` → `PromptService` | Call `prompt.inject()` directly from skill resolve path | Pass `SkillEffect` back to caller (agent); agent calls `prompt.inject()` |
| `gray-matter` frontmatter | Assume `data` keys are always strings | `data` values are typed `any`; cast explicitly or validate before use |
| Mustache partial resolution | Assume missing partial throws | Mustache silently renders missing partials as empty string — validate partial existence at boot |

---

## "Looks Done But Isn't" Checklist

- [ ] **Injection point rename:** Old names removed from `INJECTION_POINTS`, `CACHEABLE_POINTS`, `partialMap`, and all `inject()` call sites — verify with grep for old names.
- [ ] **Memory block routing:** Each file routes to exactly one injection point — verify no "Duplicate injection" warnings at startup.
- [ ] **Wrapper partial elimination:** No `{{> old_partial_name }}` references remain in any `.mustache` file — verify with grep.
- [ ] **Skill point hardcode fixed:** `mergeEffects` no longer hardcodes `"extra"` — verify via `SkillEffect.promptInjections[].point` in a test.
- [ ] **`trait-bound` lifecycle:** Either implemented or removed from the union — verify no skill file uses it without implementation.
- [ ] **Vitest mock services:** Every service test provides all `static inject` dependencies before `app.start()` — verify by asserting service instance is defined.
- [ ] **Default file seeding:** After renaming from `persona.md` to `SOUL.md`/`AGENTS.md`/`TOOLS.md`, the `cpSync` target filename in `loadBlocks()` matches the new convention.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Skill injections silently dropped after point rename | LOW | Add runtime validation in `PromptService.inject()`, re-run, check logs |
| Wrapper partial deleted but still referenced | LOW | Restore partial file or update `system.mustache` — no data loss |
| Memory blocks double-injected | LOW | Rename injection entries to be unique per file, reload |
| `CACHEABLE_POINTS` stale | LOW | Update set with new point names, rebuild |
| Vitest tests passing vacuously | MEDIUM | Add `expect(service).toBeDefined()` guards, re-run to surface actual failures |
| `trait-bound` wrong behavior in production | MEDIUM | Implement or remove from type; correct lifecycle field in affected skill files |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Skill `point: "extra"` hardcode | Injection point rename | TypeScript error after type update; grep for string literal `"extra"` in skill service |
| `CACHEABLE_POINTS` stale | Injection point rename | Assert `section.cacheable === true` for soul/instructions sections in render test |
| Memory block double-injection | Memory block routing | No "Duplicate injection" warnings at startup; block count matches file count |
| Wrapper partial orphaned reference | Wrapper partial elimination | Grep `{{>` in all `.mustache` files; assert no reference to deleted partial names |
| `partialMap` stale entries | Injection point rename | Validate all `partialMap` keys exist as files at boot |
| Koishi service silent non-load in tests | Vitest infrastructure | `expect(app['service-name']).toBeDefined()` in every service test |
| `trait-bound` unimplemented | Tech debt fix | Exhaustive switch or remove from union |

---

## Sources

- Direct analysis: `core/src/services/prompt/service.ts` (CACHEABLE_POINTS, partialMap, inject guard)
- Direct analysis: `core/src/services/prompt/types.ts` (InjectionPoint union, INJECTION_POINTS array)
- Direct analysis: `core/src/services/skill/service.ts` (hardcoded `point: "extra"`, lifecycle handling)
- Direct analysis: `core/src/services/skill/types.ts` (LifecycleStrategy union with unimplemented `trait-bound`)
- Direct analysis: `core/src/services/memory/service.ts` (injection registration, block loading)
- Direct analysis: `core/resources/templates/system.mustache` and `partials/*.mustache`
- Project context: `.planning/PROJECT.md` (v2.1 milestone goals)

---
*Pitfalls research for: Athena v2.1 — injection point refactor, memory block restructure, Koishi vitest*
*Researched: 2026-02-23*
