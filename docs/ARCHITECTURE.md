# Athena Architecture Overview

## Project Structure

Athena is a Yarn/Turbo monorepo centered on a Koishi plugin runtime.

- `core/`: yesimbot runtime services and role/skill resources
- `packages/shared-model/`: model/provider interfaces and schema helpers
- `providers/provider-*`: provider adapters (OpenAI, Anthropic, Google, DeepSeek)
- `plugins/`: optional feature plugins (persona/search/mcp/memory-keeper)

## Core Service Layers

### 1. Event and Context Layer (`horizon`)

`core/src/services/horizon/`

- Ingests and stores timeline events (`yesimbot.timeline`)
- Maintains entity and environment context (`yesimbot.entity`)
- Builds `HorizonView` as an internal read model (adapter source for `Scenario`)
- Formats historical context into model-ready messages

### 2. Decision and Loop Layer (`agent`)

`core/src/services/agent/`

- Runs willingness scoring and rate limiting
- Aggregates DM/group messages before response
- Executes multi-round think-act loop (`ThinkActLoop`)
- Integrates model call, JSON response parsing, and tool/action execution

### 3. Model Layer (`model` + `providers`)

- `ModelService` manages provider registry and concurrent calls with fallback chain
- Provider plugins implement `AbstractProvider` and register model configs
- Anthropic provider includes prompt-cache-specific behavior

### 4. Behavior Layer (`trait` + `skill` + `role` + `prompt`)

- `trait`: analyzes scene/heat signals
- `skill`: selects and merges skill effects
- `role`: content source provider for role/persona fragments (`SOUL.md`, `AGENTS.md`, `TOOLS.md`)
- `prompt`: canonical `Fragment -> Section -> Layout` renderer (`identity -> policy -> memory -> situation`)

### 5. Tool Layer (`plugin`)

- Registers tools/actions through decorators and plugin API
- Converts Koishi schema <-> JSON schema for tool definitions
- Enforces Tool vs Action execution semantics in agent loop

## Runtime Flow

```text
Koishi message event
  -> Horizon listener/event manager
  -> Agent willingness + token bucket check
  -> DM/group aggregation window
  -> HorizonView build (internal)
  -> Scenario + Capabilities + RoundContext assembly (public runtime contracts)
  -> Trait analyze + Skill resolve
  -> Prompt canonical layout render (scope includes roundContext/scenario/capabilities; view.* is legacy compat)
  -> Provider emit adaptation (e.g., Anthropic cache split from fragment stability/cacheable metadata)
  -> ModelService call (with fallback)
  -> Tool/Action execution (reads from RoundContext/Scenario)
  -> Reply or silent finish
```

## Public Runtime Contracts (Phase 54+)

Athena's public runtime boundary is centered on:

- `Percept` — wake semantics only (why the round started)
- `Scenario` — layered runtime context (`raw` world projection + `derived` interpretation)
- `Capabilities` — structured execution affordances (core/extended)
- `RoundContext` — the committed snapshot carried through wake-to-response

`HorizonView` remains a Horizon-internal read model and should be treated as an adapter source for building `Scenario`, not the default public contract for downstream integrations.

## Dependency Rules

```text
providers/* ----\
plugins/* -------\                  +------------------+
core/services/* ---> yesimbot.model | shared-model pkg |
          |                          +------------------+
          +-> horizon/prompt/trait/skill/plugin services
```

- Services must use `Service` subclass pattern.
- Cross-service access should go through declared `inject` dependencies.
- Keep Horizon focused on data retrieval and formatting, not participation decisions.
- Keep provider-specific behaviors in provider packages, not shared abstraction.
- RoleService provides content sources only; prompt ordering is owned by canonical layout.
- Provider adapters consume canonical rendered fragment trees and must not reorder sections.
