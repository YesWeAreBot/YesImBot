# Phase 17: Trait Perception - Research

**Researched:** 2026-02-22
**Domain:** Multi-dimensional conversation context analysis framework
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Signal 协议设计
- 枚举维度 + 值结构：`{ dimension: string, value: string, confidence: number, metadata?: Record<string, unknown> }`
- 所有 Detector 输出汇总为 TraitSignal 数组，多值共存
- 一个 Detector 可输出多个 Signal（如 SceneTrait 同时输出 group-chat + mentioned）
- Skill 匹配采用"存在即匹配"——只看 Signal 是否存在，不看 confidence 阈值
- confidence 作为参考信息保留，不参与激活判定
- Detector 内部负责过滤低 confidence 结果，只输出它认为成立的 Signal

#### 场景检测逻辑（SceneTrait）
- 四场景：group-chat、private-chat、mentioned、ignored
- 组内互斥，跨组共存：group-chat | private-chat 互斥；mentioned | ignored 互斥；跨组可组合（如 group-chat + mentioned）
- ignored 双触发条件：bot 发言后无人回应 OR 长时间未被提及，任一成立即触发
- mentioned 含名字提及：@ 符号或消息中出现 bot 名字均算 mentioned

#### 热度追踪行为（HeatTrait）
- 衡量维度：纯消息频率（不考虑参与人数）
- 热度等级三档：low / medium / high
- 趋势方向三种：heating / cooling / stable
- heat level 和 trend 作为两个独立 Signal 输出（dimension 分别为 'heat' 和 'heat-trend'）

#### 有状态 Trait 持久化
- 纯内存存储，重启后状态丢失（持久化留给后续迭代）
- TraitAnalyzer 提供统一状态 API（getState/setState），Detector 通过它读写状态
- 状态 scope 粒度：per-channel（与 Horizon 的 Scope 一致）
- 事件驱动实时更新：Detector 监听 horizon/message 等事件持续更新内部状态，detect() 时直接读取已有状态输出 Signal，不阻塞主路径

### Claude's Discretion
- TraitAnalyzer 的并行调度实现细节
- 统一状态 API 的具体接口设计
- HeatTrait 的时间窗口大小和阈值参数
- ignored 判定的具体消息数/时间阈值
- mentioned 名字匹配的模糊度策略

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRAIT-01 | TraitAnalyzer 框架支持注册多个 Trait 检测器，并行分析 HorizonView 输出 TraitSignal | Architecture pattern: TraitAnalyzer as Koishi Service with detector registry + Promise.allSettled parallel dispatch |
| TRAIT-02 | 内置 SceneTrait 检测器（群聊/私聊/被@/被忽略等场景维度） | SceneTrait detector: stateful, listens to horizon/message for ignored tracking, reads HorizonView for scene classification |
| TRAIT-03 | 内置 HeatTrait 检测器（对话热度/趋势维度） | HeatTrait detector: stateful, maintains sliding window of message timestamps per channel, outputs heat level + trend signals |
| TRAIT-04 | TraitSignal 协议定义，解耦感知层和响应层 | Signal protocol: plain interface in shared location, consumers match by dimension+value without importing detector code |
| TRAIT-05 | 有状态 Trait 支持（per-channel scope，增量更新） | State API on TraitAnalyzer: getState/setState keyed by channelKey+detectorName, event-driven updates via horizon/message listener |

</phase_requirements>

## Summary

Phase 17 introduces a multi-dimensional conversation context analysis framework that replaces the old ChatMode discrete switching pattern. The core concept: multiple TraitDetectors run in parallel against conversation context, each producing typed TraitSignal values. Downstream consumers (Phase 18 Skills) react to signal presence without importing detector implementations.

The architecture is straightforward: a `TraitAnalyzer` Koishi Service owns a registry of `TraitDetector` instances, provides a unified state API (per-channel in-memory Map), and exposes an `analyze()` method that runs all detectors in parallel via `Promise.allSettled`. Two built-in detectors ship: `SceneTrait` (group/private/mentioned/ignored) and `HeatTrait` (message frequency + trend). Both are stateful — they listen to `horizon/message` events to continuously update internal state, so `detect()` calls are non-blocking reads of pre-computed state.

**Primary recommendation:** Implement TraitAnalyzer as a new Koishi Service (`yesimbot.trait`) in `core/src/services/trait/`, following the exact same Service subclass pattern as existing services. Keep the TraitSignal interface in `shared/types.ts` for maximum decoupling.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| koishi | 4.18.x | Service framework, event system, context lifecycle | Already in use — Service subclass pattern, ctx.on/emit for events |

### Supporting
No new dependencies needed. All functionality is pure TypeScript using existing Koishi primitives.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Koishi Service for TraitAnalyzer | Plain class owned by AgentCore | Service gives lifecycle management, inject dependencies, hot-reload — matches project pattern |
| In-memory Map for state | Database persistence | User decision: pure memory, persistence deferred. Map is simpler and zero-latency |

## Architecture Patterns

### Recommended Project Structure
```
core/src/services/trait/
├── index.ts           # Re-exports
├── types.ts           # TraitSignal, TraitDetector interface, DetectorState
├── service.ts         # TraitAnalyzer Service
├── detectors/
│   ├── scene.ts       # SceneTrait detector
│   └── heat.ts        # HeatTrait detector
```

### Pattern 1: TraitDetector Interface

**What:** A detector is a plain class implementing a `TraitDetector` interface. It receives a `TraitAnalyzer` reference for state access and a Koishi `Context` for event listening.

**When to use:** Every trait dimension (scene, heat, future topic/relation detectors).

```typescript
interface TraitDetector {
  /** Unique detector name, used as state namespace */
  readonly name: string;

  /** Called once when registered — subscribe to events here */
  start(ctx: Context, analyzer: TraitAnalyzer): void;

  /** Synchronous read of pre-computed state → signals */
  detect(scope: Scope, view: HorizonView): TraitSignal[];
}
```

Key design: `detect()` is synchronous (or returns already-resolved data). All heavy work happens in event handlers that update state incrementally. This ensures `analyze()` never blocks the agent loop.

### Pattern 2: Parallel Dispatch with Promise.allSettled

**What:** TraitAnalyzer.analyze() runs all detectors in parallel, collects results, flattens into a single TraitSignal array.

**When to use:** Every analyze() call from the agent loop.

```typescript
async analyze(scope: Scope, view: HorizonView): Promise<TraitSignal[]> {
  const results = await Promise.allSettled(
    this.detectors.map(d => Promise.resolve(d.detect(scope, view)))
  );
  const signals: TraitSignal[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') signals.push(...r.value);
  }
  return signals;
}
```

Using `Promise.allSettled` ensures one failing detector doesn't block others — matches the existing pattern in PromptService injection rendering.

### Pattern 3: Event-Driven State Updates

**What:** Stateful detectors listen to `horizon/message` events to maintain per-channel state. The `detect()` method reads this pre-computed state.

**When to use:** HeatTrait (message timestamps), SceneTrait (ignored tracking).

```typescript
// In HeatTrait.start():
ctx.on('horizon/message', (event) => {
  const key = `${event.scope.platform}:${event.scope.channelId}`;
  const state = analyzer.getState<HeatState>(this.name, key);
  state.timestamps.push(event.timestamp.getTime());
  // Prune old timestamps outside window
  analyzer.setState(this.name, key, state);
});
```

This pattern is already proven in the codebase: `WillingnessEngine` maintains per-channel state updated on each message, and `EventListener` emits `horizon/message` that multiple consumers can listen to.

### Pattern 4: State API on TraitAnalyzer

**What:** TraitAnalyzer owns a `Map<string, unknown>` keyed by `${detectorName}:${channelKey}`. Detectors read/write through typed getState/setState methods.

```typescript
getState<T>(detectorName: string, channelKey: string): T | undefined {
  return this.stateStore.get(`${detectorName}:${channelKey}`) as T | undefined;
}

setState<T>(detectorName: string, channelKey: string, state: T): void {
  this.stateStore.set(`${detectorName}:${channelKey}`, state);
}
```

Centralizing state in the analyzer (rather than each detector owning its own Map) enables future features: state inspection, bulk cleanup, persistence layer swap.

### Anti-Patterns to Avoid
- **LLM-based trait analysis:** Explicitly out of scope (REQUIREMENTS.md). 200-500ms latency + cost is unacceptable for group chat.
- **Detector importing other detectors:** Signals are the communication protocol. Detectors must be independent.
- **Blocking detect():** If a detector needs async work, it should do it in event handlers and cache results. detect() reads cached state.
- **Manual ctx[name] = ...:** CLAUDE.md mandates Service subclass pattern. Never use ctx.provide() or manual assignment.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parallel execution with fault isolation | Custom try/catch loops | `Promise.allSettled` | Built-in, handles rejection without stopping others |
| Service lifecycle | Manual init/cleanup | Koishi `Service` subclass | Auto-register, auto-dispose, inject dependencies |
| Event subscription cleanup | Manual disposer arrays | `ctx.on()` with Service context | Koishi auto-cleans when service disposes |
| Channel key generation | Ad-hoc string concat | Reuse `${scope.platform}:${scope.channelId}` pattern | Already used everywhere (AgentCore, WillingnessEngine) |

**Key insight:** The Koishi framework already provides all the primitives needed (Service, events, context lifecycle). The trait system is a thin orchestration layer on top.

## Common Pitfalls

### Pitfall 1: Circular Dependency Between Trait and Agent
**What goes wrong:** TraitAnalyzer depends on HorizonService (for buildView), AgentCore depends on TraitAnalyzer — if TraitAnalyzer also depends on AgentCore, circular inject.
**Why it happens:** Temptation to have detectors access agent state.
**How to avoid:** TraitAnalyzer depends only on HorizonService (for events). AgentCore calls `analyzer.analyze()` — one-way dependency. Detectors get data from HorizonView and horizon/message events only.
**Warning signs:** `static inject` listing `yesimbot.agent` in TraitAnalyzer.

### Pitfall 2: Stale State on Channel Key Mismatch
**What goes wrong:** State stored under one key format, read under another. E.g., event handler uses `platform:channelId` but detect() uses `platform:guildId`.
**Why it happens:** Scope has multiple ID fields (channelId, guildId, isDirect).
**How to avoid:** Define a single `channelKey(scope: Scope)` utility function used everywhere. The existing pattern is `${scope.platform}:${scope.channelId}` (see AgentCore.handleEvent).
**Warning signs:** State Map growing but detect() returning empty signals.

### Pitfall 3: Memory Leak in Stateful Detectors
**What goes wrong:** Message timestamp arrays grow unbounded for active channels.
**Why it happens:** No pruning of old data.
**How to avoid:** HeatTrait must prune timestamps outside its sliding window on every update. SceneTrait must limit stored message count. Consider a periodic cleanup in TraitAnalyzer (similar to WillingnessEngine.tick() pattern).
**Warning signs:** Increasing memory usage over time in long-running instances.

### Pitfall 4: Ignored Detection Race Condition
**What goes wrong:** SceneTrait marks "ignored" based on bot's last response having no replies, but the state update from horizon/message hasn't propagated yet.
**Why it happens:** Event-driven eventual consistency — detect() may read slightly stale state.
**How to avoid:** Accept eventual consistency (user decision). The ignored signal may be one message late, which is acceptable for the use case. Document this behavior.
**Warning signs:** Ignored signal flickering on/off rapidly.

### Pitfall 5: Logger Pattern Violation
**What goes wrong:** Creating logger on every call instead of once.
**Why it happens:** CLAUDE.md rule easily forgotten.
**How to avoid:** Create `this.logger = ctx.logger("trait")` once in constructor or start(). Never chain `.info()` on `ctx.logger()` call.

## Code Examples

### TraitSignal Interface (shared/types.ts)

```typescript
export interface TraitSignal {
  dimension: string;
  value: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}
```

Placed in `shared/types.ts` alongside `Scope`, `Percept`, `TriggerType` — ensures any consumer can import without pulling in detector implementations.

### SceneTrait Detection Logic

```typescript
detect(scope: Scope, view: HorizonView): TraitSignal[] {
  const signals: TraitSignal[] = [];

  // Scene group: group-chat | private-chat (mutually exclusive)
  signals.push({
    dimension: 'scene',
    value: scope.isDirect ? 'private-chat' : 'group-chat',
    confidence: 1.0,
  });

  // Attention group: mentioned | ignored (mutually exclusive)
  const key = channelKey(scope);
  const state = this.analyzer.getState<SceneState>(this.name, key);

  if (this.isMentioned(view, state)) {
    signals.push({ dimension: 'attention', value: 'mentioned', confidence: 1.0 });
  } else if (this.isIgnored(state)) {
    signals.push({ dimension: 'attention', value: 'ignored', confidence: 0.8 });
  }

  return signals;
}
```

### HeatTrait Detection Logic

```typescript
detect(scope: Scope, _view: HorizonView): TraitSignal[] {
  const key = channelKey(scope);
  const state = this.analyzer.getState<HeatState>(this.name, key);
  if (!state) return [
    { dimension: 'heat', value: 'low', confidence: 1.0 },
    { dimension: 'heat-trend', value: 'stable', confidence: 1.0 },
  ];

  const now = Date.now();
  const recent = state.timestamps.filter(t => now - t < this.windowMs);
  const rate = recent.length / (this.windowMs / 60000); // msgs per minute

  const level = rate >= this.highThreshold ? 'high'
    : rate >= this.mediumThreshold ? 'medium' : 'low';

  // Trend: compare recent half vs older half
  const mid = now - this.windowMs / 2;
  const recentHalf = recent.filter(t => t >= mid).length;
  const olderHalf = recent.filter(t => t < mid).length;
  const trend = recentHalf > olderHalf * 1.3 ? 'heating'
    : recentHalf < olderHalf * 0.7 ? 'cooling' : 'stable';

  return [
    { dimension: 'heat', value: level, confidence: 1.0 },
    { dimension: 'heat-trend', value: trend, confidence: 1.0 },
  ];
}
```

### Integration Point: AgentCore → TraitAnalyzer

The agent loop calls `analyze()` after building the HorizonView, before rendering the prompt. Signals can be passed to the prompt scope for future Skill consumption (Phase 18).

```typescript
// In ThinkActLoop.run() or AgentCore, after buildView:
const signals = await this.ctx['yesimbot.trait'].analyze(percept.scope, view);
// signals available for Phase 18 Skill matching
```

### TraitAnalyzer Service Registration

```typescript
// In core/src/index.ts apply():
ctx.plugin(TraitAnalyzer, { /* config */ });

// TraitAnalyzer registers built-in detectors in start():
protected async start(): Promise<void> {
  this.registerDetector(new SceneTrait());
  this.registerDetector(new HeatTrait());
  // Detectors call start() which subscribes to events
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ChatMode discrete switching (v3-dev) | Trait continuous perception + Skill response | v2.0 architecture decision | Multi-dimensional signals replace single-mode selection |
| WillingnessEngine heat tracking (implicit in decay) | Explicit HeatTrait detector | Phase 17 | Heat becomes a first-class signal, not buried in willingness math |
| No scene awareness | SceneTrait detector | Phase 17 | Bot knows if it's in group/private, mentioned/ignored |

**Deprecated/outdated:**
- ChatMode pattern (references/YesImBot-dev): Replaced by Trait + Skill. Do not reference ChatMode manager/base patterns.

## Open Questions

1. **Where exactly to call analyze() in the agent pipeline**
   - What we know: Must happen after buildView(), before prompt rendering. Signals need to be available for Phase 18 Skill matching.
   - What's unclear: Should it be in ThinkActLoop.run() or in AgentCore before enqueue? The loop has the HorizonView; AgentCore has the willingness context.
   - Recommendation: Call in ThinkActLoop.run() after buildView(), pass signals forward. This keeps the loop as the single orchestration point. TraitAnalyzer is a dependency of AgentCore (or the loop accesses it via ctx).

2. **HeatTrait window size and thresholds**
   - What we know: User left this to Claude's discretion. Must produce low/medium/high levels.
   - Recommendation: 5-minute sliding window. Thresholds: low < 2 msg/min, medium 2-8 msg/min, high > 8 msg/min. These are configurable via TraitAnalyzer config. Based on typical group chat patterns where 8+ msg/min indicates active discussion.

3. **Ignored detection thresholds**
   - What we know: Two conditions — bot spoke but no reply, OR long time without mention. User left specifics to discretion.
   - Recommendation: "No reply" = bot's last response was 5+ messages ago with no one addressing bot. "Long time" = 10+ messages in channel since bot was last mentioned. Both are configurable.

4. **Mentioned name matching strategy**
   - What we know: @ symbol OR bot name in message text. User left fuzzy matching to discretion.
   - Recommendation: Exact case-insensitive match on `view.self.name`. No fuzzy matching initially — false positives are worse than false negatives for mentioned detection. The @ detection already exists in EventListener.classifyTrigger().

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `core/src/services/` — all 6 existing services follow identical Service subclass pattern
- `core/src/services/horizon/types.ts` — HorizonMessageEvent, HorizonView interfaces
- `core/src/services/agent/service.ts` — AgentCore event handling, willingness integration pattern
- `core/src/services/agent/willingness.ts` — Per-channel state management pattern (Map<string, ChannelState>)
- `core/src/services/shared/types.ts` — Scope, Percept, TriggerType shared types
- `core/src/services/prompt/service.ts` — Promise.allSettled parallel pattern with per-entry timeout
- `CLAUDE.md` — Service subclass mandate, logger pattern, type rules

### Secondary (MEDIUM confidence)
- `references/YesImBot-dev/packages/core/src/services/horizon/chat-mode/` — ChatMode pattern being replaced (confirms what NOT to do)
- `references/YesImBot-v3/packages/core/src/agent/willing.ts` — v3 willingness with heat-aware decay (validates heat tracking concept)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — No new dependencies, pure Koishi Service pattern already proven 6 times in codebase
- Architecture: HIGH — Detector registry + parallel dispatch + event-driven state is a direct application of existing patterns (PluginService registry, PromptService parallel rendering, WillingnessEngine per-channel state)
- Pitfalls: HIGH — Identified from actual codebase patterns and known Koishi lifecycle behaviors

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable domain, no external dependencies)
