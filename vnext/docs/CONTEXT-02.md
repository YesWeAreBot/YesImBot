# Phase 2: Native Turn and Tool Execution - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Make one session run a complete native `pi-agent` / `pi-ai` assistant turn with unified tool execution and direct visible output. This phase defines turn completion behavior, mixed text/tool interaction, terminal-tool semantics, model fallback behavior, and tool-failure handling inside the live runtime loop. It does not add durable persistence/replay, abort-resume hardening, or prompt-document governance from later phases.

</domain>

<decisions>
## Implementation Decisions

### Direct visible output

- Current-channel visible text is a runtime-native output path, not a tool.
- Most IM platforms should not assume true stream editing; runtime should emit text by segment when it encounters an explicit separator marker comparable to `<sep/>`.
- Reply granularity is `short = single message`, `long = segmented output`.
- If the model does not emit a separator marker but the content is too long, runtime should apply a fallback split.
- Segment pacing should vary with content length rather than always using one fixed pause.
- If text has already been emitted and the turn later invokes tools, emitted text stays visible and is not recalled.
- A pure-text turn ends when text emission finishes.
- If text was emitted before a later tool failure, keep the emitted text and do not add failure explanation by default unless it is necessary.

### Text and tool ordering

- A turn may mix user-visible text and tool calls; runtime does not force a single fixed global order.
- The model may emit non-result-dependent preface text before tool execution.
- If tools are long-running, runtime does not need to add extra progress chatter by default.
- If the turn is mainly action-oriented, it may still open with a short acknowledgement, but should stay concise.
- If a pre-tool conclusion later proves wrong because tool results disagree, runtime should preserve the earlier text and let later text correct it instead of retracting it.
- For multi-tool chains, user-visible text should usually be concentrated near the end of the tool chain rather than after every tool.
- When text and stronger side-effect tools coexist, runtime should be more conservative about the side-effect tools than about already-emitted text.

### Terminal tool semantics

- Terminal behavior is explicit metadata, not an automatic property inferred from all side-effect tools.
- Direct visible output for the current channel is not a terminal tool because it is not modeled as a tool at all.
- The default terminal set should stay small and focus on strong side-effect tools; cross-channel send is a default terminal candidate.
- A terminal tool only behaves as terminal when the current turn calls terminal tools and no non-terminal tools in the same tool batch.
- If a terminal tool is mixed with other tools in the same turn, ignore terminal semantics and treat it like a normal tool.
- If a terminal-only turn succeeds, end the turn without another model round and append a synthetic assistant message after `tool_result` as the natural closeout.
- If a terminal tool fails, terminal semantics do not apply; failure returns to the normal failure flow.
- If backlog already contains fresh user input, terminal success ends only the current turn and the session may move directly to the next queued input.
- Runtime should not expose an extra "turn ended" notice to users after terminal completion.

### Model selection and fallback

- Each session has a configured primary model and should remain stable on that model during normal operation.
- Fallback triggers only on explicit abnormal conditions such as timeout, rate limit, or comparable request failure; do not fallback just because output quality feels weak.
- Fallback is temporary for the current turn only; later turns should try the session's primary model again.
- If a turn has already emitted user-visible text, do not switch models mid-turn; defer recovery to a later turn.
- Primary model choice comes from session-level configuration rather than frequent runtime re-selection.
- Fallback chains should contain only models that are capability-compatible with the turn semantics, especially for tool support.
- Single-session model execution remains serialized; do not introduce concurrent model turns inside one session in this phase.

### Tool failure handling

- Default failure flow is to return the tool failure to the model and let the model decide whether to explain, recover, or stop.
- If no user-visible text has been emitted yet, the model decides whether the user needs an explanation.
- If some text has already been emitted, keep it and only add a failure explanation when needed.
- Phase 2 should use one unified failure flow instead of splitting many failure classes into separate user-facing behaviors.
- After a tool failure, the model may get one chance to reroute or try an alternative tool path, but runtime should not allow unlimited self-retries.
- Safety denials and allow/deny blocks still return to the model, but the blocked tool must not be auto-retried or bypassed.
- Payload truncation or bounds enforcement should be treated as "limited success" rather than a hard failure when usable result content still exists.

### Claude's Discretion

- Exact separator token syntax used by the native output path.
- Exact long-message split thresholds and pacing formula.
- Exact metadata field name used to mark a tool as terminal.
- Exact synthetic assistant message content used to close a terminal-only turn.
- Exact abnormal-condition taxonomy that is sufficient to trigger fallback, as long as it stays stricter than "quality feels bad".

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and locked requirements

- `.planning/PROJECT.md` — project-wide non-negotiables: greenfield `vnext/`, session-first runtime, unified tool surface, direct output, selective reuse posture.
- `.planning/REQUIREMENTS.md` — Phase 2 requirement mapping for `TURN-01`, `TURN-04`, `TOOL-01` to `TOOL-04`, and `MODL-01` to `MODL-03`.
- `.planning/ROADMAP.md` — fixed Phase 2 goal and success criteria.
- `.planning/STATE.md` — current sequencing note that Phase 2 must validate the native `pi-agent` / `pi-ai` loop before Phase 3 hardening.
- `.planning/phases/01-session-runtime-boundaries/01-CONTEXT.md` — carry-forward boundary decisions from Phase 1: ingress-only listener, session-owned lifecycle, backlog observation posture, and greenfield reuse limits.

### Runtime direction and scope discipline

- `docs/ideas/01-session-centric-runtime.md` — canonical vNext runtime direction, including direct visible output, unified tool semantics, and open questions around mixed text/tool ordering and terminal tools.
- `docs/ideas/02-session-centric-runtime-greenfield-plan.md` — greenfield landing rules, subsystem boundaries, and which old modules are reference-only versus reusable assets.
- `docs/ideas/03-session-centric-runtime-tech-stack-selection.md` — stack decision that vNext should use `pi-agent` + `pi-ai` and a new model contract rather than inheriting the ai-sdk-shaped shared model stack.

### Library behavior references

- `references/pi-agent.md` — native turn/event flow, `message_update`, tool execution ordering, `beforeToolCall` / `afterToolCall`, and the behavior of `turn_end` / `agent_end`.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `core/src/services/plugin/service.ts` — useful reference for plugin registration, tool execution entrypoints, timeouts, and result shaping; do not carry over the old action/tool split semantics.
- `core/src/services/plugin/builtin/core.ts` — useful reference for send/record behavior, split-message experience, and platform send handling; current-channel direct output should reuse the experience, not the old `send_message` protocol role.
- `core/src/services/model/service.ts` — useful reference for provider registry, fallback chain, and per-service concurrency queueing; the ideas are reusable, but the ai-sdk-shaped contract is not.

### Established Patterns

- `core/src/services/agent/loop.ts` — anti-reference for the old hand-written JSON action loop, `send_message` wrapping, and model-repair behavior that vNext should replace.
- `references/pi-agent.md` — preferred runtime pattern for assistant text events, tool execution lifecycle, and turn boundaries.
- `packages/shared-model/src/types/model.ts` — shows why the current shared model layer is coupled to ai-sdk types and should not become the vNext contract.
- `providers/anthropic/src/index.ts` — evidence that provider-specific request patching exists and should remain possible in the thinner vNext model/provider adapter layer.

### Integration Points

- New turn runtime should live under the dedicated `vnext/` subsystem rather than `core/src/services/agent/`.
- Koishi-facing session runtime still needs a bridge for current-channel output and strong side-effect tools, but not through the old `send_message`-as-primary-protocol path.
- Tool execution needs access to session state and platform adapter/session data without reviving the old capability abstraction.
- Model selection and fallback should plug into a new vNext contract that preserves stable session-level model identity.

</code_context>

<specifics>
## Specific Ideas

- 大部分 IM 平台不支持真正的流式编辑，更接近“模型输出特殊分隔标记后，runtime 按段发送”。
- 延续旧设计里 `<sep/>` 一类显式分段思路，但 Phase 2 可以换成更合适的原生输出分隔符。
- terminal 的真正语义不是“成功后立即砍掉一切”，而是“当一整轮只做 terminal 工具时，不再向模型续跑，并手动补一条 assistant 收口消息”。
- 如果 terminal 和普通工具混用，则忽略 terminal 语义，按普通工具批次处理。

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 02-native-turn-and-tool-execution_
_Context gathered: 2026-03-20_
