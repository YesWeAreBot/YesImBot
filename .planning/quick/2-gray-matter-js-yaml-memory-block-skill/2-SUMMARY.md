---
phase: quick
plan: 2
subsystem: core
tags: [refactor, dependencies, frontmatter]
key-files:
  created: []
  modified:
    - core/package.json
    - core/src/services/memory/service.ts
    - core/src/services/skill/loader.ts
decisions:
  - Use gray-matter as sole frontmatter parser, replacing js-yaml + custom regex
metrics:
  duration: 115s
  completed: 2026-02-23
---

# Quick Task 2: Replace js-yaml with gray-matter for frontmatter parsing

Replaced custom regex + js-yaml frontmatter parsing with gray-matter in both memory service and skill loader, eliminating duplicated parsing logic.

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Swap js-yaml for gray-matter in package.json | 86079e7 | Removed js-yaml + @types/js-yaml, added gray-matter ^4.0.3 |
| 2 | Replace parseFrontmatter in memory and skill | bc8184a | Both use `matter(raw)` instead of regex + yamlLoad |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. `grep -r "js-yaml" core/` - no matches (fully removed)
2. `grep -r "gray-matter" core/src/` - shows memory/service.ts and skill/loader.ts
3. `yarn build` - passes (4/4 tasks, typecheck included)
4. No custom frontmatter regex remains in either file

## Self-Check: PASSED

All commits verified (86079e7, bc8184a). All modified files exist on disk.
