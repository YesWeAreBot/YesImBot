---
labels: [ready-for-agent]
status: open
assignee: MiaowFISH
---

# PRD: Athena Bot Interaction Layer

## Problem Statement

Athena currently splits platform interaction across adapter and delivery code, but neither seam is a satisfying long-term owner for how the agent interacts with Koishi channels. The adapter side receives Koishi sessions, normalizes them into `AthenaEvent`, provides event formatting, exposes an unused capability bag, and also owns `submitMessage()`. The delivery side sends assistant text back to the platform, handles segmentation and timing, and records failures. `RuntimeService` then wires both together and still owns event formatting, persistence, turn triggering, and assistant output delivery.

This creates a growth risk. Future group-chat behavior, message elements, sticker-like expressive output, platform-specific message capabilities, output failure consistency, and extension-facing interaction APIs all have unclear homes. Continuing to extend the current adapter/delivery split would likely produce a wider `PlatformAdapter`, a heavier `Delivery`, and a larger `RuntimeService` handler.

Athena needs a cleaner interaction seam that sits above Koishi `Bot`/`Session` and below agent behavior policy. This seam should unify platform interaction without replacing Koishi's own adapter and message encoder layers, and without absorbing group-chat behavior decision logic.

## Solution

Introduce **Athena Bot** as Athena's agent-to-platform interaction seam. Athena Bot is an Interaction Bot, not a Koishi `Bot` and not a behavior decision module. It owns Koishi event observation intake, presents platform events to the agent, speaks back to the platform, and exposes registered speak elements to the model and extensions.

Athena Bot is structured as a global service plus per-channel runtime. The global service owns Koishi integration, the event observer registry, listener installation, and channel runtime lookup. Each channel runtime owns a per-channel Athena Bot instance, alongside `AgentSession`, Hook Runner, Extension channel runtime, settings, and event intake rules.

The first version should keep the public interface small:

- registered event observers convert Koishi event inputs into typed `AthenaEvent` values.
- `present(event)` converts an `AthenaEvent` into a lightweight `BotPresentation`.
- `speak(content, options)` sends assistant output to the platform, prioritizing `session.send()` when an origin interaction session is available.
- `ctx.bot.registerSpeakElement()` lets extensions register model-visible XML-style speak elements.

Athena Bot should not decide whether Athena should respond, stay silent, delay, follow up, or upgrade to LLM judgment. Those decisions belong to future core application policy, tentatively called `BehaviorPolicy`. The first version keeps event intake as an internal Channel Runtime responsibility rather than forcing an independent router module.

## User Stories

1. As an Athena maintainer, I want a named Athena Bot interaction seam, so that adapter input formatting and delivery output behavior stop growing in separate directions.
2. As an Athena maintainer, I want Athena Bot to be distinct from Koishi `Bot`, so that platform SDK access is not confused with Athena's agent interaction contract.
3. As an Athena maintainer, I want Athena Bot to sit above Koishi `Session` and `Bot`, so that Athena does not reimplement Koishi adapters or message encoders.
4. As an Athena maintainer, I want Athena Bot event observation to be driven by registered Koishi event observers, so that platform-specific event names and structures do not become hardcoded `session.type` branches.
5. As an Athena maintainer, I want platform-specific observers to inspect Koishi callback arguments and optional Koishi `Session` objects, so that Athena can handle platform-specific information without exposing raw platform events broadly.
6. As an Athena maintainer, I want only serializable event snapshots to be persisted, so that raw Koishi `Session` objects do not leak into session files or extension APIs.
7. As an Athena maintainer, I want messages and non-message Koishi events to use the same observer registry model, so that middleware sessions and `ctx.on(eventName)` events can share priority, fallback, and normalization rules.
8. As a Koishi plugin user, I want Athena's message middleware to call `next()` by default, so that Athena observes messages without breaking other Koishi middleware.
9. As an Athena deployer, I want a configurable consume mode, so that selected channels can let Athena consume messages without passing them to later Koishi middleware.
10. As an Athena maintainer, I want typed `AthenaEvent` payloads to be based on an extensible event map, so that `kind` and `payload` stay type-aligned while plugins can extend event kinds through declaration merging.
11. As an extension author, I want to extend `AthenaEventMap`, so that platform or plugin event kinds can have strong payload types.
12. As an Athena maintainer, I want `present(event)` to return a `BotPresentation`, so that LLM-visible content and structured event metadata are separated.
13. As a chat-history feature, I want structured sender, source, message ID, and original content metadata preserved in custom message details, so that history search and later memory can rely on structured data.
14. As an Athena maintainer, I want `BotPresentation.content` to be the agent-readable content, so that the LLM sees a clear text or multimodal representation.
15. As an Athena maintainer, I want `BotPresentation.details` to preserve the serializable event snapshot, so that metadata is retained without polluting the LLM prompt.
16. As an Athena maintainer, I want `BotPresentation.visible` to map to custom message display behavior, so that event entries can be shown or hidden consistently.
17. As an Athena maintainer, I want `BotPresentation.text` to be optional, so that low-cost rules, logs, and indexes can use a plain text summary without changing LLM-visible content.
18. As an Athena maintainer, I want base presenters and decorators to be separate concepts, so that every event kind has one clear base presentation while future extensions can enhance presentations deliberately.
19. As an Athena maintainer, I want the first version to implement or design only base presenter behavior, so that presenter decorators do not make the initial scope too large.
20. As an Athena maintainer, I want `speak()` to prioritize `session.send()`, so that passive-platform reply semantics remain reliable.
21. As an Athena maintainer, I want `speak()` to fall back to `bot.sendMessage()` only when no valid origin session is available, so that active sending remains possible without weakening the default path.
22. As an Athena maintainer, I want model output to remain text by default, so that the model is not required to emit structured JSON or full Koishi element trees.
23. As an Athena maintainer, I want `speak()` to accept Koishi `Fragment` from code paths, so that extensions and internal logic can send rich platform messages without reinventing message encoding.
24. As a model prompt author, I want a controlled Speak Markup subset, so that the model can use a few XML-style message elements naturally in final text.
25. As an Athena maintainer, I want `<sep/>` to be the only first-version core built-in speak element, so that core owns speech segmentation without absorbing platform-specific expression features.
26. As an extension author, I want to register speak elements such as `<sticker name="..."/>`, so that expressive output can be added without forcing tool calls.
27. As an extension author, I want speak element transforms to output Koishi standard or platform extension elements, so that I can use Koishi's message element ecosystem instead of inventing another message protocol.
28. As an Athena maintainer, I want unknown or unregistered model output tags to be escaped as plain text, so that the model cannot bypass Athena's speak element whitelist.
29. As an Athena maintainer, I want `<sep/>` to participate in the same parse flow as other speak elements, so that speech segmentation is handled consistently.
30. As an Athena maintainer, I want speak output to be parsed and transformed before splitting by `<sep/>`, so that registered elements and segmentation share one processing model.
31. As an Athena maintainer, I want transform functions to own local fallback behavior, so that each extension can decide how to degrade missing resources or unavailable stickers.
32. As an Athena maintainer, I want unhandled transform and sending anomalies to be persisted as non-LLM custom entries, so that failures are auditable without contaminating the model context.
33. As a system prompt maintainer, I want speak elements to appear in a dedicated Message Elements section, so that the model understands these are final-message markup and not tools.
34. As a system prompt maintainer, I want tools and speak elements to be described separately, so that the model does not mistake message elements for tool calls.
35. As an Athena maintainer, I want speak element availability to follow extension/channel runtime lifecycle, so that unloading an extension removes its model-visible elements.
36. As an Athena maintainer, I want no first-version active speak element allowlist, so that the initial design does not duplicate active tool state.
37. As an extension author, I want `ctx.bot.registerSpeakElement()` on the Extension Context, so that extensions can contribute output expression capabilities through a stable Athena Bot interface.
38. As an Athena maintainer, I want first-version extension-facing `ctx.bot` to expose only speak element registration, so that it does not become another broad host capability bag.
39. As an Athena maintainer, I want `ctx.sendMessage` to remain distinct from platform sending, so that adding a custom message to `AgentSession` is not confused with sending a message to the chat platform.
40. As an Athena maintainer, I want Athena Bot to be created by the Channel Runtime Factory, so that it is a peer of `AgentSession` and not contained by it.
41. As an Athena maintainer, I want event intake to be a Channel Runtime internal responsibility in the first version, so that runtime rules can be named without prematurely creating a large router module.
42. As an Athena maintainer, I want future group-chat behavior decisions to belong to a core application policy, so that Athena Bot, `AgentSession`, Koishi adapters, and `RuntimeService` do not absorb social behavior logic.
43. As an Athena maintainer, I want `RuntimeService` to stop directly knowing about formatter and delivery details, so that it can move toward Koishi service wiring.
44. As an Athena maintainer, I want assistant output subscription to call Athena Bot speech behavior, so that delivery failure consistency remains attached to the platform interaction seam.
45. As an Athena maintainer, I want quote markup to be out of first-version scope, so that message ID and quote semantics can be designed later when message ID handling is stable.
46. As an Athena maintainer, I want `<at>` and `<img>` to be extension-provided or built-in-extension-provided rather than core Bot features, so that core does not grow a catalog of platform expression elements.
47. As an Athena maintainer, I want this PRD to avoid a full behavior decision model, so that the next implementation stage stays focused on the interaction seam.

## Implementation Decisions

- Athena Bot is adopted as a formal domain concept for Athena's agent-to-platform interaction seam.
- Athena Bot is an Interaction Bot. It is not Koishi `Bot`, not a raw adapter, not a delivery-only sender, and not a group-chat behavior decision module.
- The design uses a global service plus per-channel Athena Bot runtime.
- The per-channel Athena Bot is created as part of Channel Runtime construction and is a peer of `AgentSession`.
- Koishi adapters remain responsible for raw platform protocol integration. Athena Bot does not receive raw platform events directly.
- `AthenaBot.observe()` should not be treated as an external extension point.
- `AthenaBot.observe()` and related normalization methods should be removed rather than kept as public or internal observer helpers. Existing built-in normalization should move into core fallback observers.
- The Athena Bot global service owns the event observer registry and dynamically installs Koishi message middleware and Koishi event listeners from registered observer sources.
- Event observers have global service lifecycle because they must be able to observe the first event that creates a channel runtime.
- Channel-specific configuration can affect whether an observer handler produces, passes, or drops an event, but it should not require per-channel listener registration.
- Platform integrations register event observers through the Koishi service API on the Athena Bot global service.
- The existing Athena Extension Context should not register event observers because it is per-channel lifecycle, while event observers are global lifecycle.
- Core fallback observers are registered when AthenaBotService starts.
- Message middleware is one observer source kind, not a permanently separate hardcoded path.
- Most non-message observation uses Koishi `ctx.on(eventName)` sources. If a platform plugin needs an extra source, it can adapt that source into a Koishi event before Athena observes it.
- First-version source matching is limited to source kind and Koishi event name. Platform filtering belongs in observer handlers via pass/drop, not in source matching.
- Observer handlers receive event input data such as source kind, event name, optional Koishi `Session`, optional input `selfId`, and raw Koishi callback arguments. They should not receive the full Koishi `Context` through the handler input.
- Handler input `selfId` means the bot account associated with the current Koishi input. Channel metadata `assignee` means the channel's Koishi assignee and should not be conflated with input `selfId`.
- Observer handlers are pure normalization boundaries: they return HandleResult and do not receive ChannelRuntime, AgentSession, or event emit helpers.
- Observer handlers return a typed handle result rather than a bare nullable event.
- A handle result can produce an event, pass to lower-priority observers, or drop an input that should not be normalized. The first version does not need reason/details/log-level fields on HandleResult.
- HandleResult should not control Koishi middleware continuation.
- Drop is an observation/normalization result only. It must not encode behavior decisions such as whether Athena should respond, stay silent, delay, follow up, or escalate to LLM judgment.
- Drop should be logged or diagnosed at the observation layer and should not enter AgentSession by default.
- Unhandled observer exceptions are registry errors and stop processing the current input. They should be logged with observer name and source.
- Fallback is explicit: a handler that wants lower-priority observers to try the same input must return pass rather than throw.
- The observer registry should use structured logs for observer name, source, result, and errors so platform event routing can be diagnosed without adding metrics in the first version.
- One Koishi event input maps to at most one AthenaEvent. If a platform needs multiple Athena events, it should emit multiple Koishi events.
- Any AthenaEvent that enters ChannelRuntime must carry complete source identity, including platform, channelId, conversation type, and the relevant bot identity when known. Inputs without enough channel identity should be dropped at the observation layer.
- AthenaEvent source is the right place to record Koishi bot identity because it describes how Athena observed the platform event.
- `AthenaEvent.source.selfId` should record the bot account associated with the accepted observation when known. Channel `assignee` remains routing/gating state and does not need to be persisted on every event.
- Observed events do not require a Koishi Session if the observer can still produce a complete AthenaEvent.
- Creating a new channel runtime still requires a Koishi Bot. For Session-backed inputs this can come from `session.bot`; for non-Session inputs the Athena Bot service bridge may resolve a bot from Koishi `ctx.bots` by platform.
- Channel `meta.json` can record Koishi's channel assignee as `assignee`, using the assignee bot's `selfId`, to resolve the responsible bot for non-Session events.
- Bot resolution should prefer the bot that actually received a Session-backed input, then any explicit observer-provided assignee/selfId, then Koishi channel assignee if available, then channel `meta.json.assignee`, then a single unambiguous bot for the platform.
- If multiple bot candidates exist and no assignee/selfId resolves the choice, the service should drop/log the input as ambiguous rather than guessing.
- Channel `meta.json.assignee` should be filled during bootstrap when missing, but ordinary Session-backed events should not overwrite an existing assignee. Assignee changes should come from an explicit management path or Koishi assignee state.
- AthenaBotService should apply assignee gating as event-intake de-duplication: when both input selfId and resolved channel assignee are known and differ, the input should be dropped before it becomes an AthenaEvent.
- Assignee gating can be two-stage. Session-backed inputs with known channel identity can be gated before observer handling; custom event inputs whose channel identity is only known after normalization can be gated after an observer produces an AthenaEvent.
- Assignee gating is not a response policy. It only prevents duplicate or wrong-bot observation in multi-bot Koishi deployments.
- If a target channel runtime already exists, non-Session events can enter it using their AthenaEvent channel identity without requiring an origin Session.
- When multiple observers match the same source, higher-priority platform observers run before lower-priority core defaults; the first produced event wins.
- Observer ordering can use a plain numeric priority. Platform observers use higher priority values than core fallback observers.
- Observer names are unique stable identities for lifecycle, diagnostics, and error reporting.
- Observer sources can be shared by multiple observers. Platform-specific behavior overrides default behavior by registering the same source with a higher priority, not by replacing an observer with the same name.
- AthenaBotService should manage listener lifecycle per source: install a listener when the first observer for a source is registered, and dispose it when the last observer for that source is removed.
- Observers are removed through explicit `unregisterObserver(name)`, which platform Koishi plugins can call during plugin unload.
- Core default observers are fallback observers.
- Core can keep fallback observers for the current built-in sources to validate the registry model: message middleware, `message-deleted`, `reaction-added`, `reaction-removed`, `guild-member-added`, and `guild-member-removed`.
- These built-in sources are compatibility fallbacks and proof points for the observer registry, not a claim that every platform uses those exact event names or event structures.
- Raw Koishi `Session` may be held only in current interaction context for `session.send()` and must not be persisted or exposed broadly.
- Raw origin Session belongs to observed-event dispatch context, not AthenaEvent metadata. ChannelRuntime should receive AthenaEvent plus runtime context such as originSession.
- ChannelRuntime event context should initially contain only `originSession?`; observer names and source diagnostics belong to the observer registry logs, not Event Intake.
- The message path uses Koishi middleware for message sessions and Koishi events for non-message events.
- Message middleware defaults to observing and then calling `next()`.
- A future configuration can make Athena consume messages in selected channels or modes.
- Message middleware continuation remains an AthenaBotService concern controlled by consume configuration, not by individual observer handlers.
- `AthenaEvent` should move toward an extensible event map, allowing declaration merging while keeping `kind` and `payload` aligned.
- Platform observers should prefer cross-platform AthenaEvent kinds and put platform-specific data into payload extension fields or structured details when that preserves the event meaning.
- Platform-specific event kinds should be added only when no existing core kind represents the event semantics, and they must be paired with a presenter.
- `BotPresentation` is the result of presenting an `AthenaEvent` before it enters `AgentSession`.
- `BotPresentation` carries visible/display intent, LLM-visible content, optional plain text summary, and structured details.
- `BotPresentation.details` should normally contain the serializable event snapshot and preserve sender, source, message ID, original content, quote metadata when available, and other event metadata.
- `BotPresentation` maps to `AgentSession.sendCustomMessage()` as a `custom_message` entry with `customType: "athena:event"`.
- `content` is what enters LLM context; `details` is structured metadata not sent to the LLM by default.
- Presenter registration follows a base presenter plus optional decorator model. The first version can implement only base presenters.
- One event kind has one clear base presenter. Replacing the hidden "last formatter wins" behavior is part of the design goal.
- Observer registration should be paired with a presenter for the produced AthenaEvent kind so new platform event kinds remain presentable when they enter AgentSession.
- Observer registration should fail if it declares a produced event kind that has no registered or bundled presenter.
- An observer may declare multiple possible `eventKinds`; registration should validate presenter coverage for every declared kind.
- `speak()` is the Athena Bot method for sending assistant output to the platform.
- `speak()` prioritizes `session.send()` from the current interaction context.
- `speak()` falls back to Koishi `bot.sendMessage()` only when there is no usable origin session.
- `speak()` accepts normal model text and can accept Koishi `Fragment` from code paths.
- The model is not required to output full Koishi structure. It may output controlled XML-style Speak Markup in final message text.
- Speak Markup is a whitelisted subset, not arbitrary Koishi element passthrough.
- First-version core built-in Speak Markup contains only `<sep/>`.
- `<sep/>` is Athena's speech segmentation marker and is always available.
- `<quote>` is out of first-version scope.
- `<at>`, `<img>`, `<sticker>`, and similar elements are registered through speak element capability providers, including future built-in extensions if desired.
- Unknown or unregistered XML-style tags are escaped as plain text and are not passed through to Koishi.
- The speak pipeline parses model output, upgrades registered speak elements, transforms them, and then splits by `<sep/>`.
- Empty speech segments are discarded.
- Each speech segment is sent separately, with natural delay behavior retained as part of `speak()`.
- Speak element transforms are extension-owned. They return Koishi `Fragment` and can internally degrade missing or unavailable resources.
- Athena Bot catches unhandled transform errors and sending failures.
- Speak anomalies are persisted as non-LLM custom entries, not as LLM-visible custom messages.
- Speak elements are collected into a dedicated system prompt section, separate from tools.
- Speak elements follow extension/channel runtime lifecycle and have no first-version active allowlist.
- Extensions register speak elements through `ctx.bot.registerSpeakElement()`.
- First-version `ctx.bot` exposes only speak element registration.
- `ctx.sendMessage` remains an AgentSession custom-message API and must not be described as sending platform messages.
- Event intake is a named responsibility but does not need to be a standalone Router module in the first version.
- Event intake lives inside Channel Runtime initially and handles `AthenaEvent + BotPresentation` entering `AgentSession`.
- Future `BehaviorPolicy` owns whether Athena responds, stays silent, delays, follows up, or escalates to LLM judgment.
- `RuntimeService` should move toward creating or retrieving channel runtimes and dispatching Koishi events, rather than formatting events or delivering assistant output itself.
- Dispatching a produced AthenaEvent to ChannelRuntime remains service bridge responsibility outside observer handlers.
- AthenaBotService should publish observed events to subscribers rather than expose a raw Session handler. RuntimeService subscribes to observed events and dispatches them to channel runtimes.
- The first-version observed-event subscription should allow only one subscriber to avoid duplicate ChannelRuntime dispatch side effects.
- The observed-event handoff should carry the produced AthenaEvent plus dispatch context such as the resolved Koishi Bot and optional origin Session. Raw Koishi input should not be handed back to RuntimeService for normalization.
- RuntimeService should not call per-channel Athena Bot observe logic. It should create or retrieve ChannelRuntime from observed event source identity and dispatch the event.
- Allowed-channel policy should remain in ChannelRuntime/Event Intake, not in observer matching or observer dispatch. Observers normalize events; Event Intake decides persistence and turn triggering under deployment policy.
- Non-Session events that trigger a turn can use the normal speak fallback path without an origin Session.

## Testing Decisions

- Tests should assert Athena Bot external behavior and persisted contracts, not private helper names.
- Observe tests should verify Koishi message sessions convert to typed `AthenaEvent` snapshots without persisting raw `Session`.
- Observe tests should cover message middleware default continuation behavior and configurable consume behavior.
- Event map tests should verify built-in event kinds infer the correct payload types and that declaration merging can extend the event map.
- Presentation tests should verify a chat message event becomes a `BotPresentation` with LLM-visible content and structured details.
- Session integration tests should verify `BotPresentation` entries persist as `custom_message` entries with `customType: "athena:event"` and metadata preserved in `details`.
- Presenter tests should verify duplicate base presenters do not silently become hidden last-wins overrides.
- Speak tests should verify plain model text is sent through `session.send()` when an origin session exists.
- Speak tests should verify fallback to `bot.sendMessage()` when no origin session is available.
- Speak tests should verify `<sep/>` produces multiple speech segments with empty segments dropped.
- Speak tests should verify unregistered tags are escaped as plain text.
- Speak element tests should verify an extension-registered element can transform to a Koishi `Fragment`.
- Speak element lifecycle tests should verify registered elements appear in the prompt context only while the extension channel runtime is active.
- Speak anomaly tests should verify transform failures and send failures write non-LLM custom entries.
- System prompt tests should verify speak elements appear in a dedicated Message Elements section and do not appear as tools.
- Channel Runtime tests should verify assistant output subscription calls Athena Bot speech behavior rather than direct delivery wiring.
- RuntimeService tests should verify first message flow creates a channel runtime and extension setup completes before event intake uses channel capabilities.

## Out of Scope

- A full group-chat behavior decision model.
- LLM escalation rules for deciding whether to respond.
- Long-term memory design.
- Quote markup and arbitrary message ID resolution.
- A general-purpose platform capability registry.
- Active speak element allowlists or per-element runtime enablement.
- Full presenter decorator implementation if a base-presenter-only first version is sufficient.
- Replacing Koishi adapters or Koishi MessageEncoder.
- Exposing raw Koishi `Session` to extensions.
- Turning `ctx.bot` into a broad platform host API.
- Renaming or restructuring all existing extension context capabilities beyond the minimal `ctx.bot.registerSpeakElement()` addition.
- Dynamic tool mutation.
- Session format reader extraction for chat-history.

## Further Notes

This PRD intentionally narrows the earlier architecture-review recommendation. The first version does not need a standalone Athena Event Router module. It does need a named Event Intake responsibility so that current `RuntimeService` handler behavior can move into Channel Runtime without becoming behavior decision logic.

The first behavior-policy seam is conceptual only. Behavior decisions will later consume normalized events, channel state, lightweight rules, and optional LLM judgment, but this PRD keeps that work out of scope.

Koishi documentation strongly affects this design. Koishi already separates platform protocol receiving through adapters and sending through Bot/MessageEncoder. Athena Bot should build on those primitives rather than replacing them.
