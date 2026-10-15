# koishi-plugin-yesimbot

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- optional conversation participation retention (default off): inside the window after a successful reply, follow-up messages from the replied sender, messages that mention or quote the bot, and private messages receive a decaying willingness bonus, capped by `influence` and scoped per platform, bot and channel. It stays inside the reply-category and probability rules, clears on reset and pause expiry, and can be inspected read-only. (#205)
- reply control commands `chat.pause` / `chat.resume` / `chat.status` with durations or `permanent`, per-category `--allow` / `--block` lists (`text`, `at`, `quote`, `direct`, `system`, `scheduled`, `background`) and targeting by group, user, platform and bot account. (#200)
- `chat.decision` reply decision query: explains the latest reply decision of a channel with willingness, participation, suppression, mute and task state, gain, threshold, probability, roll, semantic assessment and scheduling result, without changing any state. (#206)
- opt-in decision journal (`decisionRecording`, default off): structured JSONL snapshots with count, byte and age limits, private directory and file permissions, a single-writer lock, version and corruption notices, and an offline replay script that recomputes decisions and compares threshold and amplifier scenarios against the original rolls. (#207, #225)
- context and usage inspection: `history.tokens` reports API and estimated local token usage per adapter, bot, provider, model and target with filters, paging and reset, and `history.context` shows history storage, memory blocks and the retained request snapshots. (#234, #240)
- per-model context capacity (a custom value such as `128K`, or `auto` discovery from provider metadata) that is reported in observations and never trims, compresses or clears memory on its own. (#240)
- full-text recall and diary commands `history.diary` and `history.recall` over raw messages, L2 summaries and L3 diaries, with source metadata, paging, per-day diary versions and count-based generation; selected text is kept verbatim instead of being truncated or summarized again. (#234, #239)
- `memory_recall`, `conversation_search` and `l3_diary_generate` tools exposing the same recall and diary actions to the bot.
- optional mention replies and experimental topic willingness (both default off): an explicit mention can start a reply decision directly, and topic willingness accumulates intent per topic from recent chat and falls back to the regular willingness logic on failure.
- experimental cross-context memory (default off): shared memory domains across groups, private chats and explicitly linked platform accounts, proactive recall of past experiences and L2/L3 summaries with source position and time, and `off` / `review` / `auto` modes for identity corrections with administrator pause, lock, correction and rollback.
- opt-in TypeSafe-based willingness assessment with configurable mode, API, model and influence (default off), and native tool calling that executes tools without replaying actions, plus a per-model option to disable native tool calls. (#194, #236)
- optional local debug log files with rotation. (#195)
- `memory_recall`, `conversation_search` and `l3_diary_generate` tools exposing the same recall and diary actions to the bot
- optional mention replies and experimental topic willingness (both default off): an explicit mention can start a reply decision directly, and topic willingness accumulates intent per topic from recent chat and falls back to the regular willingness logic on failure
- experimental cross-context memory (default off): shared memory domains across groups, private chats and explicitly linked platform accounts, proactive recall of past experiences and L2/L3 summaries with source position and time, and `off` / `review` / `auto` modes for identity corrections with administrator pause, lock, correction and rollback

### Changed
- **Breaking**: the sub-services are no longer separate Koishi services. The single `yesimbot` service owns them and exposes `ctx.yesimbot.logging`, `.asset`, `.prompt`, `.memory`, `.model`, `.world`, `.tool` and `.agent`; it constructs and starts them in dependency order and stops them in reverse on unload (internally the implementations moved from `src/services/*` to `src/{asset,extension,logger,memory,model,prompt,world}`).
- **Breaking**: extensions declare the `"yesimbot"` dependency instead of per-service dependencies (`@Extension` adds it automatically), read members from `ctx.yesimbot.<member>` at runtime, and import `Extension`, `Tool`, `Success`, `Failed` and `Infer` from the package root.
- configuration reorganized with preserved reload state, provider URL defaults following the provider type, and detailed error reporting opt-in with masked credentials. (#212)
- public `beforeUserStimulus` v1 and `trustedToolSession` v1 capabilities: extensions can detect them before registering side effects, prompt-injection registrations can be released, tool arguments no longer override the real session, and a pre-user-message event orders person recognition before inference. (#217)
- **Breaking**: the sub-services are no longer separate Koishi services. The single `yesimbot` service owns them and exposes `ctx.yesimbot.logging`, `.asset`, `.prompt`, `.memory`, `.model`, `.world`, `.tool` and `.agent`; it constructs and starts them in dependency order and stops them in reverse on unload (internally the implementations moved from `src/services/*` to `src/{asset,extension,logger,memory,model,prompt,world}`)
- **Breaking**: extensions declare the `"yesimbot"` dependency instead of per-service dependencies (`@Extension` adds it automatically), read members from `ctx.yesimbot.<member>` at runtime, and import `Extension`, `Tool`, `Success`, `Failed` and `Infer` from the package root

### Removed
- the `koishi-plugin-yesimbot/services` subpath export, the `Services` enum and the individual service registrations (`yesimbot.asset`, `yesimbot.tool`, `yesimbot.world-state` and friends). Third-party extensions written against the old core must move to `ctx.yesimbot` and the root imports.
- the `koishi-plugin-yesimbot/services` subpath export, the `Services` enum and the individual service registrations (`yesimbot.asset`, `yesimbot.tool`, `yesimbot.world-state` and friends). Third-party extensions written against the old core must move to `ctx.yesimbot` and the root imports

### Fixed
- memory and history: recall isolation, automatic injection budget and context consistency (#241); L2/L3 isolation and cleanup (#216); cleared history no longer gets old memories written back (#210) and the clear barrier holds (#221); L1 agent logs stay in their owning session when channel or platform names collide after normalization: history is filtered by raw ownership before tailing, legacy logs are read only when ownership is unambiguous, and a corrupt line no longer discards a whole batch (#218).
- streaming: responses that end without a completion signal are rejected before tool execution and enter the existing retry and fallback paths (#203); early stream ends are fixed and replies cancelled after an encoder's before-send hook are no longer sent on non-OneBot adapters, while regular commands, concurrent sessions and the adapter's original call context are preserved (#220); action replay and session scope on the legacy path (#202); forwarded messages and streaming placeholders (#235).
- replies and scheduling: pending replies are serialized so a message is no longer sent twice (#194); immediate replies after pause and resume (#211); command result attribution and reply cancellation (#223); end-marker compatibility and non-streaming request timeouts (#224); bot mute state and reply cancellation (#215).
- model handling: the original conversation is no longer lost when switching models (#208); provider circuit breakers are isolated with bounded recovery probes (#209); provider log identifiers are complete (#236).
- configuration and resources: configuration is validated and service resources are released on unload (#226); destination metadata is preserved and history is scoped by channel (#227); background retention cleanup runs as retryable standalone deletes, so a failed cleanup transaction no longer rolls back accepted person commits or core messages (#217).
- memory and history: recall isolation, automatic injection budget and context consistency (#241); L2/L3 isolation and cleanup (#216); cleared history no longer gets old memories written back (#210) and the clear barrier holds (#221); L1 agent logs stay in their owning session when channel or platform names collide after normalization: history is filtered by raw ownership before tailing, legacy logs are read only when ownership is unambiguous, and a corrupt line no longer discards a whole batch (#218)
- streaming: responses that end without a completion signal are rejected before tool execution and enter the existing retry and fallback paths (#203); early stream ends are fixed and replies cancelled after an encoder's before-send hook are no longer sent on non-OneBot adapters, while regular commands, concurrent sessions and the adapter's original call context are preserved (#220); action replay and session scope on the legacy path (#202); forwarded messages and streaming placeholders (#235)
- replies and scheduling: pending replies are serialized so a message is no longer sent twice (#194); immediate replies after pause and resume (#211); command result attribution and reply cancellation (#223); end-marker compatibility and non-streaming request timeouts (#224); bot mute state and reply cancellation (#215)
- model handling: the original conversation is no longer lost when switching models (#208); provider circuit breakers are isolated with bounded recovery probes (#209); provider log identifiers are complete (#236)
- configuration and resources: configuration is validated and service resources are released on unload (#226); destination metadata is preserved and history is scoped by channel (#227); background retention cleanup runs as retryable standalone deletes, so a failed cleanup transaction no longer rolls back accepted person commits or core messages (#217)

### Security
- remote error reports and local logs share credential redaction; reports upload a technical summary and omit conversation text, raw model responses and free-form error messages, while request IDs, error codes and stream diagnostics remain available; nested errors and circular references are handled, and local diagnostics keep working when remote reporting is disabled. (#219, #225)
## [3.0.2] - 2025-09-15

### Fixed

- context handling exceptions are caught, blank lines are filtered when reading logs, and log length limits with periodic history cleanup were added. ([#152](https://github.com/YesWeAreBot/YesImBot/issues/152))
- channels that receive replies accept a user ID directly.

### Changed

- logging no longer depends on a standalone Logger service.
- the TTS adapter's stop logic and temporary directory handling were reworked.
- daily-planner dropped unneeded dependencies and its structure was cleaned up.

## [3.0.1] - 2025-09-08

### Fixed

- the config migration script.

## [3.0.0] - 2025-09-07

### Added

- streaming heartbeat processing with real-time action parsing and execution.

### Changed

- screenshots moved to puppeteer and image handling to `koishi-plugin-sharp`.
- versions are managed with changesets.
