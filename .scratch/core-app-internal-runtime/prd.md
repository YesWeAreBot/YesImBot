---
labels: [ready-for-agent]
status: open
assignee: MiaowFISH
---

# PRD: Core App Internal Runtime Modules

## Problem Statement

Athena core currently models too many implementation modules as Koishi Services. `RuntimeService`, `SessionService`, and `AthenaBotService` are loaded through `ctx.plugin()` even though they are not stable cross-plugin contracts. `ExtensionService` also mixes the public extension registration surface with internal per-channel runtime lifecycle. This makes the Koishi service graph larger than the real plugin contract, spreads runtime wiring across `ctx["yesimbot.*"]` lookups, and encourages future code to expose internal modules through Koishi Context when object composition would be simpler.

The current file layout mirrors that confusion. `core/src/bot` contains both global event intake and per-channel Athena Bot behavior; `core/src/runtime` owns bot construction, session construction, extension runtime construction, and delivery helpers; `core/src/services/session` is a file-backed internal store but appears as a Koishi Service.

## Solution

Introduce a `Core App` composition root inside `koishi-plugin-yesimbot`. Core App is loaded as a Koishi child plugin so it can declare `inject` and safely access `ctx["yesimbot.model"]` and `ctx["yesimbot.extension"]`, but it is not a Koishi Service and does not provide a `ctx["yesimbot.*"]` service. The plugin entry will keep only real cross-plugin Koishi Services and then load Core App as the internal runtime child plugin. `ModelService` remains a Koishi Service because provider packages need to register model backends. `ExtensionService` remains a thin Koishi Service because external plugins need to register `ExtensionDefinition` objects. Runtime orchestration, session storage, bot event intake, per-channel extension setup, and delivery utilities become internal modules owned by Core App.

The refactor should preserve behavior while changing ownership and loading mechanics. Existing public extension contracts should remain available. Compatibility exports can be kept temporarily where useful, but new code should import from the Core App/internal module structure rather than treating internal modules as Koishi Services.

## User Stories

1. As an Athena maintainer, I want only true cross-plugin contracts to be Koishi Services, so that the Koishi service graph reflects real plugin boundaries.
2. As an Athena maintainer, I want `RuntimeService` replaced by an internal Runtime Controller, so that runtime orchestration is not exposed through `ctx["yesimbot.runtime"]`.
3. As an Athena maintainer, I want `SessionService` replaced by an internal Session Store, so that file-backed session state is managed through explicit object references.
4. As an Athena maintainer, I want `AthenaBotService` replaced by a Bot Module, so that Koishi event intake and per-channel Athena Bot construction are internal core responsibilities.
5. As an extension author, I want `ctx["yesimbot.extension"].registerExtension()` to keep working, so that existing extension plugins remain able to register definitions.
6. As a provider author, I want `ctx["yesimbot.model"].register()` to keep working, so that model providers remain decoupled from core internals.
7. As an Athena maintainer, I want Extension Service to stop owning per-channel setup and cleanup, so that extension lifecycle is managed in the internal runtime layer.
8. As an Athena maintainer, I want an Extension Runtime Manager to own per-channel extension setup, cleanup, reload, hook installation, speak element installation, and tool snapshot publication.
9. As an Athena maintainer, I want Core App to be loaded as a Koishi child plugin with `inject`, so that it can safely consume public services without becoming a public service itself.
10. As an Athena maintainer, I want Core App to control shutdown order, so that channel runtimes, extension bindings, bot listeners, and session resources are disposed predictably.
11. As an Athena maintainer, I want Runtime Controller to receive dependencies by constructor/object reference, so that runtime code no longer reads internal modules from `ctx["yesimbot.*"]`.
12. As an Athena maintainer, I want session rotation to use an internal callback or event channel, so that `session:new` no longer needs Koishi Events declaration merging.
13. As an Athena maintainer, I want Bot Module to own Event Observer registration and source listeners, so that event intake remains separate from Athena Bot send/presentation behavior.
14. As an Athena maintainer, I want Athena Bot to remain a per-channel object, so that it can focus on presentation, Speak Markup compilation, platform send, and send anomaly persistence.
15. As an Athena maintainer, I want Event Observer normalization to stay independent of behavior policy, so that platform event shape differences do not decide whether Athena replies.
16. As an Athena maintainer, I want Channel Runtime to retain Event Intake behavior, so that AthenaEvent persistence and turn triggering remain testable through one focused interface.
17. As an Athena maintainer, I want delivery timing, segmentation, event, random, and settings types consolidated when practical, so that pure utility code does not create unnecessary directory depth.
18. As an Athena maintainer, I want bot internals consolidated into fewer deeper modules, so that readers do not jump through many shallow files to understand one interaction path.
19. As an Athena maintainer, I want root plugin configuration to remain the single user-facing configuration surface, so that this refactor does not introduce new user configuration layers.
20. As an Athena maintainer, I want compatibility exports during migration, so that tests and plugin imports can be moved in controlled steps.
21. As an Athena maintainer, I want public extension types to avoid depending on bot internal files, so that public contracts do not expose internal layout.
22. As an Athena maintainer, I want existing behavior tests preserved and redirected, so that the refactor proves behavior did not change.
23. As an Athena maintainer, I want the new terms reflected in domain docs and ADRs, so that future agents do not reintroduce internal Koishi Services.
24. As an Athena maintainer, I want implementation to proceed in small migration slices, so that each stage can be verified independently.

## Implementation Decisions

- `Core App` is the internal composition root for `koishi-plugin-yesimbot` and is loaded as a Koishi child plugin.
- `Core App` declares `inject` for the public services it consumes, initially `yesimbot.model` and `yesimbot.extension`.
- `Core App` is not a Koishi Service and does not call `super(ctx, "yesimbot.*")`.
- `Koishi Service` is reserved for cross-plugin `ctx["yesimbot.*"]` contracts.
- `ModelService` remains a Koishi Service.
- `ExtensionService` remains a Koishi Service, but is narrowed to a public extension definition registry and notification surface.
- `RuntimeService` becomes `Runtime Controller`, an internal module owned by Core App.
- `SessionService` becomes `Session Store`, an internal module owned by Core App.
- `AthenaBotService` becomes `Bot Module`, an internal module owned by Core App.
- `Extension Runtime Manager` becomes the owner of per-channel extension setup, cleanup, reload, hook installation, speak element installation, and tool snapshot publication.
- `Extension Service` no longer creates per-channel runtimes directly.
- Runtime Controller receives `modelService`, `extensionRegistry`, `sessionStore`, `botModule`, and `extensionRuntimeManager` as object references from Core App.
- Session rotation should move from Koishi `session:new` event declaration to internal callback or subscription owned by Core App.
- Bot Module owns Koishi middleware/event listeners, Event Observer registration, Channel Assignee checks, Koishi Bot resolution, and observed-event publication to Runtime Controller.
- Athena Bot remains per-channel and owns event presentation, Speak Markup compilation, platform sends, and speak anomaly persistence.
- Channel Runtime keeps Event Intake: AthenaEvent persistence, trigger decision handoff, origin session queueing, and assistant output routing.
- Delivery helpers should be consolidated into a deeper utility module unless a file remains independently valuable for testing or public compatibility.
- Bot internals should prefer fewer domain-named modules such as bot, module, events, presentation, and speak instead of many mechanical registry/observer/presenter files.
- Existing public extension contract names should remain aligned with `Extension Context`, `Channel`, `Extension Tool Snapshot`, `Speak Element`, and `Speak Markup`.
- Compatibility exports may remain temporarily, but new imports should move toward the new internal structure.
- No new framework or dependency injection container will be introduced.

## Testing Decisions

- Tests should verify external behavior and module contracts, not private file layout.
- Core App tests should verify startup order, shutdown order, and that internal modules are started/stopped exactly once.
- Extension Service tests should verify external registration/unregistration behavior and that definition changes notify the internal runtime layer.
- Extension Runtime Manager tests should cover per-channel setup, cleanup, reload, hook installation, tool snapshot publication, and speak element disposal.
- Runtime Controller tests should cover observed event handling, session creation/replacement, channel runtime creation, extension runtime wiring, and disposal.
- Session Store tests should cover channel directory resolution, metadata creation/update, channel map persistence, new session rotation, and assignee persistence.
- Bot Module tests should cover observer registration, priority order, source listener lifecycle, assignee filtering, Koishi Bot resolution, and observed-event publication.
- Athena Bot tests should continue covering presentation, Speak Markup compilation, send fallback, origin session sending, and anomaly persistence.
- Channel Runtime tests should continue covering persistence, trigger decisions, serialized fallback details, origin session queueing, and assistant output routing.
- Public API tests should cover compatibility exports during the migration and final public exports after compatibility removal.
- Use focused core package commands first, then package type-check and build after each migration stage.

## Out of Scope

- Changing user-facing runtime behavior.
- Redesigning the Extension Context capability model beyond the ownership split.
- Removing existing external extension plugins.
- Changing provider registration semantics.
- Changing session file format or migrating historical session files.
- Rewriting BehaviorPolicy or willingness scoring.
- Introducing a dependency injection framework.
- Moving logic into `@yesimbot/agent`.
- Repo-wide formatting or unrelated cleanup.

## Further Notes

This PRD follows the terminology updated in `CONTEXT.md` and the architecture decision recorded in ADR 0003. ADR 0001 and ADR 0002 remain historically accurate for earlier phases, but this PRD refines ownership by separating public Koishi Services from internal runtime modules.

The preferred migration shape is incremental: create Core App and internal modules first, keep compatibility exports, move one owner at a time, then remove obsolete Koishi service declarations only after tests prove behavior parity.
