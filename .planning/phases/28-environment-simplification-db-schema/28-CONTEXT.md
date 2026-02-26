# Phase 28: Environment Simplification & DB Schema - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

简化 Environment 构造流程，消除 Scope→Environment 的冗余中间层；将 timeline 数据库表的 `scope` JSON 列拆分为独立的 `platform` 和 `channelId` 列。纯内部重构，无用户可见行为变化。

</domain>

<decisions>
## Implementation Decisions

### 数据库迁移策略
- 直接替换列：删除 `scope` JSON 列，新增 `platform` (string) 和 `channelId` (string) 独立列
- 不保留旧数据——timeline 是临时聊天记录，重启后自然重建
- 不需要迁移脚本

### Environment 构造简化
- `getOrCreateEnvironment` 已经接受 `ChannelKey`（platform + channelId），无需改动签名
- 移除 Environment 接口中的 `metadata` 间接层，platform/channelId 作为一等字段
- 类型层面 `BaseTimelineEntry` 已有 platform/channelId 裸字段，对齐实际 DB 写入即可

### Claude's Discretion
- schema 声明中 platform/channelId 列的具体长度限制
- 查询语句的具体重构方式
- 是否需要为 platform+channelId 添加索引

</decisions>

<specifics>
## Specific Ideas

- `manager.ts` 中所有 `scope: { platform, channelId }` 写入点需改为裸字段赋值
- `service.ts:82` 的 `scope: "json"` schema 声明需替换为两个独立列声明
- `manager.ts` 中查询条件 `scope = { platform, channelId }` 需改为 `platform = x AND channelId = y`
- 代码中已有大量 `// Phase 28 (CTX-08)` 注释标记了所有需要修改的位置

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 28-environment-simplification-db-schema*
*Context gathered: 2026-02-26*
