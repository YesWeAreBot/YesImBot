# Technology Stack: v2.0 Context-Aware Architecture

**Project:** Athena v2.0
**Researched:** 2026-02-21

## Scope

Stack additions/changes for v2.0 Trait + Skill integration only. v1.0 stack (ai-sdk, Koishi 4.x, Turbo, Yarn, TypeScript, oxlint, pkgroll) is unchanged and not re-researched.

## Key Finding: Zero New Dependencies

All v2.0 features build on the existing dependency set. Mustache 4.2.0 handles template composition, js-yaml 4.1.1 parses skill manifests, node:fs handles file loading and watching.

## Existing Stack (Verified)

| Technology | Version | v2.0 Role | Confidence |
|------------|---------|-----------|------------|
| mustache | 4.2.0 | Section-based prompt composition via partials | HIGH |
| js-yaml | 4.1.1 | Skill manifest + trait config parsing | HIGH |
| koishi | 4.18.x | Service lifecycle, events, DI | HIGH |
| node:fs | builtin | Skill folder scanning, file watching | HIGH |
| ai | 6.0.91 | Unchanged — model calls | HIGH |

## New Components by Stack Layer

### TraitAnalyzer (Pure TypeScript)

No library dependencies. Rule-based heuristic detectors operating on HorizonView data:
- Scene detection: entity count, environment type (from existing HorizonView)
- Heat detection: message timestamps, frequency calculation (pure math)
- Topic detection: keyword regex matching (reuses willingness keyword infra)
- Relation detection: entity attributes lookup (from existing EntityRecord)

### SkillRegistry (js-yaml + node:fs)

Reuses MemoryService's proven file-loading pattern:
- `readdir` + `readFile` for skill folder scanning
- `js-yaml` for YAML manifest parsing (frontmatter pattern from MemoryService)
- `node:fs.watch` for hot-reload with debounce (same pattern as MemoryService)
- Condition evaluation via structured matching (dimension + values), no expression parser needed

### PromptService v2 (Mustache)

Programmatic section composition verified working:
```typescript
const template = activeSections
  .map(name => `{{> ${name}}}`)
  .join('\n\n');
Mustache.render(template, scope, partialsMap);
```

## Alternatives Considered

| Need | Recommended | Alternative | Why Not |
|------|-------------|-------------|---------|
| Template engine | Mustache 4.2.0 (keep) | Handlebars | Logic in templates is anti-pattern for prompts |
| Condition eval | Structured matching | `new Function()` | Structured matching is safer and sufficient for dimension/value pairs |
| File watching | `node:fs.watch` | chokidar 5.0.0 | Single directory sufficient; chokidar available if recursive needed |
| Event system | Koishi native | RxJS | Koishi events are lifecycle-aware, adding parallel system creates confusion |
| YAML parsing | js-yaml 4.1.1 (keep) | yaml 2.x | Already installed, sufficient for manifests |

## Sources

- Direct codebase analysis of installed packages and existing patterns
- Runtime-verified Mustache partial composition capabilities
- MemoryService file-loading pattern as proven reference implementation

---
*Stack research for: Athena v2.0 Context-Aware Architecture*
*Researched: 2026-02-21*
