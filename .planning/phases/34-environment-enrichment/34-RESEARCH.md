# Phase 34: Environment Enrichment - Research

**Researched:** 2026-02-27
**Domain:** Koishi session/bot APIs, entity data model, HorizonView rendering
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**身份呈现格式**

- 使用 `<member>` 标签包装 entity 信息，自然语言混合格式呈现
- userId（平台账号 ID）作为 entity 主键，替代现有 entity id
- nickname 与 username 相同时智能省略，减少冗余 token
- Bot 自身 entity 标记为 self，使 LLM 能区分自己在群里的身份
- 不标注其他成员是否为 bot

**数据模型：用户为主，成员为辅**

- entity 表仅存人（单聊用户 + 群聊成员），不存群组本身
- 用户（user）为主记录，主键 platform:userId
- 成员（member）为辅助数据挂在用户上，存储群内特有属性集合（nickname、role、入群时间等）
- 需调整 entity 表主键结构以适配 platform:userId / platform:guildId:memberId 模式

**权限信息粒度**

- 粗粒度角色等级：owner / admin / member 三级
- 只展示 owner 和 admin，普通 member 不标注 role（减少 token 噪音）
- role 信息挂在 entity 上，包括 self entity
- 所有成员都可携带 role 属性，但仅 owner/admin 实际显示
- 缓存 role 信息 + 平台事件触发刷新（如权限变更事件）

**platformId 暴露策略（ENV-04）**

- `<msg>` 标签不需要额外暴露 platformId 属性
- Phase 25 已建立短 ID 映射机制，本 phase 确保映射表补全平台原始 messageId
- delmsg 等工具通过短 ID 调用后自动还原为平台长 ID

**降级与缺失处理**

- 省略缺失字段，不显示占位符；userId 作为最低保障始终存在
- role 查询失败时（API 超时、平台不支持）静默降级为无 role，不阻塞消息处理
- 群成员列表整体获取失败时，从消息历史中提取已出现的用户作为回退
- 单聊场景只提取对方 entity，不涉及成员列表

### Claude's Discretion

- `<member>` 标签的具体自然语言格式和属性排列
- entity 表主键迁移的具体实现方式
- role 缓存的 TTL 和刷新策略细节
- 成员列表从消息历史回退的具体提取逻辑

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                            | Research Support                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ENV-01 | Entity 记录包含 `userId`（平台账号 ID）作为稳定标识                    | Entity table primary key migration: `platform:userId` pattern; `session.userId` = `session.event.user.id` is the stable platform account ID                                        |
| ENV-02 | Entity 区分 `username`（账号名）和 `nickname`（群昵称/显示名）         | `session.author` = `{ ...session.event.user, ...session.event.member }` — `user.name` is account name, `member.name` (nick) is guild display name; store both in entity attributes |
| ENV-03 | Bot 自身 role 信息可查询并注入 HorizonView，LLM 知道自己是否有管理权限 | `bot.getGuildMember(guildId, bot.selfId)` returns bot's own GuildMember with roles; inject into `SelfInfo` and render in `<members>` block                                         |
| ENV-04 | `<msg>` 标签中暴露 `platformId`，使 delmsg 等工具可引用真实消息 ID     | Short ID map already stores `platformMsgId → shortId`; need reverse map `shortId → platformMsgId`; `lookupPlatformId(channelKey, shortId)` method on HorizonService                |

</phase_requirements>

## Summary

Phase 34 enriches the HorizonView working memory with accurate, stable identity information. The work splits into four areas: (1) entity data model migration to use `platform:userId` as primary key and store `username`/`nickname` as distinct fields, (2) rendering the `<members>` block with `<member>` tags that expose userId, username, nickname, and role, (3) querying the bot's own guild role via `bot.getGuildMember()` and injecting it into the self entity, and (4) adding a reverse short-ID lookup so tools like `delmsg` can resolve a short ID back to the platform message ID.

The Koishi session API already provides all the data needed. `session.author` is a merged `GuildMember & User` object where `session.event.user.name` is the account name and `session.event.member.name` (exposed as `session.author.nick`) is the guild nickname. `session.userId` (`session.event.user.id`) is the stable platform account ID. The bot's own role can be fetched via `bot.getGuildMember(guildId, bot.selfId)` — this is a standard Koishi Bot API call.

The current entity table uses `platform:userId@parentId` as the composite ID string. The migration changes this to separate `userId` as a first-class field in `attributes` (or as a dedicated column), and stores `username` and `nickname` distinctly. The short-ID map already maps `platformMsgId → shortId`; ENV-04 requires adding the reverse direction `shortId → platformMsgId` as a second in-memory map.

**Primary recommendation:** Extend `EntityRecord` with explicit `userId`, `username`, `nickname` fields; add `lookupPlatformId()` reverse map to `HorizonService`; fetch bot's own role lazily with TTL cache; update `formatHorizonText` to render `<member>` tags.

## Standard Stack

### Core

| Library         | Version | Purpose                                  | Why Standard                                               |
| --------------- | ------- | ---------------------------------------- | ---------------------------------------------------------- |
| koishi          | 4.x     | Session/Bot API for member info          | Already in use; `bot.getGuildMember()` is the standard API |
| Koishi database | 4.x     | Entity persistence via `ctx.database`    | Already in use; `upsert` pattern established               |
| Mustache        | latest  | Template rendering for `<members>` block | Already in use for `horizon-view.mustache`                 |

### Supporting

| Library    | Version | Purpose | When to Use                  |
| ---------- | ------- | ------- | ---------------------------- |
| (none new) | —       | —       | Zero new dependencies needed |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended File Changes

```
core/src/services/horizon/
├── types.ts          # Add userId, username, nickname to EntityRecord; add role to SelfInfo
├── service.ts        # Add lookupPlatformId(), bot role cache, updated formatHorizonText
├── listener.ts       # Update updateMemberInfo() to store userId/username/nickname separately
└── __tests__/
    └── entity-enrichment.test.ts   # Unit tests for new entity fields and member rendering
```

### Pattern 1: Koishi session.author field mapping

**What:** `session.author` is `GuildMember & User`. The `User` part has `id` (platform account ID) and `name` (account name). The `GuildMember` part has `name` (guild nickname, overrides User.name in the merged object) and `avatar`.

**Key mapping:**

```typescript
// Source: Koishi session.md — session.author = { ...session.event.user, ...session.event.member }
// GuildMember.name overrides User.name in the merge

const userId = session.userId; // session.event.user.id — stable platform account ID
const username = session.event.user?.name; // account name (e.g. "alice123")
const nickname =
  session.author?.nick ?? // guild display name (e.g. "Alice")
  session.author?.name ?? // fallback: merged name (GuildMember.name wins)
  username; // final fallback

// nick is the GuildMember-specific name field (not in User)
// When nick is absent, author.name is the GuildMember.name which overrides User.name
```

**Confidence:** HIGH — verified from Koishi session.md: `session.author = { ...session.event.user, ...session.event.member }` with GuildMember fields overriding User fields.

### Pattern 2: Entity primary key migration

**What:** Current entity ID is `platform:userId@parentId` (a single composite string). The decision is to use `platform:userId` as the user primary key and store guild-specific data in attributes.

**Recommended approach (minimal migration):**

```typescript
// EntityRecord — add explicit fields, keep id as composite string for DB compat
export interface EntityRecord {
  id: string; // "platform:userId" for users, "platform:userId@guild:guildId" for members
  type: string; // "user" | "member"
  name: string; // display name (nickname if available, else username)
  userId: string; // NEW: platform account ID (stable identifier)
  username: string; // NEW: account name from User.name
  nickname?: string; // NEW: guild display name from GuildMember.name/nick (null if same as username)
  parentId?: string; // guild scope: "guild:guildId"
  refId?: string; // for member records: points to user record
  attributes: Record<string, unknown>; // roles, avatar, lastActive, etc.
  updatedAt: Date;
}
```

**DB schema extension:**

```typescript
this.ctx.model.extend(
  "yesimbot.entity",
  {
    id: "string(64)",
    type: "string(32)",
    name: "string(255)",
    userId: "string(255)", // NEW
    username: "string(255)", // NEW
    nickname: "string(255)", // NEW (nullable)
    parentId: "string(255)",
    refId: "string(255)",
    attributes: "json",
    updatedAt: "timestamp",
  },
  { primary: "id" },
);
```

Koishi's `model.extend` is additive — adding new columns to an existing table is safe and non-destructive.

### Pattern 3: Bot self role query

**What:** Fetch the bot's own GuildMember record to get its role in the guild.

```typescript
// Source: Koishi member.md — bot.getGuildMember(guildId, userId)
async function getBotRole(session: Session): Promise<string | null> {
  if (!session.guildId || !session.bot.selfId) return null;
  try {
    const member = await session.bot.getGuildMember(session.guildId, session.bot.selfId);
    const roles: string[] = (member as any).roles ?? [];
    return classifyRole(roles); // "owner" | "admin" | null
  } catch {
    return null; // platform doesn't support or API error — silent degradation
  }
}

function classifyRole(roles: string[]): "owner" | "admin" | null {
  if (roles.some((r) => /^owner$/i.test(r))) return "owner";
  if (roles.some((r) => /^(admin|administrator|moderator)$/i.test(r))) return "admin";
  return null;
}
```

**Caching:** Store in a `Map<channelKey, { role: string | null; fetchedAt: number }>` with TTL (e.g. 10 minutes). Invalidate on `guild-role-updated` or `guild-member-updated` events.

**Confidence:** HIGH — `bot.getGuildMember(guildId, userId)` is standard Koishi Bot API.

### Pattern 4: Reverse short-ID lookup (ENV-04)

**What:** The current `shortIdMaps` stores `platformMsgId → shortId`. Tools like `delmsg` receive a short ID from the LLM and need to resolve it back to the platform message ID.

```typescript
// Add alongside existing shortIdMaps in HorizonService
private shortIdReverse = new Map<string, Map<number, string>>()
// channelKey -> (shortId -> platformMsgId)

assignShortId(channelKey: string, platformMsgId: string): number {
  // ... existing logic ...
  // ADD: also populate reverse map
  let rev = this.shortIdReverse.get(channelKey)
  if (!rev) {
    rev = new Map()
    this.shortIdReverse.set(channelKey, rev)
  }
  rev.set(counter, platformMsgId)
  // Evict from reverse map when evicting from forward map
  return counter
}

lookupPlatformId(channelKey: string, shortId: number): string | undefined {
  return this.shortIdReverse.get(channelKey)?.get(shortId)
}
```

**Eviction:** When the forward map evicts entries (at size >= 100), the reverse map must evict the same entries. Keep them in sync.

### Pattern 5: `<member>` tag rendering

**What:** The `activeMembers` string in `formatHorizonText` currently renders as a comma-separated list of names. Replace with `<member>` tags.

```typescript
// Render each entity as a <member> tag
function renderMember(entity: Entity, isSelf: boolean): string {
  const parts: string[] = [];

  // userId is always present
  parts.push(`id="${entity.userId}"`);

  // name: show nickname if different from username
  const displayName =
    entity.nickname && entity.nickname !== entity.username
      ? `${entity.nickname} (${entity.username})`
      : (entity.nickname ?? entity.username ?? entity.name);
  parts.push(`name="${displayName}"`);

  // role: only show owner/admin
  const role = classifyRole((entity.attributes?.roles as string[]) ?? []);
  if (role) parts.push(`role="${role}"`);

  // self marker
  if (isSelf) parts.push(`self="true"`);

  return `<member ${parts.join(" ")} />`;
}
```

**Template change:** The `<members>` block in `horizon-view.mustache` already uses `{{activeMembers}}` — the rendered string just changes from comma-separated names to newline-separated `<member>` tags.

### Anti-Patterns to Avoid

- **Fetching full guild member list on every message:** `bot.getGuildMemberList()` is expensive. Only fetch the bot's own member record for role; populate other members from message events (passive accumulation).
- **Blocking message processing on role fetch:** Role query for bot self should be async with timeout; failure must not block the pipeline.
- **Storing guild channel as entity:** The decision is entity table stores only people, not channels/guilds.
- **Mutating EntityRecord in place:** Follow immutability rules — use `upsert` with a new object, not field mutation.

## Don't Hand-Roll

| Problem             | Don't Build               | Use Instead                              | Why                                                     |
| ------------------- | ------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| Bot role detection  | Custom permission system  | `bot.getGuildMember(guildId, selfId)`    | Standard Koishi API; platform-agnostic                  |
| Member list         | Proactive full-list fetch | Passive accumulation from message events | Avoids expensive API calls; fallback is already decided |
| DB schema migration | Manual ALTER TABLE        | `ctx.model.extend()` additive columns    | Koishi ORM handles schema evolution safely              |

## Common Pitfalls

### Pitfall 1: `session.author.name` vs `session.event.user.name`

**What goes wrong:** `session.author` merges `GuildMember` over `User`. `GuildMember.name` (the guild nickname) overrides `User.name` (the account name) in the merged object. So `session.author.name` gives the guild nickname, not the account name.

**Why it happens:** Koishi's resource promotion rule: inner resources are promoted to outer level, with GuildMember fields winning over User fields.

**How to avoid:** Access `session.event.user?.name` for the account name (username). Access `session.author.nick ?? session.author.name` for the guild display name (nickname). The `nick` field is GuildMember-specific and is not present on User.

**Warning signs:** username and nickname always being identical — means you're reading the merged `author.name` for both.

### Pitfall 2: `bot.getGuildMember()` not supported on all platforms

**What goes wrong:** Some Koishi adapters don't implement `getGuildMember`. Calling it throws or returns undefined.

**Why it happens:** Koishi's Bot API is a standard interface but adapters implement it selectively.

**How to avoid:** Wrap in try/catch, return `null` on any error. The decision is to silently degrade — no role shown, not an error.

### Pitfall 3: Short-ID reverse map eviction desync

**What goes wrong:** Forward map evicts entries when size >= 100, but reverse map is not evicted. Over time the reverse map grows unbounded, or worse, stale entries cause wrong platform ID lookups.

**Why it happens:** The eviction loop only iterates the forward map keys.

**How to avoid:** During eviction, collect the evicted `platformMsgId` values and delete the corresponding entries from the reverse map too.

### Pitfall 4: Entity table primary key collision after migration

**What goes wrong:** Old records used `platform:userId@parentId` as the `id`. New records use `platform:userId`. If both formats coexist, `getEntities()` queries by `parentId` may return mixed results.

**Why it happens:** `model.extend` adds columns but doesn't migrate existing rows.

**How to avoid:** The new `userId` column will be empty for old rows. `updateMemberInfo()` writes new rows with the new format. Old rows are effectively orphaned and will be overwritten on next message from that user. No explicit migration script needed — passive overwrite is sufficient given the TTL-based cache pattern already in use.

### Pitfall 5: `<member>` tag injection in `activeMembers` string

**What goes wrong:** The `activeMembers` variable in the Mustache template uses `{{activeMembers}}` (HTML-escaped). If `<member>` tags are passed through this, Mustache will escape the `<` and `>` characters.

**Why it happens:** Mustache `{{var}}` escapes HTML by default.

**How to avoid:** Use triple-mustache `{{{activeMembers}}}` in the template for the members block, since the content is trusted (generated internally, not from user input). This is consistent with how `{{{.}}}` is already used for history entries.

## Code Examples

### Updating `updateMemberInfo()` in listener.ts

```typescript
// Source: Koishi session.md — session.author, session.userId, session.event.user
private async updateMemberInfo(session: Session, parentId: string): Promise<void> {
  if (!session.author) return
  const userId = session.userId  // session.event.user.id — stable platform account ID
  const username = session.event.user?.name ?? userId  // account name
  const nickname = session.author.nick ?? undefined    // guild display name (may be undefined)

  const id = `${session.platform}:${userId}@${parentId}`
  const now = Date.now()
  const last = this.lastEntityUpdate.get(id)
  if (last && now - last < 60000) return
  this.lastEntityUpdate.set(id, now)

  try {
    await this.ctx.database.upsert(ENTITY_TABLE, [{
      id,
      type: "member",
      name: nickname ?? username,   // display name for legacy compat
      userId,                        // NEW: stable platform account ID
      username,                      // NEW: account name
      nickname: nickname !== username ? nickname : undefined,  // NEW: omit if same
      parentId,
      attributes: {
        roles: session.author.roles ?? [],
        platform: session.platform,
        avatar: session.author.avatar,
        lastActive: new Date(),
      },
      updatedAt: new Date(),
    }])
  } catch (err: unknown) {
    this.logger.error(`updateMemberInfo failed: ${err instanceof Error ? err.message : err}`)
  }
}
```

### Bot self role injection in `buildView()`

```typescript
// In HorizonService.buildView()
const botRole = await this.getBotRole(key, options?.session)
const self: SelfInfo = {
  id: options?.selfId ?? "",
  name: this.config.botName || options?.selfName || options?.selfId || "",
  role: botRole ?? undefined,  // "owner" | "admin" | undefined
}

// Cache structure (in HorizonService)
private botRoleCache = new Map<string, { role: string | null; fetchedAt: number }>()

private async getBotRole(key: ChannelKey, session?: Session): Promise<string | null> {
  const cacheKey = `${key.platform}:${session?.guildId ?? key.channelId}`
  const cached = this.botRoleCache.get(cacheKey)
  const ttl = 10 * 60 * 1000  // 10 minutes
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached.role

  if (!session?.guildId || !session?.bot?.selfId) return null
  try {
    const member = await session.bot.getGuildMember(session.guildId, session.bot.selfId)
    const roles: string[] = (member as Record<string, unknown>).roles as string[] ?? []
    const role = this.classifyRole(roles)
    this.botRoleCache.set(cacheKey, { role, fetchedAt: Date.now() })
    return role
  } catch {
    this.botRoleCache.set(cacheKey, { role: null, fetchedAt: Date.now() })
    return null
  }
}
```

### `<member>` tag rendering in `formatHorizonText()`

```typescript
// Replace the activeMembers string construction in formatHorizonText()
let activeMembers = "";
if (view.entities?.length) {
  const selfId = view.self.id;
  const lines: string[] = [];

  // Render self entity first
  if (selfId) {
    const selfRole = view.self.role;
    const selfName = view.self.name;
    const rolePart = selfRole ? ` role="${selfRole}"` : "";
    lines.push(`<member id="${selfId}" name="${selfName}"${rolePart} self="true" />`);
  }

  // Render other members
  for (const e of view.entities) {
    if (e.id === selfId) continue; // skip self if already rendered
    const userId = (e as EnrichedEntity).userId ?? e.id;
    const username = (e as EnrichedEntity).username ?? e.name;
    const nickname = (e as EnrichedEntity).nickname;
    const displayName =
      nickname && nickname !== username ? `${nickname} (${username})` : (nickname ?? username);
    const role = this.getRoleBadge(e.attributes); // reuse existing logic
    const rolePart = role ? ` role="${role.trim().slice(1, -1).toLowerCase()}"` : "";
    lines.push(`<member id="${userId}" name="${displayName}"${rolePart} />`);
  }

  activeMembers = lines.join("\n");
}
```

### Reverse short-ID lookup (ENV-04)

```typescript
// Add to HorizonService
private shortIdReverse = new Map<string, Map<number, string>>()
// channelKey -> (shortId -> platformMsgId)

// Extend assignShortId to populate reverse map
assignShortId(channelKey: string, platformMsgId: string): number {
  let map = this.shortIdMaps.get(channelKey)
  if (!map) {
    map = new Map()
    this.shortIdMaps.set(channelKey, map)
  }
  const existing = map.get(platformMsgId)
  if (existing !== undefined) return existing

  // Evict oldest entries if map exceeds 100
  if (map.size >= 100) {
    let evictCount = map.size - 80
    let rev = this.shortIdReverse.get(channelKey)
    for (const [pid] of map) {
      if (evictCount-- <= 0) break
      const sid = map.get(pid)
      map.delete(pid)
      if (sid !== undefined) rev?.delete(sid)  // sync reverse map
    }
  }

  const counter = ((this.shortIdCounters.get(channelKey) ?? 0) % 999) + 1
  this.shortIdCounters.set(channelKey, counter)
  map.set(platformMsgId, counter)

  // Populate reverse map
  let rev = this.shortIdReverse.get(channelKey)
  if (!rev) {
    rev = new Map()
    this.shortIdReverse.set(channelKey, rev)
  }
  rev.set(counter, platformMsgId)

  return counter
}

lookupPlatformId(channelKey: string, shortId: number): string | undefined {
  return this.shortIdReverse.get(channelKey)?.get(shortId)
}
```

### Mustache template fix for `<member>` tags

```mustache
{{! In horizon-view.mustache — change {{activeMembers}} to {{{activeMembers}}} }}
<members>
{{{activeMembers}}}
</members>
```

## State of the Art

| Old Approach                 | Current Approach                   | When Changed | Impact                                           |
| ---------------------------- | ---------------------------------- | ------------ | ------------------------------------------------ |
| `name` only in entity        | `userId` + `username` + `nickname` | Phase 34     | LLM can distinguish stable ID from display names |
| Comma-separated member names | `<member>` tag per entity          | Phase 34     | Structured, parseable identity info for LLM      |
| No bot role in HorizonView   | `self.role` injected               | Phase 34     | LLM knows if it has admin/owner permissions      |
| Forward-only short-ID map    | Bidirectional short-ID map         | Phase 34     | Tools can resolve short ID → platform message ID |

## Open Questions

1. **`session.event.user?.name` availability**
   - What we know: `session.author` merges GuildMember over User; `session.event.user` should be the raw User object
   - What's unclear: Some adapters may not populate `session.event.user` separately from `session.author`
   - Recommendation: Fallback chain: `session.event.user?.name ?? session.author?.name ?? session.userId`; test with OneBot adapter

2. **`GuildMember.roles` field availability**
   - What we know: The Koishi `GuildMember` type definition in the docs shows `{ user, name?, avatar?, joinedAt? }` — no `roles` field in the standard interface
   - What's unclear: `session.author.roles` is used in the existing code and works in practice (OneBot adapter extends GuildMember with roles)
   - Recommendation: Keep using `session.author.roles ?? []` with the cast; it's adapter-specific but already proven to work

3. **Bot self entity in `<members>` block**
   - What we know: Decision says bot self entity is marked with `self="true"` in `<member>` tag
   - What's unclear: Whether bot self should be rendered from `view.self` or from `view.entities` (bot may not appear in entity list since it doesn't send user messages)
   - Recommendation: Render bot self from `view.self` directly in `formatHorizonText`, not from entities list; this avoids needing to upsert a bot entity record

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — skip this section.

## Sources

### Primary (HIGH confidence)

- Koishi session.md (`/home/workspace/Athena/references/koishi-docs/zh-CN/api/core/session.md`) — `session.author`, `session.userId`, `session.event.user`, accessor properties
- Koishi member.md (`/home/workspace/Athena/references/koishi-docs/zh-CN/api/resources/member.md`) — `GuildMember` type, `bot.getGuildMember()` API
- Koishi bot.md (`/home/workspace/Athena/references/koishi-docs/zh-CN/api/core/bot.md`) — `bot.selfId`, `bot.user`, full API list
- Koishi user.md (`/home/workspace/Athena/references/koishi-docs/zh-CN/api/resources/user.md`) — `User` type: `{ id, name, avatar? }`
- `/home/workspace/Athena/core/src/services/horizon/service.ts` — current `assignShortId`, `getShortId`, `formatHorizonText`, entity schema
- `/home/workspace/Athena/core/src/services/horizon/listener.ts` — current `updateMemberInfo`, `session.author` usage
- `/home/workspace/Athena/core/src/services/horizon/types.ts` — current `EntityRecord`, `Entity`, `SelfInfo` interfaces
- `/home/workspace/Athena/core/resources/templates/partials/horizon-view.mustache` — current template with `{{activeMembers}}`

### Secondary (MEDIUM confidence)

- `/home/workspace/Athena/references/YesImBot-dev/packages/core/src/services/horizon/types.ts` — v3-dev `MemberEntity` pattern with `userId`/`username`/`nickname` distinction
- `/home/workspace/Athena/references/YesImBot-dev/packages/core/src/services/horizon/listener.ts` — v3-dev `updateMemberInfo` pattern

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies; all APIs verified in Koishi docs
- Architecture: HIGH — patterns derived directly from existing codebase + Koishi API docs
- Pitfalls: HIGH — identified from direct code inspection of current implementation

**Research date:** 2026-02-27
**Valid until:** 2026-03-29 (stable Koishi 4.x APIs)
