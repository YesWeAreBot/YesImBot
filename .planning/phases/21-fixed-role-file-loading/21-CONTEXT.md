# Phase 21: Fixed-Role File Loading - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

SOUL.md/AGENTS.md/TOOLS.md fixed-role files replace legacy default files (default-identity.md, default-style.md, default persona.md, default-control-flow.md, default-basic-functions.md). Files support Mustache templating and hot-reload. This phase does NOT add new injection points or new capabilities — it replaces the content source for existing soul and instructions injection points.

</domain>

<decisions>
## Implementation Decisions

### Default Content Style
- Borrow OpenClaw's file-separation philosophy but design Athena's own voice and structure
- Additionally reference letta's memgpt_chat and memgpt_v2_chat system prompts (references/letta/letta/prompts/system_prompts) — v3 was built on this lineage, proven path
- Default language: English (users can rewrite in any language)
- Internal structure: Markdown headings (## sections) — facilitates future RAG chunking/search
- SOUL.md and AGENTS.md boundary: broadly separated but cross-references allowed (e.g. SOUL.md may mention behavioral tendencies like "prefers rhetorical questions")

### Template Variables
- Coverage: as rich as possible — expose bot info, date/time, platform/channel context, and other runtime data
- Naming convention: dot-nested (e.g. `{{bot.name}}`, `{{date.now}}`, `{{platform.name}}`)
- Data sources: predefined variables + user-defined custom variables via config + plugin-registered Snippets
- Undefined variables: render as empty string + warn log (aids debugging without breaking output)

### File Discovery & Fallback
- Default location: Koishi data directory (e.g. `data/athena/SOUL.md`), path configurable via plugin config
- SOUL.md and AGENTS.md are required; TOOLS.md is optional (silently skipped when absent)
- First launch / missing files: release bundled defaults from package into user directory
- Existing user files are never overwritten on plugin update — log a notice instead
- Future: migration command after command system is built (deferred)

### Hot Reload
- Reuse existing MemoryService fs.watch + debounce infrastructure — register role files into the same watcher manager
- Silent reload + debug-level log only (no user-facing notification)
- On reload: re-render Mustache template; on syntax error, warn log and retain last valid content

### Claude's Discretion
- Exact Mustache variable catalog (which runtime values to expose beyond the obvious ones)
- Internal structure of default SOUL.md/AGENTS.md/TOOLS.md content (heading hierarchy, section order)
- Compression algorithm for bundled defaults
- Watcher registration API details within MemoryService

</decisions>

<specifics>
## Specific Ideas

- Reference letta's memgpt_chat / memgpt_v2_chat prompts — v3's system prompt was directly adapted from memgpt_chat (later iterated to v2_chat), this lineage is proven
- OpenClaw's file-separation concept (SOUL/AGENTS/TOOLS as distinct concerns) is the structural inspiration
- Markdown heading structure chosen specifically for future RAG compatibility — sections should be self-contained chunks

</specifics>

<deferred>
## Deferred Ideas

- Migration command for updating user role files when bundled defaults change — requires command/instruction system (future phase)
- Per-channel dynamic SOUL.md — explicitly out of scope (Skill effects cover per-context adjustments)
- USER.md (OpenClaw user profile files) — requires per-user persistence, belongs to L1/L2/L3 memory system

</deferred>

---

*Phase: 21-fixed-role-file-loading*
*Context gathered: 2026-02-23*
