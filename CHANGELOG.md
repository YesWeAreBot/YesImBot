# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Boundary**: Hard-removed `koishi-plugin-yesimbot/services/*` package exports; plugin authoring now uses `@yesimbot/plugin-sdk/tools`, `@yesimbot/plugin-sdk/hooks`, and `@yesimbot/plugin-sdk/skills`
- **Runtime**: Narrowed `core/src/services/plugin` barrel to runtime-facing exports and removed authoring decorator re-exports

## [4.0.0-beta.5] - 2026-03-17

### Added

- **Skill**: Standardized skill model with explicit `loadSkill()` hook support and LLM-driven activation
- **Skill**: Skill discovery and reload API with minimal contract
- **Skill**: Session state projection with `persistentRoster` and `loadHistory` support
- **Prompt**: Tool prompt reorganization separating static protocol from dynamic tool checklist
- **Prompt**: XML skill catalog with loaded markers
- **Prompt**: POLICY fragment for heartbeat wake-up strategy guidance
- **Arousal**: Structured heartbeat observability logs
- **Arousal**: Heartbeat timeline visible markers with trace ID prefix differentiation
- **Config**: Nine-group configuration layout with numeric constraints and step values
- **Config**: Complete zh-CN and en-US locale coverage
- **Config**: Enhanced schema descriptions for `fallbackChain` and `summaryModel`
- **Runtime**: Preserved `send_message` metadata and action parameters
- **Runtime**: Full-chain `debugLevel` propagation
- **Test**: Prompt regression test suite with deterministic snapshot validation

### Changed

- **Prompt**: Renamed role fragment source and service to Persona
- **Hook**: Removed message hook interception, keeping only tool and agent hooks
- **Skill**: Skill registry shifted to catalog-only posture
- **Skill**: Removed legacy mechanism fields: `conditions`, `lifecycle`, `effects`
- **Runtime**: Migrated HorizonView consumers to Scenario timeline projection
- **Runtime**: Relocated runtime helpers outside services tree
- **Services**: Normalized service module directory structure with one top-level directory per service

### Removed

- **Trait**: Removed TraitAnalyzer from AgentCore required inject list
- **Trait**: Removed trait analysis from context factory
- **Plugin**: Removed deprecated persona plugin
- **Plugin**: Removed memory-keeper plugin
- **Legacy**: Removed deprecated prompt/skill/plugin compatibility APIs
- **Legacy**: Cleaned up message hook types and timeout configuration

### Fixed

- **Runtime**: Fixed `send_message` delivery recording and loop stream/history behavior
- **Runtime**: Restored loop ordering and assistant message carry-forward
- **Runtime**: Relaxed HookService debugLevel registration assertion
- **Hook**: Hardened hook boundary against legacy skill loader interference
- **Hook**: Stabilized hook timeout and decorator test harness

## [4.0.0-beta.4] - 2026-03-14

### Added

- **Runtime**: Unified Percept/Scenario/Capabilities/RoundContext contracts
- **Runtime**: Unified ScenarioTimeline projection layer with Horizon-to-Scenario adapter
- **Runtime**: RoundContext threading through agent runtime loop with calibration helpers
- **Runtime**: Agent lifecycle payload contracts with before/end hook lifecycle
- **Prompt**: Fragment-first prompt public contract with canonical layout renderer
- **Prompt**: Migrated memory and skill outputs to fragment metadata
- **Prompt**: Migrated role content to fragment provider contract
- **Skill**: Loaded skill runtime and effect applier
- **Skill**: Hook-driven skill loading with persistent roster inheritance helper
- **Skill**: Skill registry catalog-only posture
- **Capability**: Capability-driven tool visibility and invocation
- **Capability**: Resolver-driven capability assembly pipeline
- **Capability**: Namespaced capability contracts and resolver types
- **Hook**: Decorator hooks plugin startup lifecycle registration
- **Hook**: Centralized round-entry skill resolution in ThinkActLoop
- **Hook**: Hook log level configuration
- **Test**: Nyquist validation test coverage for phases 54-61

### Changed

- **Runtime**: Relocated runtime helpers outside services tree
- **Runtime**: Migrated runtime consumers from HorizonView to Scenario
- **Runtime**: Removed builtin activator usage, maintaining capability-only gating
- **Trait**: Set trait to optional posture
- **Type**: Simplified type imports, migrated to runtime/contracts

### Removed

- **Legacy**: Removed deprecated persona plugin
- **Legacy**: Removed deprecated prompt/skill/plugin compatibility APIs
- **Legacy**: Removed message hook types and timeout configuration

## [4.0.0-beta.3] - 2026-03-09

### Added

- **Error**: AthenaError hierarchy with exponential backoff retry utilities
- **Event**: EventBusService with willingness.changed/timeline.compressed/cache.evicted events
- **Test**: E2E test framework with @koishijs/plugin-mock and complete message flow simulation
- **Hook**: @Hook() decorator implementation with runtime interception recovery
- **Hook**: HookService registration in core startup wiring
- **Hook**: Hook timeout parameter configuration and error isolation
- **Hook**: Hook lifecycle events and logging
- **Hook**: Extended ToolExecutionContext with view/traits/skills fields
- **Cache**: ImageCacheService disk cache with immediate download to avoid CDN URL expiration
- **Cache**: Single-layer disk with in-memory metadata index plus LRU/TTL cleanup
- **Memory**: MemoryAgentService background memory agent with timeline compression and channel locking
- **Memory**: Memory types definition with heartbeat timeline type
- **Memory**: Core memories injected into prompt with recall tool registration
- **Arousal**: ArousalService wake-up service with global heartbeat and rate limiting
- **Arousal**: Daily quota limit to prevent proactive message spam
- **Summary**: SummaryCompressor service for asynchronous context compression
- **Summary**: Summary timeline type with archived marker support
- **Summary**: Hybrid compression trigger with success-gated timestamp semantics
- **Image**: FIFO image budget retaining latest N images by timeline order
- **Image**: Integrated imageMode/maxImagesInContext/imageLifecycleCount configuration
- **Config**: 32 field i18n descriptions in zh-CN and en-US
- **Config**: 5 intersect groups (basic/model/willingness/prompt/advanced)
- **Test**: Nyquist validation test coverage for phases 43-49

### Changed

- **Image**: Content-based image hash with URL→ID index
- **Image**: Async image cache API propagating async through call chain
- **Summary**: Runtime maybeCompress() call replacing direct compression entry
- **Template**: Template cache invalidation on role file reload

### Fixed

- **Summary**: Hardened hybrid trigger semantics and success-gated timestamps
- **Arousal**: Accounted proactive quota after successful heartbeat send

## [4.0.0-beta.2] - 2026-03-05

### Added

- **Horizon**: HorizonView contract standardization and validation
- **Horizon**: validateAndFixHorizonView helper
- **Context**: ToolExecutionContext factory pattern
- **Context**: Execution context factories
- **Hook**: Hook lifecycle events
- **Hook**: Hook mutation safety hardening
- **Hook**: Hook timeout and error isolation
- **Hook**: HookService registration in core startup wiring
- **Test**: HorizonView and Hook contract test coverage for phases 51-53

### Changed

- **Horizon**: Narrowed HorizonView type with required environment/entities/history
- **Context**: Aligned tool execution contexts to factories

## [4.0.0-beta.1] - 2026-03-01

### Added

- **Core**: Modular model service based on ai-sdk with Provider plugin architecture
- **Core**: ThinkActLoop native agentic loop: context → LLM → tool exec → respond
- **Core**: Native ai-sdk tool calling replacing JSON text parsing
- **Core**: PQueue concurrency control for ModelService call/streamCall queueing
- **Provider**: OpenAI, DeepSeek, Anthropic, Google provider plugins
- **Provider**: Dynamic schema linking with registered models selectable in config dropdown
- **Provider**: AbstractProvider base class with createProviderSchema factory
- **Horizon**: Environment/Entity/Event triple architecture
- **Horizon**: Timeline storage with EventManager persistence
- **Horizon**: HorizonService with HorizonView building
- **Horizon**: Environment/Entity population from Koishi session data
- **Horizon**: AgentResponse/AgentAction separation with independent EnvironmentManager
- **Prompt**: PromptService architecture with named injection points and partial composition
- **Prompt**: Mustache template rendering with snippet/injection mechanism
- **Prompt**: Modular prompt structure with partial composition replacing monolithic templates
- **Prompt**: Injection point consolidation from 6 to 4: soul/instructions/memory/extra
- **Prompt**: In-code XML generation via render() eliminating wrapper partials
- **Prompt**: Built-in snippets for time, user info, channel info, bot info
- **Role**: Fixed role file system with SOUL.md/AGENTS.md/TOOLS.md
- **Role**: RoleService with file loading, Mustache rendering, and hot reload
- **Plugin**: PluginService with tool registration, schema validation, and execution system
- **Plugin**: Plugin SDK migrated to shared package with extracted search plugin
- **Plugin**: Persona plugin with form-based persona customization
- **Plugin**: Interactions plugin with reaction/essence/poke/forward tools
- **Plugin**: QManager plugin with delmsg/ban/kick tools
- **Willingness**: Complete willingness algorithm with exponential decay, conversation heat, S-curve boost
- **Willingness**: LLM judge delayed decision with persona-aware prompt
- **Willingness**: DM adaptive aggregation with per-user TokenBucket rate limiting
- **Trait**: TraitAnalyzer parallel analysis (Scene/Heat) with per-channel scope
- **Skill**: Folder convention with condition tree activation and layered effect merging
- **Skill**: Configurable injection points with effects targeting soul/instructions/memory/extra
- **Skill**: Three lifecycle types: per-turn / sticky / trait-bound
- **Skill**: Hidden tool with toolFilter.include mechanism and skill-driven search tools
- **Memory**: Working memory temporal optimization with XML history, short-ID, and triggered-by labels
- **Memory**: Working memory trimming with initialContextCharBudget and head-trim
- **Memory**: Message queue backlog merging with pending array queue
- **Cache**: Anthropic system prompt caching with stable/dynamic split
- **Element**: Message element formatting with Koishi element parsing and XML escape injection prevention
- **Element**: Rich text output with send_message reply_to and element XML support
- **Image**: Multimodal image input with ImageCacheService and ai-sdk ImagePart
- **Image**: FIFO image budget retaining latest N images by timeline order
- **Summary**: Summary timeline type with asynchronous compression trigger
- **Log**: Full-chain traceId with msg-XXXXXXXX threading through entire flow
- **Log**: Leveled logging with debugLevel
- **Config**: 5 intersect groups with Console UI collapse/expand
- **Config**: 32 field i18n descriptions in zh-CN and en-US
- **Test**: JSON Parser test suite with 27 vitest cases

### Changed

- **Scope**: Removed Scope interface, replaced with ChannelKey bare fields (platform + channelId)
- **Environment**: Required platform/channelId fields eliminating Scope→Environment conversion
- **Environment**: Entity userId/username/nickname distinction with bot role query
- **Timeline**: DB schema migration replacing scope JSON column with separate platform + channelId columns
- **Horizon**: Structured tag partitioning in HorizonView with layered Percept responsibilities

### Removed

- **Memory**: Removed MemoryService module with snippet registration migrated to RoleService

### Fixed

- **Bot**: Fixed bot action empty records with silence rendered as "(chose silence)" marker
- **Snippet**: Fixed variable rendering with complete nested scope in formatHorizonText
- **Image**: Content-based image hash with URL→ID index
- **Image**: Fixed image lifecycle and FIFO limit logic

[unreleased]: https://github.com/YesWeAreBot/YesImBot/compare/v4.0.0-beta.5...dev
[4.0.0-beta.5]: https://github.com/YesWeAreBot/YesImBot/compare/v4.0.0-beta.4...v4.0.0-beta.5
[4.0.0-beta.4]: https://github.com/YesWeAreBot/YesImBot/compare/v4.0.0-beta.3...v4.0.0-beta.4
[4.0.0-beta.3]: https://github.com/YesWeAreBot/YesImBot/compare/v4.0.0-beta.2...v4.0.0-beta.3
[4.0.0-beta.2]: https://github.com/YesWeAreBot/YesImBot/compare/v4.0.0-beta.1...v4.0.0-beta.2
[4.0.0-beta.1]: https://github.com/YesWeAreBot/YesImBot/releases/tag/v4.0.0-beta.1
