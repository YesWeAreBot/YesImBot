# Phase 27: Scope Deletion & Module Migration - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

删除 `Scope` 接口，将代码库中所有 13 个文件从 `scope: Scope` 参数迁移到 `platform: string` + `channelId: string` 裸字段。纯重构，不改变任何运行时行为。

</domain>

<decisions>
## Implementation Decisions

### 字段迁移策略
- 只保留 `platform` + `channelId`，删除 `guildId`、`userId`、`isDirect` 三个字段
- 需要这三个字段的地方从 Session 获取（所有使用点都是聊天场景，可访问 Session）
- `platform` 和 `channelId` 都改为必填（非 optional）
- `shared/types.ts` 只删除 Scope 接口定义，保留文件中其他类型

### 函数签名设计
- 使用解构对象风格：`fn(key: ChannelKey, ...)`
- 定义共享类型别名 `type ChannelKey = { platform: string; channelId: string }`
- `ChannelKey` 放在 `shared/types.ts` 中替代 Scope
- ChannelKey 参数保持第一位（与原 scope 参数位置一致）

### 嵌入类型的字段展开
- 数据类型（Percept、HorizonMessageEvent、BaseTimelineEntry 等）使用交叉类型 `& ChannelKey` 展开裸字段
- 一步到位直接替换，不做渐进式迁移（`percept.scope.platform` → `percept.platform`）
- 查询参数类型（EventQueryOptions）改为 `key?: ChannelKey`（保持可选语义）

### Claude's Discretion
- 具体的迁移顺序和分 plan 策略
- channelKey 工具函数是否需要调整
- 各模块内部的局部变量命名

</decisions>

<specifics>
## Specific Ideas

- 函数参数风格统一为解构对象，不用独立参数：`buildView(key: ChannelKey, options?)` 而非 `buildView(platform, channelId, options?)`
- 数据类型和函数参数的处理方式有区分：数据类型用 `& ChannelKey` 交叉，查询参数用 `key?: ChannelKey` 嵌套

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 27-scope-deletion-module-migration*
*Context gathered: 2026-02-26*
