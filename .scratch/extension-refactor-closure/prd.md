---
labels: [ready-for-agent]
status: open
assignee: MiaowFISH
---

# PRD: Extension Refactor Closure

## Problem Statement

Athena has already moved Extension lifecycle ownership from the generic agent package into core's `ExtensionService`, but the closure work is incomplete. Public and internal names still carry the old `ExtensionAPI`, `ExtensionHost`, `ChannelContext`, `ExtensionRunner`, and `ExtensionRegistry` concepts. Plugins call awaitable registration and unregistration methods without awaiting them, which weakens the ordering guarantee that extension setup completes before first channel use. Session forking still writes `cwd` into new session headers, contradicting the current `Session Header` domain language.

This creates a maintenance risk: future contributors can read stale names and documentation as permission to revive the old runner/host model, while active channels can observe extension tool snapshots before registration reload has settled.

## Solution

Complete the first-stage extension refactor closure with a narrow, breaking cleanup. Rename the plugin-facing setup surface from `ExtensionAPI` to `ExtensionContext`, rename `ChannelContext` to `Channel`, remove `ExtensionHost` as a public concept, and make `ExtensionService.createChannelRuntime()` consume an internal options object instead of a host object. Preserve current Extension lifecycle behavior and existing extension context capabilities for this stage.

Plugins will use `setup(ctx: ExtensionContext)`. `ctx.channel` will expose only Koishi/platform channel data: `platform`, `channelId`, channel `type`, and optional Koishi `bot`. Agent/session/model capabilities will not be placed on `Channel`. Existing session/tools capabilities can remain on `ExtensionContext` for now, with future deepening toward `ctx.session` and `ctx.tools`.

All plugin registration and unregistration calls will `await` the returned `ReloadSummary`. Reload failures remain fail-open: callers record failures but do not throw during plugin start or stop. New `Session Header` writes, including `forkFrom()`, will omit `cwd`.

## User Stories

1. As an Athena maintainer, I want `setup(ctx: ExtensionContext)` instead of `setup(api)`, so that extension code follows Koishi's context-oriented vocabulary.
2. As an Athena maintainer, I want `ExtensionAPI` removed from the public contract, so that future code does not preserve an obsolete API-centered abstraction.
3. As an Athena maintainer, I want `ExtensionHost` removed from public exports, so that the old runner/sandbox host model does not remain part of Athena's architecture.
4. As an extension author, I want `ctx.channel` to provide Koishi/platform channel information, so that channel-aware extensions can read where they are running.
5. As an extension author, I want `ctx.channel.bot` to expose the Koishi `Bot` reference when available, so that extensions can access Koishi platform context without a custom Athena bot wrapper in this stage.
6. As an Athena maintainer, I want `Channel` to exclude agent/session/model capabilities, so that Koishi platform context stays separate from agent runtime state.
7. As an Athena maintainer, I want existing extension methods to remain available on `ExtensionContext`, so that this closure does not become a broader extension capability redesign.
8. As an Athena maintainer, I want future `ctx.session` and `ctx.tools` grouping recorded, so that follow-up API deepening has a clear direction.
9. As an Athena maintainer, I want `createChannelRuntime()` to receive internal runtime options, so that core no longer needs a named host/access/wiring public abstraction.
10. As an Athena maintainer, I want `ExtensionService` to construct `ExtensionContext` internally, so that setup binding, tool declaration, hook registration, and active-context guards remain local to the lifecycle owner.
11. As an Athena maintainer, I want plugin start methods to await extension registration, so that startup does not report success before active channel reload has completed.
12. As an Athena maintainer, I want plugin stop methods to await extension unregistration, so that cleanup ordering is explicit and reload completion is observable.
13. As an Athena maintainer, I want registration reload failures logged but not thrown, so that one failed channel reload does not prevent a Koishi plugin from starting.
14. As an Athena maintainer, I want unregistration reload failures logged but not thrown, so that plugin stop continues to release other resources.
15. As an Athena maintainer, I want built-in chat-history and system-prompt extensions to use `ExtensionContext`, so that built-ins follow the same contract as external plugins.
16. As an Athena maintainer, I want workspace, MCP client, and skill plugins to use `ExtensionContext`, so that external plugin examples teach the current API.
17. As an Athena maintainer, I want all remaining `ExtensionRunner` and `ExtensionRegistry` documentation references corrected, so that project guidance matches the code.
18. As an Athena maintainer, I want `SessionManager.forkFrom()` to omit `cwd` from new headers, so that new session files obey the `Session Header` contract.
19. As an Athena maintainer, I want old session files with `cwd` to remain readable, so that historical data remains compatible.
20. As an Athena maintainer, I want a boundary test preventing `ExtensionHost` from returning to the public core entrypoint, so that public API drift is caught early.
21. As an Athena maintainer, I want tests proving `ctx.channel.bot` reaches extension setup, so that the Koishi channel context behavior is preserved.
22. As an Athena maintainer, I want tests proving plugins await registration/unregistration, so that the ordering invariant is executable.
23. As an Athena maintainer, I want an implementation plan with narrow tasks and verification commands, so that this closure can be executed without reopening architectural decisions.

## Implementation Decisions

- `ExtensionAPI` is replaced by public `ExtensionContext`.
- `ExtensionDefinition.setup()` accepts `ExtensionContext`.
- This is a breaking change. No `ExtensionAPI` compatibility alias is kept.
- `ChannelContext` is replaced by public `Channel`.
- `Channel` carries only Koishi/platform concepts: platform, channel ID, channel type, and optional Koishi `Bot`.
- Agent/session/model capabilities are not placed on `Channel`.
- The existing extension capabilities currently on `ExtensionAPI` move onto `ExtensionContext` for this stage.
- Future extension API deepening should group agent/session/tool capabilities under subcontexts such as `ctx.session` and `ctx.tools`.
- `ExtensionHost` is removed as a public type and design concept.
- `ExtensionService.createChannelRuntime()` takes a single internal options object containing the `Channel`, `HookRunner`, `SessionManager`, tool snapshot apply callback, message callbacks, and existing context capability callbacks.
- The create-channel-runtime options type is not exported from core's public entrypoint.
- `ExtensionService` owns `ExtensionContext` construction during binding setup.
- Plugin `registerExtension()` and `unregisterExtension()` calls are awaited in workspace, MCP client, skill, and built-in chat-history.
- Awaiting registration/unregistration establishes ordering but does not change fail-open reload semantics.
- Callers log failed reload summaries and continue rather than throwing from plugin start/stop.
- `SessionManager.forkFrom()` no longer writes `cwd` in the new header.
- Existing old-header read compatibility remains unchanged.
- Stale documentation references to `ExtensionRunner`, `ExtensionRegistry`, old `ExtensionHost`, and old `ExtensionAPI` are corrected.
- `Athena Bot` is recorded as a second-stage candidate seam for adapter + delivery unification, but it is out of this PRD's implementation scope.

## Testing Decisions

- Tests should assert externally visible contracts and ordering guarantees, not private object names or incidental field layout.
- Core Extension Service tests should verify `setup(ctx)` receives an `ExtensionContext` with `ctx.channel.platform`, `ctx.channel.channelId`, `ctx.channel.type`, and `ctx.channel.bot`.
- Core Extension Service tests should verify setup-declared tools still become an atomic `Extension Tool Snapshot`.
- Core Extension Service tests should verify fail-open setup errors still aggregate while successful bindings remain active.
- Core entrypoint tests or package-boundary tests should verify `ExtensionContext` and `Channel` are exported, while `ExtensionAPI`, `ExtensionHost`, `ChannelContext`, `ExtensionRunner`, and `ExtensionRegistry` are not exported.
- Plugin tests should verify workspace, MCP client, skill, and chat-history await `registerExtension()`/`unregisterExtension()` and do not throw on failed reload summaries.
- Session header tests should verify `forkFrom()` writes a new header without `cwd`.
- Existing old-header tests should continue to verify old `cwd` headers are readable and appending does not rewrite them.
- Focused verification should run core extension tests, agent session-header tests, plugin type-checks, and package boundary tests before broader checks.

## Out of Scope

- Redesigning the full extension capability model.
- Moving existing methods into `ctx.session` or `ctx.tools`.
- Typed hook registration for plugin authors.
- `Athena Bot` implementation or adapter/delivery unification.
- Behavior decision routing for group chat.
- RuntimeService channel factory/router extraction.
- Session format reader extraction for chat-history.
- Dynamic runtime tool mutation.
- Model/provider refactors.
- Historical session file migration.

## Further Notes

No blocking ambiguity remains from the grill-with-docs discussion. Two follow-up design directions are recorded but intentionally excluded from this closure:

- `ExtensionContext` should later be deepened with child contexts such as `ctx.session` and `ctx.tools`.
- `Athena Bot` may become a second-stage bidirectional platform interaction seam that unifies adapter input normalization/formatting and delivery output formatting/failure consistency, without taking over behavior decision logic.
