---
phase: quick-3
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - core/resources/roles/AGENTS.md
  - core/resources/roles/TOOLS.md
  - core/src/services/agent/loop.ts
autonomous: true
requirements: [FIX-AGENT-JSON-DRIFT]

must_haves:
  truths:
    - "Agent always outputs valid JSON with actions array, even after multiple rounds"
    - "Working memory format does not mislead LLM away from JSON output"
    - "When LLM outputs raw text (no JSON), loop wraps it as send_message instead of terminating"
  artifacts:
    - path: "core/resources/roles/AGENTS.md"
      provides: "Unified, strongly-enforced JSON response format with explicit warnings"
    - path: "core/resources/roles/TOOLS.md"
      provides: "Tool calling docs that defer to AGENTS.md for response format, no conflicting schema"
    - path: "core/src/services/agent/loop.ts"
      provides: "Improved raw-text fallback and format-reinforcing tool result messages"
  key_links:
    - from: "core/resources/roles/AGENTS.md"
      to: "core/src/services/agent/loop.ts"
      via: "LLM reads AGENTS.md as system prompt, loop.ts parses LLM output"
      pattern: "JSON.*actions"
    - from: "core/resources/roles/TOOLS.md"
      to: "core/resources/roles/AGENTS.md"
      via: "Both injected into instructions point, must not conflict on format"
      pattern: "Response Format"
    - from: "core/src/services/agent/loop.ts formatToolResults"
      to: "LLM next-round input"
      via: "Tool results message reinforces expected output format"
      pattern: "formatToolResults"
---

<objective>
Fix agent JSON output drift that causes loop termination after several conversation rounds.

Purpose: After multiple rounds, the LLM stops producing valid JSON and instead outputs raw text (the send_message content directly). This is caused by: (1) conflicting response format definitions between AGENTS.md and TOOLS.md, (2) insufficient format enforcement in the system prompt, (3) working memory compact format that primes non-JSON output, and (4) weak raw-text fallback in the loop.

Output: Hardened AGENTS.md/TOOLS.md with unified format spec, improved loop fallback for raw text, and format-reinforcing tool result messages.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@core/resources/roles/AGENTS.md
@core/resources/roles/TOOLS.md
@core/src/services/agent/loop.ts
@core/src/services/agent/json-parser.ts
@core/src/services/agent/tools.ts
@core/src/services/horizon/service.ts
@core/resources/templates/partials/horizon-view.mustache
</context>

<tasks>

<task type="auto">
  <name>Task 1: Unify and harden JSON format spec in AGENTS.md and TOOLS.md</name>
  <files>core/resources/roles/AGENTS.md, core/resources/roles/TOOLS.md</files>
  <action>
**AGENTS.md changes:**

1. In the "Response Format" section, add an explicit constraint block BEFORE the JSON example:

```
**CRITICAL: Your output MUST be a single valid JSON object. Never output raw text, markdown, or anything outside the JSON structure. Every response, without exception, must follow this format:**
```

2. After the JSON example, add a "Common Mistakes" warning:

```
**Never do this:**
- Output message text directly without wrapping in JSON
- Wrap JSON in markdown code fences (no ```json blocks)
- Omit the actions array (use empty array [] if no actions needed)
```

3. Keep the `thoughts` field definition as-is (object with observe/analyze_infer/plan) since that matches what `loop.ts` expects in the AgentResponse interface.

**TOOLS.md changes:**

1. Remove the entire "Response Format" section (lines 7-28) that duplicates and conflicts with AGENTS.md. The `thoughts` field is shown as a plain string in TOOLS.md but AGENTS.md defines it as a structured object — this inconsistency confuses the LLM over multiple rounds.

2. Keep only the "Tool Calling" header, the "Tools vs Actions" section, "Key Actions" section, and "Available Tools" section.

3. In the remaining "Tool Calling" intro paragraph, add a brief reference: "See the Response Format section above for the exact JSON structure."

The goal is: AGENTS.md is the single source of truth for response format. TOOLS.md only describes tool mechanics (what tools are, how heartbeat works, available tools).
  </action>
  <verify>
    <automated>cd /home/workspace/Athena && grep -c "Response Format" core/resources/roles/TOOLS.md | xargs test 0 -eq && grep -c "CRITICAL" core/resources/roles/AGENTS.md | xargs test 0 -lt && echo "PASS"</automated>
    <manual>Read both files and confirm: AGENTS.md has strong format enforcement, TOOLS.md has no conflicting format spec</manual>
  </verify>
  <done>AGENTS.md has explicit JSON-only constraint with common mistakes warning. TOOLS.md no longer has its own Response Format section. No conflicting thoughts field definitions.</done>
</task>

<task type="auto">
  <name>Task 2: Improve loop raw-text fallback and format-reinforcing tool results</name>
  <files>core/src/services/agent/loop.ts</files>
  <action>
**In `loop.ts`, make three targeted changes:**

1. **Improve raw-text fallback (around lines 179-194).** Currently only catches `{content: "..."}` shape. Add a final fallback: if parsed.data is null AND rawText is non-empty AND rawText doesn't look like JSON (no leading `{`), wrap the entire rawText as a send_message action. This prevents loop termination when the LLM outputs bare text.

Replace the current fallback block:
```ts
if (!parsed.data || !Array.isArray(parsed.data.actions)) {
  const raw = parsed.data as Record<string, unknown> | null;
  const fallbackContent = raw?.content;
  if (typeof fallbackContent === "string" && fallbackContent) {
    // existing logic
  } else {
    this.logger.info("Failed to parse agent response, breaking loop");
    break;
  }
}
```

With:
```ts
if (!parsed.data || !Array.isArray(parsed.data.actions)) {
  const raw = parsed.data as Record<string, unknown> | null;
  const fallbackContent = raw?.content;
  if (typeof fallbackContent === "string" && fallbackContent) {
    this.logger.info("No actions array, wrapping content field as send_message");
    parsed = {
      data: { actions: [{ name: "send_message", params: { content: fallbackContent } }] },
      error: null,
      logs: [],
    };
  } else if (!parsed.data && rawText.trim().length > 0) {
    this.logger.info("Raw text output detected, wrapping as send_message");
    parsed = {
      data: { actions: [{ name: "send_message", params: { content: rawText.trim() } }] },
      error: null,
      logs: [],
    };
  } else {
    this.logger.info("Failed to parse agent response, breaking loop");
    break;
  }
}
```

2. **Add format reminder to `formatToolResults` function (around line 391).** Append a brief reminder after tool results to reinforce JSON output:

Change:
```ts
return `Tool results:\n${JSON.stringify(compact)}`;
```
To:
```ts
return `Tool results:\n${JSON.stringify(compact)}\n\nRespond with a JSON object containing "actions" array.`;
```

3. **Same for `formatFinalRoundPrompt`** — it already has a strong instruction, no change needed there.

Do NOT change the working memory format in the horizon-view template or the wmLines construction — that format is also consumed by other parts of the system. The format reinforcement in tool results is sufficient.
  </action>
  <verify>
    <automated>cd /home/workspace/Athena && npx tsc --noEmit -p core/tsconfig.json 2>&1 | tail -5</automated>
    <manual>Check loop.ts: raw text fallback catches bare text, formatToolResults includes format reminder</manual>
  </verify>
  <done>Loop no longer terminates on bare text output — wraps as send_message. Tool result messages reinforce JSON format expectation. TypeScript compiles cleanly.</done>
</task>

</tasks>

<verification>
1. `grep -c "Response Format" core/resources/roles/TOOLS.md` returns 0 (no duplicate format spec)
2. `grep -c "CRITICAL" core/resources/roles/AGENTS.md` returns >= 1 (format enforcement present)
3. `grep "Respond with a JSON" core/src/services/agent/loop.ts` finds the format reminder
4. `grep "Raw text output detected" core/src/services/agent/loop.ts` finds the new fallback
5. TypeScript compiles: `npx tsc --noEmit -p core/tsconfig.json`
</verification>

<success_criteria>
- AGENTS.md is the single source of truth for JSON response format with explicit enforcement
- TOOLS.md describes tool mechanics only, no conflicting format definition
- Loop handles bare text output gracefully (wraps as send_message) instead of terminating
- Tool result messages reinforce expected JSON output format
- All changes compile cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/3-fix-unexpected-agent-outputs-agent-stops/3-SUMMARY.md`
</output>
