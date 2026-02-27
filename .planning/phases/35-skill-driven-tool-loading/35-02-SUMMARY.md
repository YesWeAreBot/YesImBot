---
phase: 35-skill-driven-tool-loading
plan: 02
subsystem: plugin
tags: [search-tool, tavily, skill-activation, hidden-tools, ctx-http]

requires:
  - phase: 35-skill-driven-tool-loading
    provides: hidden flag infrastructure in decorators and base-plugin (Plan 01)
provides:
  - SearchPlugin with hidden search tool registered via registerTool()
  - TavilyBackend calling ctx.http.post against configurable endpoint
  - Search Skill YAML that un-hides the search tool on intent activation
  - End-to-end config wiring from top-level Schema to TavilyBackend
affects: [36-skill-conditions, 37-interactions-plugin]

tech-stack:
  added: []
  patterns: [multi-backend search interface, conditional plugin registration]

key-files:
  created:
    - core/src/services/plugin/builtin/search/types.ts
    - core/src/services/plugin/builtin/search/backends/tavily.ts
    - core/src/services/plugin/builtin/search/index.ts
    - core/resources/skills/search/SKILL.md
  modified:
    - core/src/services/plugin/builtin/index.ts
    - core/src/services/plugin/service.ts
    - core/src/index.ts
    - core/src/locales/zh-CN.json
    - core/src/locales/en-US.json

key-decisions:
  - "SearchPlugin only registered when config.searchApiKey is provided — no tool exists if unconfigured"
  - "TavilyBackend returns empty array on any error or missing apiKey — silent degradation"

patterns-established:
  - "multi-backend search: SearchBackend interface allows future backends without touching SearchPlugin"
  - "conditional builtin registration: check config before registering optional builtin plugins"

requirements-completed: [TOOL-02]

duration: 4min
completed: 2026-02-27
---

# Phase 35 Plan 02: Search Tool & Skill Summary

**Hidden search tool with Tavily backend and sticky Skill activation via ctx.http configurable endpoint**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T14:55:04Z
- **Completed:** 2026-02-27T14:59:10Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- SearchBackend interface with SearchResult/SearchOptions types for multi-backend extensibility
- TavilyBackend uses ctx.http.post with silent degradation on error or missing API key
- SearchPlugin registers a hidden `search` tool via registerTool() with inner_thoughts parameter
- Search Skill YAML activates on intent:search dimension, sticky for 2 rounds
- Config wired end-to-end: flat top-level keys -> nested SearchPluginConfig -> TavilyBackend
- i18n labels added for all search config fields in both locales

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SearchBackend interface, TavilyBackend, and SearchPlugin** - `72cac62` (feat)
2. **Task 2: Wire SearchPlugin into PluginService, config, and create search Skill** - `c860f25` (feat)

## Files Created/Modified

- `core/src/services/plugin/builtin/search/types.ts` - SearchBackend interface, SearchResult, SearchOptions, SearchPluginConfig
- `core/src/services/plugin/builtin/search/backends/tavily.ts` - TavilyBackend with ctx.http.post and silent degradation
- `core/src/services/plugin/builtin/search/index.ts` - SearchPlugin with hidden search tool
- `core/resources/skills/search/SKILL.md` - Skill YAML with sticky lifecycle and intent-based activation
- `core/src/services/plugin/builtin/index.ts` - Added SearchPlugin export
- `core/src/services/plugin/service.ts` - Conditional SearchPlugin registration, SearchPluginConfig in interface
- `core/src/index.ts` - Flat search config keys, conditional config pass-through
- `core/src/locales/zh-CN.json` - Chinese labels for search config fields
- `core/src/locales/en-US.json` - English labels for search config fields

## Decisions Made

- SearchPlugin only registered when config.searchApiKey is provided — avoids registering a non-functional tool
- TavilyBackend returns empty array on any error or missing apiKey — silent degradation per user decision
- Flat config keys at top level (searchProvider, searchEndpoint, etc.) mapped to nested SearchPluginConfig

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

Search tool requires a Tavily API key configured via Koishi plugin config UI (searchApiKey field). Without it, the search tool simply won't be registered. Get a key from https://tavily.com.

## Next Phase Readiness

- Phase 35 complete — hidden tool infrastructure (Plan 01) and search tool with Skill (Plan 02) both landed
- Ready for Phase 36 (skill conditions) and Phase 37 (interactions plugin)

## Self-Check: PASSED

All files found, all commits verified.
