---
phase: quick
plan: 2
type: execute
wave: 1
depends_on: []
files_modified:
  - core/package.json
  - core/src/services/memory/service.ts
  - core/src/services/skill/loader.ts
autonomous: true
requirements: [QUICK-2]

must_haves:
  truths:
    - "Memory blocks parse frontmatter identically to before (label, title, description, content)"
    - "Skills parse frontmatter identically to before (meta fields + markdown content)"
    - "js-yaml is fully removed from dependencies"
    - "gray-matter is the sole frontmatter parser"
    - "Build and typecheck pass with no errors"
  artifacts:
    - path: "core/src/services/memory/service.ts"
      provides: "Memory frontmatter parsing via gray-matter"
      contains: "gray-matter"
    - path: "core/src/services/skill/loader.ts"
      provides: "Skill frontmatter parsing via gray-matter"
      contains: "gray-matter"
    - path: "core/package.json"
      provides: "gray-matter dependency, no js-yaml"
  key_links:
    - from: "core/src/services/memory/service.ts"
      to: "gray-matter"
      via: "import matter from 'gray-matter'"
      pattern: "matter\\("
    - from: "core/src/services/skill/loader.ts"
      to: "gray-matter"
      via: "import matter from 'gray-matter'"
      pattern: "matter\\("
---

<objective>
Replace js-yaml + custom regex frontmatter parsing with gray-matter in both memory and skill modules.

Purpose: Eliminate duplicated custom frontmatter parsing logic and use a battle-tested library. gray-matter handles the regex matching, YAML parsing, and content extraction in one call.
Output: Both modules use gray-matter, js-yaml removed from deps, build passes.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@core/package.json
@core/src/services/memory/service.ts
@core/src/services/skill/loader.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Swap js-yaml for gray-matter in package.json and install</name>
  <files>core/package.json</files>
  <action>
    In core/package.json:
    1. Remove "js-yaml" from dependencies
    2. Remove "@types/js-yaml" from devDependencies
    3. Add "gray-matter" to dependencies (use ^4.0.3)
    4. Run `yarn install` from repo root to update lockfile
  </action>
  <verify>
    `grep gray-matter core/package.json` shows the dependency.
    `grep js-yaml core/package.json` returns no matches.
    `yarn install` completes without errors.
  </verify>
  <done>gray-matter is the only frontmatter-related dependency in core/package.json; js-yaml and @types/js-yaml are gone.</done>
</task>

<task type="auto">
  <name>Task 2: Replace custom parseFrontmatter in memory service and skill loader</name>
  <files>core/src/services/memory/service.ts, core/src/services/skill/loader.ts</files>
  <action>
    In core/src/services/memory/service.ts:
    1. Replace `import { load as yamlLoad } from "js-yaml"` with `import matter from "gray-matter"`
    2. Replace the `parseFrontmatter` method body:
       ```ts
       private parseFrontmatter(raw: string): { meta: Record<string, unknown>; content: string } {
         const { data, content } = matter(raw);
         return { meta: data, content: content.trim() };
       }
       ```

    In core/src/services/skill/loader.ts:
    1. Replace `import { load as yamlLoad } from "js-yaml"` with `import matter from "gray-matter"`
    2. Replace the standalone `parseFrontmatter` function body:
       ```ts
       function parseFrontmatter(raw: string): { meta: Record<string, unknown>; content: string } {
         const { data, content } = matter(raw);
         return { meta: data, content: content.trim() };
       }
       ```

    Both replacements preserve the exact same return shape `{ meta, content }` so all callers remain unchanged.
  </action>
  <verify>
    `yarn build` from repo root passes (typecheck + build).
    `grep -r "js-yaml" core/src/` returns no matches.
    `grep -r "gray-matter" core/src/` shows exactly 2 files.
  </verify>
  <done>Both parseFrontmatter implementations use gray-matter. No js-yaml imports remain in any source file. Build and typecheck pass cleanly.</done>
</task>

</tasks>

<verification>
1. `grep -r "js-yaml" core/` returns nothing (fully removed)
2. `grep -r "gray-matter" core/src/` shows memory/service.ts and skill/loader.ts
3. `yarn build` passes without errors
4. No custom frontmatter regex remains in either file
</verification>

<success_criteria>
- gray-matter is the sole frontmatter parser across the codebase
- js-yaml and @types/js-yaml fully removed
- Both parseFrontmatter functions return identical { meta, content } shape
- Build and typecheck pass
</success_criteria>

<output>
After completion, create `.planning/quick/2-gray-matter-js-yaml-memory-block-skill/2-SUMMARY.md`
</output>
