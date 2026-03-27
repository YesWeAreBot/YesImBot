# Phase 1: Session Runtime Boundaries - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish Athena vNext as an isolated session-owned runtime inside a dedicated `vnext/` subsystem. This phase defines session identity, ingress-to-mailbox behavior, and serialized per-session processing boundaries. It does not add the full native tool/runtime stack, persistence hardening, or prompt-document governance from later phases.

</domain>

<decisions>
## Implementation Decisions

### Session identity boundary

- Explicitly distinguish `Agent Session` from `Koishi Session`.
- Session uniqueness must be derived from stable identity fields such as `platform`, `channelId`, `userId`, and thread/subspace identifiers when present.
- Never derive session identity from display fields such as username or nickname.
- Group/channel sessions do **not** include `userId` in the session key.
- Direct-message sessions are user-scoped: the same user on the same platform maps to one continuing private session.
- Threads, subchannels, and forum/post-style subspaces are independent sessions, not merged into the parent channel session.
- If the underlying stable object remains the same, renames or display changes do not create a new session.
- Cross-platform conversations are isolated by default; the same person on different platforms does not share one session.

### Mailbox intake behavior

- Mailbox is the unified event intake queue for a session, not a guarantee that the agent will reply.
- All wake-relevant inputs enter mailbox first; the session runtime decides whether to stay silent or start a reply run.
- In group chat, consecutive messages should be short-window merged first, then evaluated once for participation.
- Even strong signals such as `@bot` or direct replies still follow the same merge-first group intake rule; do not bypass into immediate response.
- Message merging and willingness/LLM-assisted participation judgment belong inside the session runtime after mailbox intake, not in ingress/listener.
- If the final decision is not to reply, the input is still recorded as valid session input; the runtime stays silent rather than treating it as nonexistent.

### Busy-session continuation rules

- When a session is busy, newly arrived group-chat user messages may accumulate and be merged into backlog rather than forcing immediate handling.
- Do not support mid-turn abort/interruption in Phase 1.
- Treat `turn_end` as an observation point for fresh external user input, because this runtime is for fast-moving group chat rather than an industrial workflow agent.
- At `turn_end`, backlog user input may be injected behind the just-finished turn so the next turn can observe updated external context.
- If the agent would otherwise continue internally after `turn_end` (for example because the previous turn produced tool-follow-up work), backlog user input can influence that next turn.
- If the run would otherwise stop near `agent_end`, run participation judgment over the accumulated backlog before deciding whether to end or continue into a new turn.
- The `turn_end` observation path applies only to queued user input by default, not to every external event type.

### Legacy Athena reuse boundary

- Phase 1 should be treated as almost entirely greenfield.
- Do not directly port or mirror the old listener/ingress implementation into vNext.
- Aside from durable document assets, old runtime modules should not be used as Phase 1 implementation sources.
- Old provider, prompt, horizon, and related services are out of bounds for direct reuse in this phase; downstream agents may study them only as historical background if needed, not as integration targets.
- Preserve the importance of document assets such as `SOUL.md`, `AGENTS.md`, and `TOOLS.md`, but their runtime wiring belongs to later phases.

### Claude's Discretion

- Exact short-window merge durations for group intake.
- Exact heuristics for how many queued user messages become one merged backlog unit.
- Exact threshold math and fallback sequence for willingness vs LLM-assisted participation judgment.
- Exact event naming and state labels used to represent silent intake vs reply-triggering intake.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements

- `.planning/PROJECT.md` — project-level constraints: greenfield `vnext/`, session as single runtime unit, listener ingress-only, selective reuse posture.
- `.planning/REQUIREMENTS.md` — Phase 1 requirement mapping for `OPER-03`, `SESS-01` to `SESS-05`.
- `.planning/ROADMAP.md` — fixed Phase 1 boundary, success criteria, and plan split.

### vNext runtime direction

- `docs/ideas/01-session-centric-runtime.md` — canonical session-centric runtime direction: session ownership, mailbox semantics, listener boundary, Horizon demotion, append-only posture.
- `docs/ideas/02-session-centric-runtime-greenfield-plan.md` — greenfield repository strategy, `vnext/` placement, and explicit non-reuse / non-compatibility rules.

### Lifecycle and stack references

- `docs/ideas/03-session-centric-runtime-tech-stack-selection.md` — stack decision context for `pi-agent`/`pi-ai` and why old ai-sdk-shaped abstractions should not anchor vNext.
- `references/pi-agent.md` — lifecycle semantics for `turn_start`, `turn_end`, `agent_end`, steering/follow-up, and idle boundaries that inform backlog handling.

### Legacy repo boundaries and anti-reference

- `docs/ARCHITECTURE.md` — current repo service layering and old runtime boundaries; useful mainly to understand what vNext must not inherit directly.
- `docs/CHANGE_GUIDE.md` — existing service-boundary conventions and warnings against mixing listener/orchestration concerns.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `core/src/services/skill/session-store.ts` — shows an existing stable-key mindset (`platform:channelId`) for session-like state, but vNext should not reuse the implementation directly because Phase 1 needs a richer session identity boundary.
- `core/src/services/agent/service.ts` — demonstrates current willingness, aggregation, and queueing behavior; useful as a contrast sample for logic that must move inside session runtime in vNext.
- `core/src/services/horizon/listener.ts` — contains Koishi ingress experience and message normalization patterns, but Phase 1 intentionally avoids direct carry-over.

### Established Patterns

- `core/src/index.ts` — legacy runtime is tightly wired through the old Koishi service graph; Phase 1 should avoid coupling vNext core runtime to this graph.
- `docs/ARCHITECTURE.md` — current repository already values a data-layer vs decision-layer split; vNext keeps that principle while discarding the old runtime contract set.
- `references/pi-agent.md` — internal `turn` lifecycle is distinct from whole-run `agent` lifecycle, which is central to the selected backlog observation behavior.

### Integration Points

- New runtime code should live under a dedicated `vnext/` top-level subsystem.
- Koishi-facing ingress should normalize events and route them into an `Agent Session` mailbox, not decide whether to reply.
- Group-chat participation judgment, merge windows, and backlog observation belong between mailbox drain and reply-run start.
- Role/agent document assets remain important project artifacts, but their runtime injection is intentionally deferred beyond Phase 1.

</code_context>

<specifics>
## Specific Ideas

- "注意区分 Agent Session 和 Koishi Session。"
- "根据 platform、channelId、userId 等判断 session 唯一性，而不是用户名。"
- 这是群聊助手，不是工业级 agent；群聊里的上下文和话题变化很快，agent 要及时观察到外部环境变化。
- mailbox 表示统一事件入口，不表示收到事件后必须回复。

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 01-session-runtime-boundaries_
_Context gathered: 2026-03-20_
