# Phase 11: Horizon Context Filling - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Populate Environment and Entity with real data from the live Koishi session, so the LLM sees actual channel names, user names, and roles instead of empty/placeholder values. No new abstractions — fill existing types with real data.

</domain>

<decisions>
## Implementation Decisions

### Environment 填充策略
- Session 优先 + API 兜底：先从 session.channelName / session.guildName 取，取不到再调 bot.getChannel() / bot.getGuild()
- 读时懒加载：在 buildView → getEnvironment 时发现没有记录才去查询并写入
- 数据库 + 时间戳缓存：entity 表的 updatedAt 字段判断是否过期，超过阈值时重新拉取
- Fallback：channel name 取不到时显示 `platform:channelId`

### Entity 数据范围
- 仅活跃用户：只记录发过消息的人，通过 updateMemberInfo 自然积累
- 节流更新：同一用户短时间内多条消息只写一次数据库
- 私聊也记录：私聊场景下对方也作为 Entity 存入
- 扩展字段：除 name/roles/platform 外，加上 avatar、lastActive

### Bot 自身信息
- 配置优先 + session 兜底：用户可在配置中指定 bot 显示名，没配就从 session.bot 取
- 统一名称：多平台场景下 bot 用同一个名字，不按平台区分
- 仅运行时构建：bot 不存入 entity 表，只在 buildView 时动态构建 SelfInfo

### LLM 可见输出格式
- Environment 详细展示：频道名 + 平台 + 频道类型（群聊/私聊）
- Entity 限制数量：只显示最近 N 个活跃成员，避免列表过长
- 消息历史加 role 标记：仅特殊权限（Admin、Owner 等）加标记，普通成员不加
- 英文标签：所有格式标签用英文（"Environment:", "Active members:" 等）

### Claude's Discretion
- Environment 缓存 TTL 具体时长
- Entity 节流的具体时间窗口
- Entity 列表显示数量上限
- 特殊权限 role 的具体判定规则

</decisions>

<specifics>
## Specific Ideas

- role 标记格式示例：`[HH:MM] [Admin] Alice: hello` — 只有特殊权限才加方括号标记
- Environment 展示格式示例：`Environment: #general (Discord, Group)`
- Fallback 格式示例：`Environment: discord:123456789 (Discord, Group)`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-horizon-context-filling*
*Context gathered: 2026-02-20*
