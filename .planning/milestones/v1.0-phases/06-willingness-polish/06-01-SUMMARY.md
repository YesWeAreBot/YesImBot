---
phase: 06-willingness-polish
plan: 01
subsystem: agent
tags: [willingness, cooldown, llm-judge, scoring, koishi]

requires:
  - phase: 05-think-act-loop
    provides: AgentCore, ThinkActLoop, ModelService with getModel()
provides:
  - WillingnessCalculator with shouldReply/computeScore/isInHardCooldown/llmJudge
  - gateAndEnqueue pattern in AgentCore replacing direct enqueue
  - 7 willingness config fields in AgentCoreConfig and index.ts Schema
affects: [06-02-polish]

tech-stack:
  added: []
  patterns:
    - "Willingness gate: deterministic bypass → hard cooldown → rule score → LLM fuzzy zone"
    - "incrementMessageCount before shouldReply to count all messages, not just replied ones"
    - "recordReply after successful loop run to reset cooldown state"

key-files:
  created:
    - plugins/core/src/services/agent/willingness.ts
  modified:
    - plugins/core/src/services/agent/config.ts
    - plugins/core/src/services/agent/service.ts
    - plugins/core/src/services/agent/index.ts
    - plugins/core/src/index.ts

key-decisions:
  - "maxOutputTokens (not maxTokens) for ai-sdk v6 LLM judge call"
  - "WillingnessCalculator is plain class, not Koishi Service — no registration overhead"
  - "gateAndEnqueue wraps entire body in try/catch to prevent unhandled rejections"

patterns-established:
  - "Willingness gate pattern: increment → shouldReply → enqueue or drop"

requirements-completed: [AGENT-02]

duration: 8min
completed: 2026-02-19
---

# Phase 6 Plan 01: Willingness Gate Summary

**WillingnessCalculator gates every percept via deterministic bypass, hard cooldown, rule scoring (0-1), and LLM fuzzy-zone judgment before reaching the think-act loop**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-19
- **Completed:** 2026-02-19
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- WillingnessCalculator with full 4-tier decision pipeline (mention/reply bypass → hard cooldown → rule score → LLM judge)
- AgentCore.handlePercept replaced with fire-and-forget gateAndEnqueue pattern
- 7 willingness config fields exposed in Schema with sensible defaults

## Task Commits

1. **Task 1: WillingnessCalculator class and config extension** - `f9ca37d` (feat)
2. **Task 2: Wire willingness into AgentCore and config schema** - `67596f1` (feat)

## Files Created/Modified

- `plugins/core/src/services/agent/willingness.ts` - WillingnessCalculator plain class
- `plugins/core/src/services/agent/config.ts` - 7 willingness fields added to AgentCoreConfig
- `plugins/core/src/services/agent/service.ts` - gateAndEnqueue pattern, willingness field
- `plugins/core/src/services/agent/index.ts` - re-exports WillingnessCalculator
- `plugins/core/src/index.ts` - Schema fields and AgentCore plugin call updated

## Decisions Made

- `maxOutputTokens` (not `maxTokens`) — ai-sdk v6 renamed the field; auto-fixed during Task 1 typecheck
- WillingnessCalculator is a plain class, not a Koishi Service — no lifecycle overhead needed
- `gateAndEnqueue` wraps entire body in try/catch to prevent unhandled promise rejections from crashing the event handler

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed maxTokens → maxOutputTokens for ai-sdk v6**

- **Found during:** Task 1 (WillingnessCalculator llmJudge)
- **Issue:** ai-sdk v6 renamed `maxTokens` to `maxOutputTokens` in CallSettings; TypeScript error TS2353
- **Fix:** Changed `maxTokens: 5` to `maxOutputTokens: 5` in llmJudge generateText call
- **Files modified:** plugins/core/src/services/agent/willingness.ts
- **Verification:** `npx tsc --noEmit -p plugins/core/tsconfig.json` passes
- **Committed in:** f9ca37d (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Necessary correctness fix for ai-sdk v6 API. No scope creep.

## Issues Encountered

None beyond the auto-fixed api naming deviation above.

## Next Phase Readiness

- Willingness gate complete; agent now makes intelligent reply decisions
- Plan 06-02 (polish) can proceed — no blockers

---

_Phase: 06-willingness-polish_
_Completed: 2026-02-19_

## Self-Check: PASSED

- FOUND: plugins/core/src/services/agent/willingness.ts
- FOUND: commit f9ca37d (WillingnessCalculator class and config extension)
- FOUND: commit 67596f1 (wire willingness gate into AgentCore and config schema)
- FOUND: .planning/phases/06-willingness-polish/06-01-SUMMARY.md
