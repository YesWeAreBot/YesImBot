# Phase 27: Scope Deletion & Module Migration - Research

**Researched:** 2026-02-26
**Domain:** TypeScript refactoring — interface deletion + bare-field migration across a Koishi plugin monorepo
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**字段迁移策略**
- 只保留 `platform` + `channelId`，删除 `guildId`、`userId`、`isDirect` 三个字段
- 需要这三个字段的地方从 Session 获取（所有使用点都是聊天场景，可访问 Session）
- `platform` 和 `channelId` 都改为必填（非 optional）
- `shared/types.ts` 只删除 Scope 接口定义，保留文件中其他类型

**函数签名设计**
- 使用解构对象风格：`fn(key: ChannelKey, ...)`
- 定义共享类型别名 `type ChannelKey = { platform: string; channelId: string }`
- `ChannelKey` 放在 `shared/types.ts` 中替代 Scope
- ChannelKey 参数保持第一位（与原 scope 参数位置一致）

**嵌入类型的字段展开**
- 数据类型（Percept、HorizonMessageEvent、BaseTimelineEntry 等）使用交叉类型 `& ChannelKey` 展开裸字段
- 一步到位直接替换，不做渐进式迁移（`percept.scope.platform` → `percept.platform`）
- 查询参数类型（EventQueryOptions）改为 `key?: ChannelKey`（保持可选语义）

### Claude's Discretion
- 具体的迁移顺序和分 plan 策略
- channelKey 工具函数是否需要调整
- 各模块内部的局部变量命名

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CTX-01 | 删除 `Scope` 接口，用 `platform: string` + `channelId: string` 裸字段替代 | Replace `interface Scope` in `shared/types.ts` with `type ChannelKey = { platform: string; channelId: string }` |
| CTX-02 | 迁移 Horizon 模块（service.ts, manager.ts, listener.ts, types.ts）使用裸字段 | 4 files identified; types.ts has 3 Scope usages; service.ts has 4 method signatures; manager.ts has 5 method signatures; listener.ts constructs inline scope objects |
| CTX-03 | 迁移 Trait 模块（service.ts, detectors/scene.ts, detectors/heat.ts, types.ts）使用裸字段 | 4 files; all use `Scope` in function signatures and `channelKey(scope)` helper functions |
| CTX-04 | 迁移 Skill 模块（service.ts）使用裸字段 | 1 file; `resolve(signals, scope: Scope)` → `resolve(signals, key: ChannelKey)` |
| CTX-05 | 迁移 Agent 模块（service.ts）和 Plugin 模块（types.ts）使用裸字段 | agent/service.ts accesses `event.scope.*` and `percept.scope.*`; plugin/types.ts has `ToolExecutionContext.scope: Scope` |
| CTX-06 | 迁移 Percept 接口从 `scope: Scope` 改为裸字段 | `Percept` in `shared/types.ts` has `scope: Scope` → replace with `& ChannelKey` intersection |
</phase_requirements>

## Summary

Phase 27 is a pure TypeScript refactoring with zero runtime behavior change. The `Scope` interface (defined in `core/src/services/shared/types.ts`) is used across 13 files. It will be replaced by a `ChannelKey` type alias containing only `platform: string` and `channelId: string` as required fields. Three fields (`guildId`, `userId`, `isDirect`) are deleted from the type — callers that need them will read directly from the Koishi `Session` object.

The migration has two distinct patterns: (1) **function parameters** use `key: ChannelKey` destructured object style, and (2) **embedded data types** (`Percept`, `HorizonMessageEvent`, `BaseTimelineEntry`) use `& ChannelKey` intersection to inline the fields directly. The `EventQueryOptions.scope` field becomes `key?: ChannelKey`. All call sites that previously accessed `percept.scope.platform` will access `percept.platform` directly after the intersection expansion.

The most complex file is `horizon/service.ts` — it uses `scope.isDirect` and `scope.guildId` in `getOrCreateEnvironment` and `getEntities`. These must be sourced from the `Session` parameter instead. The `agent/loop.ts` and `agent/service.ts` files pass `percept.scope` to multiple downstream methods; once `Percept` uses `& ChannelKey`, these become `percept` (the whole object) or `{ platform: percept.platform, channelId: percept.channelId }`.

**Primary recommendation:** Migrate bottom-up: shared types first, then horizon types, then horizon service/manager/listener, then trait/skill, then agent/plugin last. This ensures each layer compiles before the next is touched.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ~5.x (project) | Type system | Project language |
| Koishi | 4.x | Plugin framework | Project framework |

No new libraries needed — this is a pure refactoring phase.

**Installation:** None required.

## Architecture Patterns

### Recommended Migration Order (bottom-up)

```
1. shared/types.ts          — delete Scope, add ChannelKey, update Percept
2. horizon/types.ts         — update HorizonMessageEvent, BaseTimelineEntry, EventQueryOptions
3. horizon/manager.ts       — update method signatures (Scope → ChannelKey)
4. horizon/listener.ts      — update inline scope object construction
5. horizon/service.ts       — update method signatures + fix isDirect/guildId reads
6. trait/types.ts           — update TraitDetector.detect signature
7. trait/detectors/heat.ts  — update channelKey helper + detect signature
8. trait/detectors/scene.ts — update channelKey helper + detect signature + isDirect read
9. trait/service.ts         — update analyze signature
10. skill/service.ts        — update resolve signature
11. plugin/types.ts         — update ToolExecutionContext.scope field
12. agent/service.ts        — update percept.scope.* accesses + buildPercept
13. agent/loop.ts           — update percept.scope.* accesses
```

### Pattern 1: ChannelKey Type Alias (replaces Scope)

**What:** A minimal required-field type alias for channel identity.
**When to use:** All function parameters and embedded data fields that previously used `Scope`.

```typescript
// shared/types.ts — BEFORE
export interface Scope {
  platform?: string;
  channelId?: string;
  guildId?: string;
  userId?: string;
  isDirect?: boolean;
}

// shared/types.ts — AFTER
export type ChannelKey = { platform: string; channelId: string }
```

### Pattern 2: Intersection for Embedded Data Types

**What:** Data types that previously had `scope: Scope` field get `& ChannelKey` intersection.
**When to use:** `Percept`, `HorizonMessageEvent`, `BaseTimelineEntry`.

```typescript
// BEFORE
export interface Percept {
  id: string;
  traceId: string;
  type: TriggerType;
  scope: Scope;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// AFTER
export interface Percept {
  id: string;
  traceId: string;
  type: TriggerType;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
// Then intersect at usage: type PerceptWithKey = Percept & ChannelKey
// OR inline the fields directly:
export interface Percept {
  id: string;
  traceId: string;
  type: TriggerType;
  platform: string;
  channelId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
```

Note: The CONTEXT.md decision says "使用交叉类型 `& ChannelKey` 展开裸字段" — this means the interface definition itself should spread the fields inline (not keep a nested `scope` object). The cleanest approach is to add `platform: string` and `channelId: string` directly to the interface body, which is equivalent to `& ChannelKey` expansion.

### Pattern 3: Function Parameter Migration

**What:** Functions that took `scope: Scope` now take `key: ChannelKey`.
**When to use:** All service method signatures.

```typescript
// BEFORE
async buildView(scope: Scope, options?: ViewOptions): Promise<HorizonView>
async analyze(scope: Scope, view: HorizonView): Promise<TraitSignal[]>
resolve(signals: TraitSignal[], scope: Scope): SkillEffect

// AFTER
async buildView(key: ChannelKey, options?: ViewOptions): Promise<HorizonView>
async analyze(key: ChannelKey, view: HorizonView): Promise<TraitSignal[]>
resolve(signals: TraitSignal[], key: ChannelKey): SkillEffect
```

### Pattern 4: EventQueryOptions key field

```typescript
// BEFORE
export interface EventQueryOptions {
  scope?: Scope;
  // ...
}

// AFTER
export interface EventQueryOptions {
  key?: ChannelKey;
  // ...
}
```

The `manager.ts` query method must update: `if (options.scope)` → `if (options.key)` and the query object field name changes from `scope` to match the DB column (see note below on DB schema).

### Pattern 5: isDirect / guildId sourcing from Session

The three deleted fields (`guildId`, `userId`, `isDirect`) are currently used in:

- `horizon/service.ts` `getOrCreateEnvironment`: uses `scope.isDirect` for environment type, `scope.guildId` for bot.getChannel call, stores `isDirect`/`userId`/`guildId` in entity attributes
- `horizon/service.ts` `getEntities`: uses `scope.guildId` and `scope.isDirect` to build `parentId`
- `horizon/listener.ts`: constructs scope objects with all 5 fields — after migration, only `platform` + `channelId` go into the event; `isDirect`/`guildId` stay in the `runtime.session`
- `trait/detectors/scene.ts` `detect`: uses `scope.isDirect` for scene value
- `agent/service.ts` `handleEvent`: reads `event.scope.isDirect` for rate limiter bucket selection

**Resolution strategy for each:**

```typescript
// horizon/service.ts getOrCreateEnvironment — session is already a parameter
// isDirect: derive from session or store separately
const isDirect = session?.isDirect ?? false

// horizon/service.ts getEntities — needs isDirect/guildId
// These must come from session or be passed separately
// Since getEntities is called from buildView which has session via options,
// pass session down or accept isDirect/guildId as optional params

// trait/detectors/scene.ts — event.scope.isDirect
// After migration: event has no isDirect; read from event.runtime?.session?.isDirect
// OR: scene value defaults to "group-chat" when isDirect not available

// agent/service.ts — event.scope.isDirect for rate limiter
// After migration: read event.runtime?.session?.isDirect
```

### Pattern 6: channelKey helper functions

Both `heat.ts` and `scene.ts` have a local `channelKey(scope: Scope): string` helper. After migration, the parameter type changes to `ChannelKey`:

```typescript
// BEFORE
function channelKey(scope: Scope): string {
  return `${scope.platform}:${scope.channelId}`
}

// AFTER — parameter type update only
function channelKey(key: ChannelKey): string {
  return `${key.platform}:${key.channelId}`
}
```

The call sites in `start()` that do `channelKey(event.scope)` become `channelKey(event)` since `HorizonMessageEvent` will have `platform` + `channelId` directly (via `& ChannelKey` expansion).

### Pattern 7: ToolExecutionContext migration

```typescript
// plugin/types.ts BEFORE
export interface ToolExecutionContext {
  scope: Scope;
  session?: Session;
  bot?: Bot;
  percept?: Percept;
  [key: string]: unknown;
}

// plugin/types.ts AFTER
export interface ToolExecutionContext {
  platform: string;
  channelId: string;
  session?: Session;
  bot?: Bot;
  percept?: Percept;
  [key: string]: unknown;
}
```

The `plugin/service.ts` fallback `context ?? { scope: {} }` becomes `context ?? { platform: "", channelId: "" }`.

### Pattern 8: buildPercept in agent/service.ts

```typescript
// BEFORE
percept: {
  id: Random.id(),
  traceId: traceId ?? `msg-${Random.id(8, 16)}`,
  type: event.triggerType,
  scope: event.scope,
  timestamp: event.timestamp,
  metadata: { ... },
},
toolCtx: { scope: event.scope, session, bot: session?.bot },

// AFTER (event now has platform/channelId directly)
percept: {
  id: Random.id(),
  traceId: traceId ?? `msg-${Random.id(8, 16)}`,
  type: event.triggerType,
  platform: event.platform,
  channelId: event.channelId,
  timestamp: event.timestamp,
  metadata: { ... },
},
toolCtx: { platform: event.platform, channelId: event.channelId, session, bot: session?.bot },
```

### Anti-Patterns to Avoid

- **Keeping `scope` as a nested wrapper:** Don't add `scope: ChannelKey` — the decision is to use bare fields directly.
- **Making platform/channelId optional:** Both must be `string` (required), not `string | undefined`.
- **Gradual migration with compatibility shims:** The decision is one-shot replacement, not a transitional period.
- **Forgetting the DB schema field name:** `horizon/service.ts` declares `scope: "json"` in the Koishi model schema. This is the DB column name. Phase 27 does NOT migrate the DB schema (that's CTX-08, Phase 28). The `manager.ts` query logic that filters by `scope` in the DB must be handled carefully — see pitfall below.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding all Scope usages | Manual grep | Already done in research | 13 files fully mapped |
| Type compatibility checking | Runtime tests | `yarn typecheck` / `tsc --noEmit` | Catches all type errors statically |

**Key insight:** This is a mechanical refactoring. The TypeScript compiler is the verification tool — once `yarn build` passes with zero errors, the migration is complete.

## Common Pitfalls

### Pitfall 1: DB Schema Column Name vs TypeScript Field Name

**What goes wrong:** `horizon/service.ts` declares `scope: "json"` in `ctx.model.extend("yesimbot.timeline", ...)`. This is the actual database column name. The `manager.ts` query `query.scope = options.scope` filters by this DB column. Phase 27 does NOT change the DB schema (that's Phase 28 CTX-08). So the DB column `scope` still exists.

**Why it happens:** The TypeScript type `BaseTimelineEntry` will no longer have a `scope` field after migration, but the DB column still exists. The `EventQueryOptions` will use `key?: ChannelKey` but the actual DB query must still filter by the `scope` JSON column.

**How to avoid:** In Phase 27, the `manager.ts` query method needs special handling. Two options:
1. Keep the DB query using the raw `scope` column name via a cast/workaround until Phase 28 migrates the schema
2. Accept that `EventQueryOptions.key` filtering is temporarily disabled at the DB level (queries return all records for the channel, filtered in memory)

**Recommendation:** Since Phase 28 handles CTX-08 (DB schema migration), Phase 27 should keep the DB query working. The safest approach: in `manager.ts`, when `options.key` is provided, construct the DB filter as `{ scope: { platform: options.key.platform, channelId: options.key.channelId } }` — this matches the existing JSON column structure. This is a temporary bridge that Phase 28 will replace.

**Warning signs:** TypeScript error on `query.scope` after removing `scope` from `TimelineEntry` type.

### Pitfall 2: isDirect Loss in scene.ts

**What goes wrong:** `scene.ts` `detect()` uses `scope.isDirect` to determine `"private-chat"` vs `"group-chat"`. After migration, `ChannelKey` has no `isDirect`.

**Why it happens:** `isDirect` was deleted from the type by design.

**How to avoid:** The `detect(key: ChannelKey, view: HorizonView)` signature no longer has `isDirect`. Options:
1. Derive from `view` — check if `view.environment?.type === "private"` (already set from session data)
2. Default to `"group-chat"` when indeterminate

**Recommendation:** Use `view.environment?.type === "private" ? "private-chat" : "group-chat"`. The `Environment.type` is already set correctly from session data in `getOrCreateEnvironment`.

### Pitfall 3: agent/service.ts isDirect for Rate Limiter

**What goes wrong:** `handleEvent` reads `event.scope.isDirect` to choose between `dm` and `group` rate limiter buckets. After migration, `HorizonMessageEvent` has no `isDirect`.

**Why it happens:** `isDirect` deleted from type.

**How to avoid:** Read from `event.runtime?.session?.isDirect`. The `runtime` field is already present on `HorizonMessageEvent` and contains the session.

```typescript
// AFTER
const isDirect = event.runtime?.session?.isDirect ?? false
```

### Pitfall 4: getEntities parentId Logic

**What goes wrong:** `getEntities(scope: Scope)` uses `scope.guildId` and `scope.isDirect` to build `parentId`. After migration, these fields are gone.

**Why it happens:** `guildId` and `isDirect` deleted from type.

**How to avoid:** `getEntities` is called from `buildView(key: ChannelKey, options?)`. The `options.session` is available. Pass session down to `getEntities`, or change the signature to accept `session?: Session` as a second parameter.

```typescript
// AFTER
async getEntities(key: ChannelKey, session?: Session): Promise<Entity[]> {
  const isDirect = session?.isDirect ?? false
  const guildId = session?.guildId
  const parentId = guildId
    ? `guild:${guildId}`
    : isDirect
      ? `direct:${key.platform}`
      : null
  // ...
}
```

### Pitfall 5: getOrCreateEnvironment guildId for bot.getChannel

**What goes wrong:** `getOrCreateEnvironment` calls `session.bot.getChannel(scope.channelId, scope.guildId)`. After migration, `guildId` is not in `ChannelKey`.

**How to avoid:** Read `guildId` from `session.guildId` directly — the session is already a parameter.

```typescript
// AFTER
const ch = await session.bot.getChannel(key.channelId, session.guildId)
```

### Pitfall 6: Forgetting agent/loop.ts percept.scope usages

**What goes wrong:** `loop.ts` has 7 usages of `percept.scope.*` — these all become `percept.*` after `Percept` gets bare fields.

**Key locations in loop.ts:**
- Line 62: `horizon.buildView(percept.scope, ...)` → `horizon.buildView({ platform: percept.platform, channelId: percept.channelId }, ...)`
- Line 73: `trait.analyze(percept.scope, view)` → `trait.analyze({ platform: percept.platform, channelId: percept.channelId }, view)`
- Line 74: `skill.resolve(signals, percept.scope)` → `skill.resolve(signals, { platform: percept.platform, channelId: percept.channelId })`
- Line 147: `percept.scope.platform` + `percept.scope.channelId` → `percept.platform` + `percept.channelId`
- Lines 317, 358: `scope: percept.scope` in recordAgentResponse → `platform: percept.platform, channelId: percept.channelId`
- Lines 380, 383: `percept.scope` in markAsActive/archiveStale → `{ platform: percept.platform, channelId: percept.channelId }`

### Pitfall 7: agent/service.ts reportError

**What goes wrong:** Line 523: `percept.scope.channelId` → `percept.channelId` after migration.

## Code Examples

### shared/types.ts — Final State

```typescript
// Source: direct codebase analysis

export type TriggerType =
  | "mention"
  | "reply"
  | "keyword"
  | "random"
  | "direct"
  | "timer"
  | "internal";

// Replaces Scope interface
export type ChannelKey = { platform: string; channelId: string };

export interface Percept {
  id: string;
  traceId: string;
  type: TriggerType;
  platform: string;      // was: scope: Scope
  channelId: string;     // was: scope: Scope
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface TraitSignal {
  dimension: string;
  value: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}
```

### horizon/types.ts — Key Changes

```typescript
// HorizonMessageEvent: scope: Scope → bare fields
export interface HorizonMessageEvent {
  platform: string;      // was: scope: Scope
  channelId: string;     // was: scope: Scope
  timestamp: Date;
  payload: { messageId: string; senderId: string; senderName: string; content: string };
  triggerType: TriggerType;
  runtime?: { session: Session };
}

// BaseTimelineEntry: scope: Scope → bare fields
export interface BaseTimelineEntry<Type extends TimelineEventType, Data extends object> {
  id: string;
  timestamp: Date;
  platform: string;      // was: scope: Scope
  channelId: string;     // was: scope: Scope
  type: Type;
  priority: TimelinePriority;
  stage: TimelineStage;
  data: Data;
}

// EventQueryOptions: scope? → key?
export interface EventQueryOptions {
  key?: ChannelKey;      // was: scope?: Scope
  types?: TimelineEventType[];
  limit?: number;
  since?: Date;
  until?: Date;
  orderBy?: "asc" | "desc";
}
```

### horizon/manager.ts — recordMessage signature

```typescript
// BEFORE
async recordMessage(data: {
  scope: Scope;
  stage: TimelineStage;
  timestamp: Date;
  data: MessageEventData;
}): Promise<MessageRecord>

// AFTER
async recordMessage(data: {
  platform: string;
  channelId: string;
  stage: TimelineStage;
  timestamp: Date;
  data: MessageEventData;
}): Promise<MessageRecord>
```

### horizon/listener.ts — inline object construction

```typescript
// BEFORE
this.ctx.emit("horizon/message", {
  scope: {
    platform: session.platform,
    channelId: session.channelId,
    guildId: session.guildId,
    isDirect: session.isDirect,
  },
  // ...
});

// AFTER
this.ctx.emit("horizon/message", {
  platform: session.platform,
  channelId: session.channelId ?? "",
  // guildId/isDirect removed from event; available via runtime.session
  // ...
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `scope: Scope` with 5 optional fields | `ChannelKey` with 2 required fields | Phase 27 | Simpler types, no optional field guards needed |
| `percept.scope.platform` | `percept.platform` | Phase 27 | Flatter access path |
| `event.scope.isDirect` | `event.runtime?.session?.isDirect` | Phase 27 | isDirect sourced from session at point of use |

## Open Questions

1. **DB query compatibility during Phase 27**
   - What we know: `manager.ts` queries the `scope` JSON column; `BaseTimelineEntry` will no longer have `scope` field
   - What's unclear: Whether Koishi's database layer allows querying a JSON column by name even when the TypeScript type doesn't have that field
   - Recommendation: In `manager.ts`, use a type cast for the DB query: `(query as Record<string, unknown>).scope = { platform: options.key.platform, channelId: options.key.channelId }` as a temporary bridge until Phase 28 migrates the DB schema

2. **horizon/service.ts model.extend scope column**
   - What we know: `scope: "json"` is declared in `ctx.model.extend` — this is the DB schema, not the TypeScript type
   - What's unclear: Whether removing `scope` from the TypeScript type causes a Koishi type error on the model.extend call
   - Recommendation: Keep `scope: "json"` in the model.extend call for Phase 27 (DB schema unchanged until Phase 28). Add a comment noting it will be removed in Phase 28.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis — all 13 affected files read and analyzed
- `/home/workspace/Athena/core/src/services/shared/types.ts` — Scope interface definition
- `/home/workspace/Athena/core/src/services/horizon/types.ts` — HorizonMessageEvent, BaseTimelineEntry, EventQueryOptions
- `/home/workspace/Athena/core/src/services/horizon/service.ts` — buildView, getOrCreateEnvironment, getEntities
- `/home/workspace/Athena/core/src/services/horizon/manager.ts` — recordMessage, recordAgentResponse, markAsActive, archiveStale
- `/home/workspace/Athena/core/src/services/horizon/listener.ts` — inline scope construction
- `/home/workspace/Athena/core/src/services/trait/types.ts` — TraitDetector interface
- `/home/workspace/Athena/core/src/services/trait/service.ts` — analyze method
- `/home/workspace/Athena/core/src/services/trait/detectors/heat.ts` — channelKey helper, detect
- `/home/workspace/Athena/core/src/services/trait/detectors/scene.ts` — channelKey helper, detect, isDirect usage
- `/home/workspace/Athena/core/src/services/skill/service.ts` — resolve method
- `/home/workspace/Athena/core/src/services/plugin/types.ts` — ToolExecutionContext
- `/home/workspace/Athena/core/src/services/agent/service.ts` — buildPercept, handleEvent, reportError
- `/home/workspace/Athena/core/src/services/agent/loop.ts` — 7 percept.scope usages

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, pure TypeScript refactoring
- Architecture: HIGH — all files read, all usage sites mapped, migration patterns derived from actual code
- Pitfalls: HIGH — identified from direct code analysis, not speculation

**Research date:** 2026-02-26
**Valid until:** Stable — pure internal refactoring, no external dependencies
