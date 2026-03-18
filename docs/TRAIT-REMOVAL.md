# Trait Removal — Responsibility Matrix

**Status:** Completed in Phase 62 (v3.3)
**Context:** TraitAnalyzer has been removed from Athena's mandatory runtime path. This document records the disposition of every former Trait responsibility.

## Responsibility Matrix

| Responsibility                                     | Old Owner    | Disposition | Reason                                                                | Replacement Path                                                                 |
| -------------------------------------------------- | ------------ | ----------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `scene` signal (`private-chat`/`group-chat`)       | `SceneTrait` | **Deleted** | `Scenario.raw.environment.type` already carries the same distinction  | Check `scenario.raw.environment.type === "private"`                              |
| `attention` signal (`mentioned`/`ignored`)         | `SceneTrait` | **Deleted** | Mention/recency can be derived directly from recent timeline messages | Scan `scenario.raw.scenarioTimeline.turns` for mentions and message distance     |
| `bot-role` signal                                  | `SceneTrait` | **Deleted** | Bot role is already in Scenario contract                              | Access `scenario.raw.self.role` directly                                         |
| `has-forward` signal                               | `SceneTrait` | **Deleted** | Forward XML tags can be detected from turn messages                   | Check `scenario.raw.scenarioTimeline.turns[].messages[].content` for `<forward`  |
| `heat` signal (`low`/`medium`/`high`)              | `HeatTrait`  | **Deleted** | Message-rate level can be recomputed from timeline data               | Count timestamps in `scenario.raw.scenarioTimeline.turns` within a time window   |
| `heat-trend` signal (`stable`/`heating`/`cooling`) | `HeatTrait`  | **Deleted** | Trend is derivable by comparing older vs recent message density       | Compare rates between timeline halves from `scenario.raw.scenarioTimeline.turns` |
| `SceneState` bookkeeping                           | `SceneTrait` | **Deleted** | State cache only supported removed attention/scene bookkeeping        | No replacement; compute from `scenario.raw` on demand                            |
| `HeatState` bookkeeping                            | `HeatTrait`  | **Deleted** | Sliding timestamp cache only supported removed heat signals           | No replacement; compute from `scenario.raw` on demand                            |

## Migration Guide for Hook Authors

### Former `scene` Signal

**Old approach:**

```typescript
const sceneSignal = traits.find((t) => t.dimension === "scene");
if (sceneSignal?.value === "private-chat") {
  // private chat logic
}
```

**New approach:**

```typescript
if (scenario.raw.environment.type === "private") {
  // private chat logic
}
```

### Former `attention` Signal

**Old approach:**

```typescript
const attentionSignal = traits.find((t) => t.dimension === "attention");
if (attentionSignal?.value === "mentioned") {
  // mentioned logic
}
```

**New approach:**

```typescript
const botName = scenario.raw.self.name.toLowerCase();
const recentMessages = scenario.raw.scenarioTimeline.turns
  .slice(-5)
  .flatMap((turn) => turn.messages);
const mentioned = recentMessages.some((message) => message.content.toLowerCase().includes(botName));

if (mentioned) {
  // mentioned logic
}
```

### Former `bot-role` Signal

**Old approach:**

```typescript
const roleSignal = traits.find((t) => t.dimension === "bot-role");
if (roleSignal?.value === "admin") {
  // admin-only skill
}
```

**New approach:**

```typescript
if (scenario.raw.self.role === "admin") {
  // admin-only skill
}
```

### Former `has-forward` Signal

**Old approach:**

```typescript
const forwardSignal = traits.find((t) => t.dimension === "has-forward");
if (forwardSignal?.value === "true") {
  // enable get_forward_msg tool
}
```

**New approach:**

```typescript
const lastTurn =
  scenario.raw.scenarioTimeline.turns[scenario.raw.scenarioTimeline.turns.length - 1];
const hasForward = lastTurn?.messages.some(
  (message) => typeof message.content === "string" && message.content.includes("<forward"),
);

if (hasForward) {
  // enable get_forward_msg tool
}
```

### Former `heat` and `heat-trend` Signals

**Old approach:**

```typescript
const heatSignal = traits.find((t) => t.dimension === "heat");
if (heatSignal?.value === "high") {
  // high activity logic
}
```

**New approach:**

```typescript
const WINDOW_MS = 5 * 60 * 1000;
const now = Date.now();
const allMessages = scenario.raw.scenarioTimeline.turns.flatMap((turn) => turn.messages);
const recentMessages = allMessages.filter(
  (message) => message.timestamp && now - new Date(message.timestamp).getTime() <= WINDOW_MS,
);
const ratePerMinute = recentMessages.length / (WINDOW_MS / 60000);

if (ratePerMinute >= 8) {
  // high activity logic
}

const midpoint = now - WINDOW_MS / 2;
const olderHalf = recentMessages.filter(
  (message) => new Date(message.timestamp).getTime() <= midpoint,
).length;
const recentHalf = recentMessages.length - olderHalf;
const trend =
  olderHalf > 0 && recentHalf > olderHalf * 1.3
    ? "heating"
    : olderHalf > 0 && recentHalf < olderHalf * 0.7
      ? "cooling"
      : "stable";
```

## Legacy Compatibility

The `traits` field remains in `ToolExecutionContext` and `HookExecutionContext` for internal compatibility during the v3.3 migration period. It now resolves to an empty array `[]` when `TraitAnalyzer` is not invoked.

**Deprecated fields:**

- `ToolExecutionContext.traits` — internal legacy compatibility, always `[]` on mandatory path
- `AgentStartMutableParams.traits` — read-only compatibility mirror, always `[]`

Hook authors should not rely on these fields for behavior. Use `scenario.raw` fields directly.

## Timeline

- **Phase 62 (v3.3):** Trait removed from mandatory path; responsibility matrix locked
- **Future (v3.4+):** Legacy `traits` compatibility field may be removed

## References

- Phase 62 Context: `.planning/phases/62-trait-removal-baseline/62-CONTEXT.md`
- Phase 62 Research: `.planning/phases/62-trait-removal-baseline/62-RESEARCH.md`
- Scene detector legacy source: `core/src/services/trait/detectors/scene.ts`
- Heat detector legacy source: `core/src/services/trait/detectors/heat.ts`
- Scenario contract: `core/src/services/runtime/contracts.ts`
