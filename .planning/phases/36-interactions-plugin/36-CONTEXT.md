# Phase 36: Interactions Plugin - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Bot 作为自然的群成员执行社交互动（表态、精华、戳一戳、读取合并转发），通过 Skill 机制按场景自动激活工具。依赖 Phase 35 的 Skill-Driven Tool Loading 基础设施。

</domain>

<decisions>
## Implementation Decisions

### 表态 (Reaction)

- 仅支持平台原生 face ID（如 `[CQ:face,id=178]`），不支持 Unicode emoji
- LLM 调用 `reaction_create` 时直接传 face ID 数字，不做语义映射
- 每条消息最多表态一次，防止刷屏
- 可对任何消息表态，包括 bot 自己发出的消息
- 仅能对当前上下文中出现过的消息操作（通过 `<msg>` 标签中的 platformId 引用）

### 精华消息 (Essence)

- 工具描述中给出使用场景引导，LLM 自主判断是否设精华，不加硬性限制
- `essence_delete` 不限制范围，可取消任何人设的精华
- 仅能对当前上下文中出现过的消息操作（统一限制）

### 戳一戳 (Poke)

- LLM 自主判断何时使用戳一戳，工具描述引导使用场景
- 同一用户有冷却限制，防止短时间内反复戳同一个人

### 转发消息读取 (Forward)

- `get_forward_msg` 返回纯文本摘要，复用现有消息元素解析逻辑
- 设条数上限，超出截断并提示还有更多内容

### 消息操作统一限制

- 所有针对消息的工具（reaction、essence）统一限制为仅能操作当前上下文中出现过的消息

### Skill 分组与激活

- **Skill A（社交互动）**：包含 `reaction_create` + `send_poke`，群聊和私聊均激活
  - `reaction_create` 工具自身限制仅群聊可用（工具层面判断）
  - `send_poke` 群聊私聊都可用
- **Skill B（精华管理）**：包含 `essence_create` + `essence_delete`，群聊 + bot 需管理员权限才激活
- **get_forward_msg**：不走 Skill 机制，仅在上下文中包含转发消息时可用（上下文触发）

### Claude's Discretion

- 冷却限制的具体时长
- 转发消息条数上限的具体数值
- 工具描述的具体措辞
- face ID 参数的校验策略

</decisions>

<specifics>
## Specific Ideas

- 所有消息操作工具统一通过 `<msg>` 标签中的 platformId 引用目标消息，形成一致的安全边界
- get_forward_msg 的上下文触发机制是新模式——不是 Skill activator，而是根据上下文内容动态决定工具可见性
- Skill A 采用"Skill 宽松，工具自限"模式：Skill 激活范围宽（群聊+私聊），具体工具各自判断适用场景

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 36-interactions-plugin_
_Context gathered: 2026-02-27_
