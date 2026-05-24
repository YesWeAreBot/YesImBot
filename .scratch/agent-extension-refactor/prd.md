---
labels: [ready-for-agent]
status: open
assignee: MiaowFISH
---

# PRD: Agent Extension Lifecycle Refactor

## Problem Statement

Athena's agent framework currently carries too much platform-specific Extension system behavior. The agent package owns extension definitions, loading, lifecycle, hot reload, binding, tool registration metadata, and working-directory assumptions, while core also has an Extension Service that performs the real Koishi-facing registration work.

This split makes the boundary hard to reason about. Extension lifecycle behavior is distributed across two layers, tool state can drift during reload, prompt construction depends on agent-internal metadata, and session files still carry `cwd` data from the old coding-agent lineage even though Athena does not need filesystem path metadata in session headers.

## Solution

Move Extension lifecycle ownership fully into core's Extension Service and reduce the agent package to a generic runtime. The agent package will expose a Hook Runner that dispatches typed hooks and lifecycle events, but it will not know about Extension definitions, `setup()`, `cleanup()`, hot reload orchestration, or Extension API objects.

Core will own Extension definitions, Extension API construction, per-channel setup and cleanup, built-in prompt extension registration, extension tool snapshot collection, reload aggregation, and plugin-facing types. AgentSession will receive a ready Hook Runner and an atomic extension tool snapshot, then continue to own agent loop orchestration, session persistence, final tool registry merging, compaction, retry, and queue tracking.

Session headers will stop writing path metadata. Old session files that include `cwd` remain readable, but new writes omit the field and runtime writes do not rewrite old headers.

## User Stories

1. As an Athena maintainer, I want core to be the only owner of Extension lifecycle, so that extension behavior has one source of truth.
2. As an Athena maintainer, I want the agent package to be free of Extension definitions and loaders, so that it remains a reusable agent runtime.
3. As an extension author, I want a single `setup(api)` contract, so that I do not need to understand separate agent and Athena extension definition types.
4. As an extension author, I want channel context on the Extension API, so that channel-aware extensions do not need a second setup argument.
5. As an extension author, I want tools declared during setup to be collected reliably, so that tools appear consistently after session startup and reload.
6. As an extension author, I want extension handler failures to be fail-open by default, so that one broken handler does not stop the agent's main flow.
7. As an extension author, I want blocking and cancellation to be explicit return values, so that control flow is predictable and testable.
8. As an Athena maintainer, I want Hook Runner to expose typed reducer hooks for result-producing events, so that prompt, context, tool, provider, and compaction modifications are type-safe.
9. As an Athena maintainer, I want lifecycle events to use a generic no-result emitter, so that ordinary broadcasts do not require repetitive bespoke methods.
10. As an Athena maintainer, I want ExtensionService registration and unregistration to be awaitable, so that callers can know when active channels have finished reload.
11. As an Athena maintainer, I want reload errors aggregated per channel, so that a bad channel runtime does not hide failures or block other channels.
12. As an Athena maintainer, I want no global rollback on partial reload failure, so that extension definition updates do not become distributed transactions.
13. As an Athena maintainer, I want session startup to await extension setup, so that the first message never runs against a half-installed extension set.
14. As an Athena maintainer, I want the built-in system prompt behavior registered through ExtensionService, so that built-in and plugin extensions use the same path.
15. As an Athena maintainer, I want prompt snippets and prompt guidelines to stay in core, so that agent does not need to know prompt assembly details.
16. As an Athena maintainer, I want core to atomically send extension tool snapshots to AgentSession, so that tools and prompt inputs do not drift during reload.
17. As an Athena maintainer, I want AgentSession to keep final tool merging, so that base tools, extension tools, and custom tools remain locally consistent.
18. As an Athena maintainer, I want extension tool state updates to affect only the extension layer, so that custom tools and base tools are not accidentally overwritten.
19. As an Athena maintainer, I want dynamic runtime tool mutation out of scope, so that this refactor does not reintroduce incremental mutable tool state.
20. As an Athena maintainer, I want a future dynamic tool provider model documented, so that dynamic tools can be added later without breaking snapshot semantics.
21. As an Athena maintainer, I want SessionHeader to omit filesystem paths, so that session files reflect Athena's chat context rather than old coding-agent assumptions.
22. As an Athena maintainer, I want old session files with `cwd` to remain readable, so that existing history does not break.
23. As an Athena maintainer, I want old headers left untouched during normal appends, so that runtime writes remain append-only.
24. As an Athena maintainer, I want no session header versioning in this change, so that a simple field removal does not add unnecessary format machinery.
25. As an Athena maintainer, I want compaction execution extracted behind a focused module, so that manual and automatic compaction share one tested path.
26. As an Athena maintainer, I want retry behavior extracted behind a focused module, so that retry state and backoff rules are independently testable.
27. As an Athena maintainer, I want Extension-related plugin imports moved to core exports, so that the API break is explicit rather than hidden behind compatibility shims.
28. As an Athena maintainer, I want the old ExtensionRunner and ExtensionRegistry concepts removed from agent, so that future contributors do not maintain two registries.
29. As an Athena maintainer, I want tests organized by agent runtime, core Extension Service, session format, and plugin integration, so that cross-layer regressions are caught.
30. As an AFK implementation agent, I want a fully specified PRD and check plan, so that I can implement without reopening architectural decisions.

## Implementation Decisions

- Core's Extension Service owns Extension definitions, setup, cleanup, reload, built-in prompt extension registration, channel-specific Extension API construction, and extension tool snapshot collection.
- The agent package owns Hook Runner dispatch, agent loop orchestration, session persistence, final tool registry merging, compaction, retry, and queue tracking.
- Hook Runner is not an Extension lifecycle manager. It does not accept Extension definitions, does not expose reload, and does not execute setup or cleanup.
- Hook Runner exposes reducer hooks for `beforeAgentStart`, `transformContext`, `beforeToolCall`, `afterToolCall`, `beforeProviderRequest`, and `beforeCompact`.
- Hook Runner exposes generic lifecycle emit for no-result events such as agent, turn, message, tool execution, session compact, and session shutdown notifications.
- Hook errors are fail-open. Errors are recorded through the extension error path and subsequent handlers continue.
- Control-flow changes must be explicit hook results, such as block, cancel, modified messages, modified tool result, modified provider payload, or replacement compaction.
- ExtensionService registration and unregistration return promises and aggregate reload results across all active channels.
- Partial channel reload failures do not roll back the global Extension definition registry.
- Channel runtime creation waits for all extension setup calls before the session is considered ready to process messages.
- RuntimeService and AgentSession provide an Extension Host to ExtensionService. This host supplies Hook Runner, SessionManager, message actions, session name actions, active tool actions, compaction, abort, model access, and current runtime state.
- ExtensionService does not create SessionManager. It consumes the host supplied by runtime/session wiring.
- The Extension API lives in core and is exported from core for plugins.
- The old Athena-specific Extension definition type and generic agent Extension definition type are unified into one core-owned Extension definition type.
- `setup(api)` is the only setup signature. Channel context is read from `api.channel`.
- `api.registerTool()` and `api.unregisterTool()` are setup-stage declaration capabilities only.
- Runtime dynamic tool mutation is out of scope. A future version should use a dynamic tool provider registered during setup, with core recomputing and atomically applying full snapshots.
- Core may keep richer extension tool definitions for prompt assembly, including prompt snippets and prompt guidelines.
- Agent receives only runtime tool snapshots. Agent does not depend on core Extension types or prompt metadata.
- The agent-side tool state application method only updates the extension tool layer and leaves base tools, custom tools, retry state, queues, and other runtime state untouched.
- AgentSession still performs the final merge of base tools, extension tool snapshot, and custom tools.
- The built-in system prompt behavior becomes a core built-in extension registered through ExtensionService.
- Agent no longer consumes prompt snippets or prompt guidelines. Core assembles final prompt inputs and sends final system prompt behavior through hooks.
- SessionHeader removes `cwd` and does not add a replacement path field.
- Old session headers containing `cwd` are tolerated while reading.
- Runtime appends to old session files do not rewrite old headers.
- No session header version field is introduced.
- Compaction execution is extracted into a focused module that covers preparation, before-compact hook, generated or extension-supplied compaction, append, message refresh, and compact lifecycle event.
- Manual compaction and auto-compaction share the focused compaction execution module while retaining their own trigger, signal, retry, and reporting behavior.
- Retry behavior is extracted into a focused module that preserves current retry semantics and can be tested without running a full agent session.
- The public agent package API intentionally breaks for Extension consumers. No compatibility shim is kept in the agent package.

## Testing Decisions

- Tests should assert external behavior and cross-layer contracts, not private field layouts or implementation-specific call order beyond documented ordering guarantees.
- Hook Runner tests should cover reducer chaining, lifecycle emit, stable ordering, fail-open error isolation, explicit block/cancel behavior, and payload/result preservation.
- Core Extension Service tests should cover setup, cleanup, reload, channel runtime creation, awaiting setup before ready, built-in prompt extension registration, aggregate reload errors, and no rollback on partial failure.
- Tool snapshot tests should verify setup-stage tool declarations become full snapshots, snapshots are atomically applied, base/custom tools are preserved, and prompt snippets/guidelines stay out of agent runtime.
- Session format tests should verify new headers do not include `cwd`, old headers with `cwd` still read, and appending to old sessions does not rewrite headers.
- Compactor tests should verify manual and auto compaction share the same execution behavior for normal compaction, extension-supplied compaction, cancellation, append, and lifecycle event emission.
- RetryHandler tests should cover retryability classification, exponential backoff boundaries, max retries, success after retry, and final failure.
- Plugin integration tests should verify chat-history, workspace, mcp-client, and skill use the new core Extension API imports and `setup(api)` signature.
- Type-level or package-level checks should verify the agent package no longer exports ExtensionDefinition, ExtensionAPI, ExtensionRunner, ExtensionRegistry, or extension loader concepts.
- Existing extension system tests provide prior art for handler ordering, cleanup, unregister behavior, and stale broadcast prevention, but ownership moves from agent tests to core Extension Service tests.
- Existing compaction tests provide prior art for testing compaction as behavior over session entries and messages.
- Existing session manager and chat-history tests provide prior art for JSONL session fixture compatibility.
- Verification should include targeted package type-checks/tests for agent and core, plus full lint, format check, type-check, build, and test before completion.

## Out of Scope

- RuntimeService's larger closure decomposition beyond what is required for ExtensionService integration.
- Adapter event creation unification.
- Further abstraction of the chat-history session format parser.
- Workspace tool error handling cleanup.
- Queue UI tracking redesign.
- Narrow Extension SessionManager facade.
- Runtime dynamic tool management.
- Session header versioning.
- Offline migration of historical session files.
- Compatibility shims that keep Extension API exports in the agent package.
- Provider factory work and provider plugin refactors.

## Further Notes

The domain glossary defines Extension Service as the only Extension lifecycle owner and Hook Runner as a pure hook dispatcher. The ADR for this area records that core owns Extension lifecycle and agent retains only generic runtime behavior.

The implementation should treat this as a cross-layer refactor. The important invariant is that core owns Extension platform semantics while agent remains reusable and does not import or expose core-owned Extension contracts.
