# Phase 28: Environment Simplification & DB Schema - Research

**Researched:** 2026-02-26
**Domain:** Koishi/Minato database schema migration + TypeScript interface refactor
**Confidence:** HIGH

## Summary

Phase 28 is a pure internal refactor with two tightly coupled changes. First, the `Environment` interface in `types.ts` carries a redundant `metadata` indirection layer — `platform` and `channelId` are already declared as first-class optional fields on the interface, but `service.ts` reads them back via `env.metadata?.platform` and `env.metadata?.channelId`. Removing `metadata` and promoting those fields to required makes the type honest and eliminates the indirection (CTX-07).

Second, the `yesimbot.timeline` table currently stores channel identity as a single `scope: "json"` column. The TypeScript type `BaseTimelineEntry` already declares `platform: string` and `channelId: string` as bare fields — the DB schema is simply behind the type. All five write sites in `manager.ts` use `as unknown as` casts to bridge the mismatch, and the query site constructs `scope = { platform, channelId }` JSON equality. Replacing the column with two `string` columns and updating all five write/query sites removes the casts and aligns schema with types (CTX-08).

No new libraries are needed. No data migration is needed — timeline is ephemeral chat history that rebuilds naturally on restart. The `as unknown as` casts in `manager.ts` are the clearest signal of where work is needed; removing them is the success indicator for CTX-08.

**Primary recommendation:** Work CTX-08 (DB schema) and CTX-07 (Environment interface) together in a single plan — they touch the same files and the type changes in `types.ts` unlock the cast removal in `manager.ts`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- 直接替换列：删除 `scope` JSON 列，新增 `platform` (string) 和 `channelId` (string) 独立列
- 不保留旧数据——timeline 是临时聊天记录，重启后自然重建
- 不需要迁移脚本
- `getOrCreateEnvironment` 已经接受 `ChannelKey`（platform + channelId），无需改动签名
- 移除 Environment 接口中的 `metadata` 间接层，platform/channelId 作为一等字段
- 类型层面 `BaseTimelineEntry` 已有 platform/channelId 裸字段，对齐实际 DB 写入即可

### Claude's Discretion

- schema 声明中 platform/channelId 列的具体长度限制
- 查询语句的具体重构方式
- 是否需要为 platform+channelId 添加索引

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CTX-07 | 简化 Environment 构造——消除 Scope→Environment 的冗余转换 | Environment interface in `types.ts` has `metadata: Record<string,unknown>` that duplicates `platform`/`channelId` already on the interface; `service.ts` reads via `metadata?.platform` in 3 places; removing `metadata` and making `platform`/`channelId` required eliminates the indirection |
| CTX-08 | 迁移 timeline 数据库 schema，scope JSON 列改为 platform + channelId 独立列 | `service.ts:82` declares `scope: "json"`; `manager.ts` has 5 write/query sites using `scope: { platform, channelId }` with `as unknown as` casts; replacing with two `string(N)` columns and bare field queries removes all casts |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Koishi (Minato) | workspace | DB schema declaration via `ctx.model.extend` | Project's ORM — already in use |
| TypeScript | workspace | Type-level changes to `Environment` interface | Project language |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 | Test runner | Existing test infrastructure in `core/` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct column replacement | SQL migration script | Not needed — data is ephemeral, restart rebuilds |
| `string(255)` for platform/channelId | `text` | `string(N)` is idiomatic in this codebase (see `id: "string(32)"`, `name: "string(255)"`) |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure

No structural changes. All edits are within:

```
core/src/services/horizon/
├── types.ts        # Environment interface — remove metadata, promote platform/channelId
├── service.ts      # model.extend schema — replace scope:json with platform/channelId columns
│                   # getOrCreateEnvironment — read/write bare fields instead of metadata
│                   # formatHorizonText — read env.platform / env.channelId directly
└── manager.ts      # 5 write/query sites — replace scope:{} with bare fields, remove casts
```

### Pattern 1: Minato bare string column declaration

**What:** Replace `scope: "json"` with two `string(N)` columns in `ctx.model.extend`.
**When to use:** When a JSON column stores a flat object whose fields are individually queryable.
**Example:**

```typescript
// Source: existing codebase pattern (service.ts lines 81-88)
this.ctx.model.extend(
  "yesimbot.timeline",
  {
    id: "string(32)",
    platform: "string(64)",   // replaces scope: "json"
    channelId: "string(255)", // replaces scope: "json"
    type: "string(32)",
    priority: "unsigned",
    stage: "string(16)",
    timestamp: "timestamp",
    data: "json",
  } as Record<string, unknown> as never,
  { primary: "id", autoInc: false },
);
```

### Pattern 2: Minato bare field equality query

**What:** Query by bare string columns instead of JSON object equality.
**When to use:** After migrating from JSON column to bare columns.
**Example:**

```typescript
// BEFORE (scope JSON equality — manager.ts line 34)
(query as Record<string, unknown>).scope = { platform: options.key.platform, channelId: options.key.channelId };

// AFTER (bare field equality — no cast needed)
query.platform = options.key.platform;
query.channelId = options.key.channelId;
```

### Pattern 3: Bare field write (create/set)

**What:** Write `platform` and `channelId` directly on the entry object.
**When to use:** In `recordMessage`, `recordAgentResponse`, `markAsActive`, `archiveStale`.
**Example:**

```typescript
// BEFORE (manager.ts lines 57-59)
const entry = {
  id: Random.id(),
  type: TimelineEventType.Message,
  priority: TimelinePriority.Normal,
  scope: { platform: data.platform, channelId: data.channelId }, // cast required
  ...
} as unknown as MessageRecord;

// AFTER (no cast needed — aligns with BaseTimelineEntry)
const entry: MessageRecord = {
  id: Random.id(),
  type: TimelineEventType.Message,
  priority: TimelinePriority.Normal,
  platform: data.platform,
  channelId: data.channelId,
  ...
};
```

### Pattern 4: Environment interface — promote bare fields, remove metadata

**What:** `Environment` in `types.ts` currently has `platform?: string`, `channelId?: string`, and `metadata: Record<string,unknown>`. After CTX-07, `platform` and `channelId` become required, `metadata` is removed.
**When to use:** Everywhere `env.metadata?.platform` or `env.metadata?.channelId` is read.
**Example:**

```typescript
// BEFORE (types.ts)
export interface Environment {
  type: string;
  id: string;
  name: string;
  platform?: string;
  channelId?: string;
  description?: string;
  metadata: Record<string, unknown>;
}

// AFTER
export interface Environment {
  type: string;
  id: string;
  name: string;
  platform: string;
  channelId: string;
  description?: string;
}
```

```typescript
// BEFORE (service.ts formatHorizonText — lines 297-298, 316, 350)
const platform = (env.metadata?.platform as string) || "";
const channelId = (env.metadata?.channelId as string) || "";
// ...
? `${view.environment.metadata?.platform}:${view.environment.metadata?.channelId}`
// ...
platform: (view.environment?.metadata?.platform as string) || "{{channel.platform}}",

// AFTER
const platform = env.platform;
const channelId = env.channelId;
// ...
? `${view.environment.platform}:${view.environment.channelId}`
// ...
platform: view.environment?.platform || "{{channel.platform}}",
```

### Anti-Patterns to Avoid

- **Keeping `as unknown as` casts after migration:** Once `BaseTimelineEntry` has bare `platform`/`channelId` fields and the DB schema matches, the casts in `manager.ts` must be removed — they are the bridge that was explicitly deferred to this phase.
- **Partial migration:** Updating the schema declaration without updating all 5 write/query sites in `manager.ts` will cause runtime mismatches (data written to wrong columns, queries returning empty results).
- **Keeping `metadata` on Environment:** After removing it from the interface, any remaining `env.metadata?.platform` reads will be TypeScript errors — use them as a checklist.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DB column rename | Custom SQL ALTER TABLE | Koishi `model.extend` redeclaration | Minato handles schema sync per driver; no raw SQL needed |
| Data migration | Migration script | None — drop and rebuild | Timeline is ephemeral; data loss is acceptable per user decision |

**Key insight:** Minato's `model.extend` is declarative — redefining the schema on next startup causes the driver to sync columns automatically. No manual migration SQL is needed.

## Common Pitfalls

### Pitfall 1: Forgetting the `as Record<string, unknown> as never` cast on model.extend

**What goes wrong:** TypeScript rejects the field map because Minato's `model.extend` types are strict about known table fields.
**Why it happens:** The existing schema declaration already uses this cast pattern (service.ts line 88). New columns must be included in the same cast.
**How to avoid:** Keep the existing `as Record<string, unknown> as never` wrapper when adding `platform` and `channelId` columns.
**Warning signs:** TypeScript error on `model.extend` call after adding new fields.

### Pitfall 2: Incomplete query migration in `markAsActive` and `archiveStale`

**What goes wrong:** `markAsActive` (line 108-116) and `archiveStale` (line 119-128) both build query objects with `scope: { platform, channelId }`. If only the `record*` methods are updated, queries will silently return no results.
**Why it happens:** There are 5 distinct sites in `manager.ts` — easy to miss the `set`-based ones.
**How to avoid:** Use the `// Phase 28 (CTX-08)` comments as a checklist — there are exactly 5 of them in `manager.ts`.
**Warning signs:** `markAsActive` and `archiveStale` silently do nothing after migration.

### Pitfall 3: `formatHorizonText` still reads `metadata` after interface change

**What goes wrong:** After removing `metadata` from `Environment`, `formatHorizonText` has 3 read sites that use `env.metadata?.platform` / `env.metadata?.channelId`. TypeScript will catch these as errors.
**Why it happens:** The method was written before the interface cleanup.
**How to avoid:** Let TypeScript errors guide the fix — after removing `metadata` from the interface, the compiler will flag all 3 sites.
**Warning signs:** `tsc --noEmit` errors in `service.ts` after `types.ts` change.

### Pitfall 4: `getOrCreateEnvironment` still writes `metadata` on return

**What goes wrong:** `getOrCreateEnvironment` returns `Environment` objects with `metadata: { platform, channelId, ... }` at lines 148 and 181. After removing `metadata` from the interface, these must be updated.
**Why it happens:** The return objects are constructed inline — easy to miss.
**How to avoid:** TypeScript errors will flag these after the interface change.

## Code Examples

Verified patterns from codebase inspection:

### Complete manager.ts query method after migration

```typescript
// Source: manager.ts (current lines 30-43, after CTX-08)
async query(options: EventQueryOptions): Promise<TimelineEntry[]> {
  const query: Query.Expr<TimelineEntry> = {};
  if (options.key) {
    query.platform = options.key.platform as unknown as Query.Expr<TimelineEntry>["platform"];
    query.channelId = options.key.channelId as unknown as Query.Expr<TimelineEntry>["channelId"];
  }
  if (options.types?.length)
    query.type = { $in: options.types } as unknown as Query.Expr<TimelineEntry>["type"];
  if (options.since) query.timestamp = { $gte: options.since };
  if (options.until) query.timestamp = { ...(query.timestamp as object), $lte: options.until };

  let q = this.ctx.database.select(TIMELINE_TABLE).where(query);
  if (options.orderBy) q = q.orderBy("timestamp", options.orderBy);
  if (options.limit) q = q.limit(options.limit);
  return q.execute() as Promise<TimelineEntry[]>;
}
```

### Complete recordMessage after migration

```typescript
// Source: manager.ts (current lines 46-65, after CTX-08)
async recordMessage(data: {
  platform: string;
  channelId: string;
  stage: TimelineStage;
  timestamp: Date;
  data: MessageEventData;
}): Promise<MessageRecord> {
  const entry: MessageRecord = {
    id: Random.id(),
    type: TimelineEventType.Message,
    priority: TimelinePriority.Normal,
    platform: data.platform,
    channelId: data.channelId,
    stage: data.stage,
    timestamp: data.timestamp,
    data: data.data,
  };
  this.logger.info(`record message ${data.data.senderId}: ${data.data.content}`);
  return this.record(entry) as Promise<MessageRecord>;
}
```

### Column length recommendation

```typescript
// Recommended lengths (Claude's discretion):
// platform: "string(64)"  — platform identifiers like "discord", "telegram", "onebot" are short
// channelId: "string(255)" — channel IDs can be long (Discord snowflakes, Telegram chat IDs)
// Consistent with existing: name: "string(255)", id: "string(64)"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `scope: Scope` on all interfaces | `platform: string` + `channelId: string` bare fields | Phase 27 (CTX-01 through CTX-06) | DB schema is the last holdout |
| `scope: "json"` DB column | `platform: "string(64)"` + `channelId: "string(255)"` | Phase 28 (this phase) | Enables indexed queries, removes casts |
| `metadata: Record<string,unknown>` on Environment | `platform: string` + `channelId: string` required fields | Phase 28 (this phase) | Removes indirection, type-safe reads |

## Open Questions

1. **Query.Expr typing for bare string fields**
   - What we know: The existing code uses `as unknown as Query.Expr<TimelineEntry>["type"]` for the `type` field query. The same pattern may be needed for `platform`/`channelId` depending on how Minato types `Query.Expr` for string fields.
   - What's unclear: Whether `query.platform = "discord"` compiles cleanly or needs a cast.
   - Recommendation: Try without cast first; if TypeScript rejects it, apply the same `as unknown as` pattern already used for `type`.

2. **Index on platform+channelId**
   - What we know: Minato supports composite indexes via `Driver.Index`. The user left this to Claude's discretion.
   - What's unclear: Whether Minato's `model.extend` options support index declaration directly.
   - Recommendation: Skip index for now — timeline queries are bounded by `historyLimit` (default 30) and the table is ephemeral. Add if query performance becomes a concern.

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection — `core/src/services/horizon/manager.ts`, `service.ts`, `types.ts` — all Phase 28 annotation sites verified
- `/home/workspace/Athena/node_modules/minato/lib/index.d.ts` — `Field.Type<T>` definition confirms `string` maps to `'char' | 'string' | 'text'` shorthands
- `core/src/services/horizon/__tests__/format-horizon-text.test.ts` — existing test infrastructure confirmed (vitest, no DB mocking needed for this test)

### Secondary (MEDIUM confidence)

- Existing `model.extend` call in `service.ts` lines 78-104 — confirms `string(N)` shorthand syntax and `as Record<string, unknown> as never` cast pattern

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all patterns verified in codebase
- Architecture: HIGH — all 5 write/query sites in manager.ts identified via grep, all metadata read sites in service.ts identified
- Pitfalls: HIGH — derived from direct code inspection, not speculation

**Research date:** 2026-02-26
**Valid until:** Stable — internal refactor, no external dependencies
