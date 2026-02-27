# Phase 34: Environment Enrichment - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

让 LLM 拥有准确、稳定的频道成员身份信息，并知道自己的权限级别。将平台提供的 userId、username/nickname 区分、bot 权限等信息正确注入 HorizonView 工作记忆，同时确保短 ID 映射表包含平台原始 messageId 以支持 delmsg 等工具操作。

</domain>

<decisions>
## Implementation Decisions

### 身份呈现格式

- 使用 `<member>` 标签包装 entity 信息，自然语言混合格式呈现
- userId（平台账号 ID）作为 entity 主键，替代现有 entity id
- nickname 与 username 相同时智能省略，减少冗余 token
- Bot 自身 entity 标记为 self，使 LLM 能区分自己在群里的身份
- 不标注其他成员是否为 bot

### 数据模型：用户为主，成员为辅

- entity 表仅存人（单聊用户 + 群聊成员），不存群组本身
- 用户（user）为主记录，主键 platform:userId
- 成员（member）为辅助数据挂在用户上，存储群内特有属性集合（nickname、role、入群时间等）
- 需调整 entity 表主键结构以适配 platform:userId / platform:guildId:memberId 模式

### 权限信息粒度

- 粗粒度角色等级：owner / admin / member 三级
- 只展示 owner 和 admin，普通 member 不标注 role（减少 token 噪音）
- role 信息挂在 entity 上，包括 self entity
- 所有成员都可携带 role 属性，但仅 owner/admin 实际显示
- 缓存 role 信息 + 平台事件触发刷新（如权限变更事件）

### platformId 暴露策略（ENV-04）

- `<msg>` 标签不需要额外暴露 platformId 属性
- Phase 25 已建立短 ID 映射机制，本 phase 确保映射表补全平台原始 messageId
- delmsg 等工具通过短 ID 调用后自动还原为平台长 ID

### 降级与缺失处理

- 省略缺失字段，不显示占位符；userId 作为最低保障始终存在
- role 查询失败时（API 超时、平台不支持）静默降级为无 role，不阻塞消息处理
- 群成员列表整体获取失败时，从消息历史中提取已出现的用户作为回退
- 单聊场景只提取对方 entity，不涉及成员列表

### Claude's Discretion

- `<member>` 标签的具体自然语言格式和属性排列
- entity 表主键迁移的具体实现方式
- role 缓存的 TTL 和刷新策略细节
- 成员列表从消息历史回退的具体提取逻辑

</decisions>

<specifics>
## Specific Ideas

- Phase 25 已建立 `<msg id="N" sender="name" senderId="uid">` 格式和短 ID 映射表，本 phase 在此基础上扩展 entity 信息
- entity 表主键需要从现有结构迁移到 platform:userId 模式，这是一个数据模型变更
- self 标记让 LLM 能够在群聊中识别自己的身份，对权限感知和行为决策至关重要

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 34-environment-enrichment_
_Context gathered: 2026-02-27_
