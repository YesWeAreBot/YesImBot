# Technology Stack: v2.1 Polish & Release Prep

**Project:** Athena v2.1
**Researched:** 2026-02-23
**Confidence:** HIGH

## Scope

Stack additions/changes for v2.1 only. Existing stack (Koishi 4.18.x, ai-sdk 6.x, Turbo, Yarn 4, TypeScript 5.9, mustache 4.2, gray-matter 4.0, oxlint, pkgroll) is validated and unchanged.

## Key Finding: One New Dependency Group

Only vitest needs to be added. The memory_block refactor (SOUL.md/AGENTS.md/TOOLS.md), injection point merge (6→4), wrapper elimination, and robustness improvements all use the existing stack — gray-matter already handles frontmatter, mustache already handles templates, node:fs already handles file loading.

## New Dependencies

### Test Infrastructure

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| vitest | ^4.0.18 | Test runner | ESM-native, Vite-powered, zero-config for TypeScript; same version as openclaw reference project (verified on npm) |
| @vitest/coverage-v8 | ^4.0.18 | Coverage via V8 | Built-in V8 coverage, no instrumentation overhead; must match vitest version |

No `@vitest/ui` — not needed for CI-focused baseline coverage.

No `jsdom` or `happy-dom` — all services under test are Node.js only (no DOM).

### Why vitest over jest

Jest requires `ts-jest` or `babel-jest` transform config for ESM + TypeScript. This project uses `"type": "module"` and `moduleResolution: "bundler"` — vitest handles both natively with zero transform config. The existing turbo.json already has a `test` task defined.

## Existing Stack: What Covers Each v2.1 Feature

| v2.1 Feature | Covered By | Notes |
|---|---|---|
| SOUL.md/AGENTS.md/TOOLS.md fixed-role files | gray-matter 4.0.3 | Same frontmatter parsing already in MemoryService |
| Injection point merge 6→4 | Pure TypeScript | Types change in `types.ts`, no new lib |
| Wrapper partial elimination (XML tags in code) | Template literals | String concatenation, no lib needed |
| Tech debt fixes | Existing stack | Depends on specific debt items |
| Robustness (boundary/error handling) | Pure TypeScript | No utility lib needed |

## Installation

```bash
# In core/package.json devDependencies
yarn workspace koishi-plugin-yesimbot add -D vitest @vitest/coverage-v8
```

## Vitest Configuration Pattern

Per-package config at `core/vitest.config.ts` (not root-level — each workspace package owns its tests):

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    pool: "forks",          // avoids ESM module cache sharing between test files
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
    },
  },
});
```

`pool: "forks"` is required because Koishi services use module-level state; `vmThreads` (default) shares module cache across test files and causes cross-test pollution.

## Turbo Integration

The root `turbo.json` already defines a `test` task with `"outputs": []`. Each package just needs a `test` script:

```json
"scripts": {
  "test": "vitest run",
  "test:coverage": "vitest run --coverage"
}
```

## What Services Are Testable Without Koishi Mocks

The following are pure functions or classes with no Koishi `ctx` dependency — test directly:

| Module | Test approach |
|--------|--------------|
| `skill/condition.ts` — `evaluateCondition`, `specificity`, `filterByConfidence` | Pure functions, no mock needed |
| `prompt/renderer.ts` — `MustacheRenderer.parse`, `MustacheRenderer.render` | Class with no deps, instantiate directly |
| `memory/service.ts` — `parseFrontmatter` (private) | Extract to standalone util or test via integration |
| `skill/loader.ts` — `loadSkillsFromDir` | Needs `node:fs` — use `tmp` dir or `vi.mock("node:fs/promises")` |

For services that extend Koishi `Service`, test the pure logic extracted from them rather than mocking the full Koishi context. The `condition.ts` and `renderer.ts` modules are the highest-value test targets with zero mocking overhead.

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| vitest ^4.0.18 | jest | Jest needs transform config for ESM + `moduleResolution: bundler`; vitest is zero-config here |
| vitest ^4.0.18 | vitest ^3.x | v4 is current stable; openclaw reference uses 4.0.18; no reason to pin older |
| @vitest/coverage-v8 | @vitest/coverage-istanbul | V8 is built-in, no instrumentation; istanbul adds transform overhead |
| per-package vitest.config.ts | root-level vitest workspace config | Simpler; each package is independent; turbo handles orchestration |

## What NOT to Add

| Avoid | Why |
|-------|-----|
| `koishi-test-utils` or similar | Does not exist as a maintained package; mock Koishi ctx manually for the few tests that need it |
| `sinon` | vitest has `vi.fn()`, `vi.spyOn()`, `vi.mock()` built-in |
| `@testing-library/*` | No DOM/UI components in this package |
| `nock` / `msw` | No HTTP calls in the services under test (model calls go through ModelService, not tested at unit level) |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| vitest ^4.0.18 | vite ^6.0.0 or ^7.0.0 | vite is a peer dep of vitest; not installed directly — vitest bundles what it needs |
| vitest ^4.0.18 | @types/node ^22 | Already in root devDependencies |
| vitest ^4.0.18 | TypeScript ^5.9.3 | Already installed |

## Sources

- npm registry: `npm view vitest dist-tags` — confirmed 4.0.18 is latest stable (2026-02-23)
- npm registry: `npm view @vitest/coverage-v8 version` — confirmed 4.0.18
- `references/openclaw/vitest.config.ts` — pool:forks pattern, coverage thresholds, setupFiles pattern
- `references/openclaw/package.json` — vitest ^4.0.18, @vitest/coverage-v8 ^4.0.18
- Direct codebase analysis: `core/src/services/skill/condition.ts`, `prompt/renderer.ts` — confirmed pure function testability
- `turbo.json` — confirmed `test` task already defined

---
*Stack research for: Athena v2.1 Polish & Release Prep*
*Researched: 2026-02-23*
