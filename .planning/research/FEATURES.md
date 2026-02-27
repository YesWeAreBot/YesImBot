# Feature Landscape

**Domain:** Koishi AI chat plugin — multimodal input, rich message elements, skill-driven tools, environment enrichment
**Researched:** 2026-02-27
**Milestone:** v2.5 Multimodal & Rich Interaction

---

## Table Stakes

Features users expect. Missing = product feels incomplete or broken.

| Feature                             | Why Expected                                                                            | Complexity | Notes                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| 图片消息被 AI 感知                  | 用户发图时 AI 完全无视，体验断裂                                                        | Medium     | 两种模式：原生 VLM（ai-sdk ImagePart）或外挂 VLM 描述文本                               |
| 消息元素解析（at/quote/image/face） | `session.content` 是原始 XML，当前直接传给 LLM，LLM 看到 `<at id="123"/>` 而非 `@Alice` | Low-Medium | `h.parse()` + 元素类型分发，转为可读文本                                                |
| 用户消息防注入转义                  | 用户可以发送 `<tool_call>` 等 XML 伪造工具调用，污染 LLM 上下文                         | Low        | 对用户消息中的 `<` `>` 做转义，或用 CDATA 包裹                                          |
| Environment members 列表            | HorizonView 当前无成员列表，LLM 不知道群里有谁                                          | Medium     | 从 entity DB 查询当前频道成员，注入 Environment 渲染                                    |
| Bot 自身 role 信息                  | LLM 不知道自己在群里是否是管理员，无法判断能否执行 ban/kick                             | Low        | 从 `session.bot.getGuildMember()` 读取 bot 自身角色                                     |
| Skill 驱动工具加载                  | 当前所有工具全局可见，无法按场景控制工具集                                              | Medium     | Skill 的 `effects.tools` 已有 include/exclude 骨架，需要 PluginService 配合 hidden 标记 |
| send_message 支持富文本输出         | 当前只能发纯文本，无法发图片/at/表情                                                    | Medium     | 扩展 send_message 参数，支持 Koishi `h()` 元素序列化                                    |

## Differentiators

Features that set the product apart. Not expected, but valued.

| Feature                                            | Value Proposition                                               | Complexity | Notes                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| 双模式图片理解（原生 + 外挂 VLM）                  | 原生模式零延迟，外挂模式兼容不支持视觉的模型                    | Medium     | 配置项 `imageMode: "native" \| "vlm-describe"`，外挂模式调用独立 VLM 生成描述文本 |
| 消息引用链展开                                     | `<quote>` 嵌套引用时 LLM 看不到被引用内容，无法理解上下文       | Medium     | 递归解析 `session.quote`，将引用内容内联到消息文本                                |
| Interactions 插件（reaction/essence/poke/forward） | 社交互动工具让 AI 更像真实群成员                                | Medium     | 从 v3 迁移，需适配 v4 Plugin 装饰器体系 + 平台检测 activator                      |
| QManager 插件（delmsg/ban/kick）                   | 频道管理能力，管理员场景下有实用价值                            | Medium     | 从 v3 迁移，需加权限检测 activator（bot 是否有管理员权限）                        |
| 系统事件注入 Environment                           | 成员加入/离开等事件让 AI 感知群动态                             | Medium     | Horizon listener 扩展，监听 `guild-member-added` 等 Koishi 事件                   |
| username/nickname 区分                             | 当前 `senderName` 混用 nick 和 name，LLM 无法区分显示名和账号名 | Low        | Entity 存储同时保留 `username`（账号名）和 `nickname`（显示名）                   |

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature                       | Why Avoid                                                                        | What to Do Instead                                                |
| ---------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| AssetService（完整图片持久化服务） | v3-dev 的 AssetService 是独立插件，含 DB 表、HTTP 端点、压缩、GIF 处理，过度设计 | 直接从 session element 读取 src URL 或 base64，按需下载，不持久化 |
| 语音/视频多模态                    | PROJECT.md 明确排除，图片优先                                                    | 后续迭代                                                          |
| Google Lens / 反向图片搜索工具     | v3 vision-tools 依赖 Puppeteer + 外部 API，复杂度高，与核心感知无关              | 后续作为独立 Skill 工具插件                                       |
| 完整 GIF 帧拼接处理                | 需要 jimp/gifwrap 依赖，增加包体积，VLM 通常只需第一帧                           | 外挂 VLM 模式直接传第一帧或原始 URL                               |
| 跨平台 reaction 统一抽象           | 各平台 emoji reaction API 差异极大，统一抽象成本高                               | Interactions 插件内部按 platform 分支，不做统一接口               |
| 消息元素输出的完整富文本编辑器     | send_message 扩展只需支持常见元素（at/image/face），不需要完整 DSL               | 支持有限元素集，其余降级为文本                                    |

---

## Feature Details

### 1. 输入侧多模态图片理解

**两种模式：**

**原生模式（`imageMode: "native"`）：**

- 从 `session.elements` 中找到 `type === "img"` 的元素
- 读取 `element.attrs.src`（URL 或 base64 data URL）
- 构造 ai-sdk `ImagePart`：`{ type: "image", image: url | Buffer, mediaType?: string }`
- 将 `messages[0].content` 从 `string` 改为 `Array<TextPart | ImagePart>`
- 依赖：ai-sdk `UserContent = string | Array<TextPart | ImagePart | FilePart>`（HIGH confidence，已验证类型定义）

```typescript
// ai-sdk UserContent 支持多模态
type UserContent = string | Array<TextPart | ImagePart | FilePart>;

// ImagePart 结构
interface ImagePart {
  type: "image";
  image: DataContent | URL; // base64 string | Uint8Array | ArrayBuffer | Buffer | URL
  mediaType?: string;
}
```

**外挂 VLM 模式（`imageMode: "vlm-describe"`）：**

- 检测到图片元素后，调用独立 VLM（可配置不同 model）生成描述文本
- 描述文本以 `[图片描述: ...]` 格式内联到消息文本中
- 主模型收到的仍是纯文本，兼容不支持视觉的模型

**图片获取策略：**

- `src` 是 HTTP URL → 直接传 URL（原生模式）或 `ctx.http.get()` 下载（外挂模式）
- `src` 是 `data:image/...;base64,...` → 直接解析 Buffer
- `src` 是平台内部协议（如 `file://`）→ 尝试下载，失败则跳过并记录警告

**依赖：** `ctx.http`（Koishi 内置），无新外部依赖

---

### 2. 消息元素格式化（输入解析）

**当前问题：**

`session.content` 包含原始 Koishi XML，如：

```
<at id="123456"/> 你好，<face id="14"/> 看看这个 <image src="https://..."/>
```

LLM 看到的是 XML 标签而非可读文本。

**期望行为：**

```
@Alice 你好，[表情:14] 看看这个 [图片:img-001]
```

**元素类型处理规则：**

| 元素类型                   | 处理方式                                                                         |
| -------------------------- | -------------------------------------------------------------------------------- |
| `text`                     | 直接取 `attrs.content`，对 `<>&"` 做 HTML 实体反转义                             |
| `at`                       | 查 Entity DB 解析为 `@nickname`，找不到则 `@{id}`                                |
| `quote`                    | 展开为 `[引用 @sender: content_preview]`，递归处理嵌套                           |
| `img` / `image`            | 原生模式：提取为 ImagePart；外挂模式：替换为 `[图片描述: ...]`；无视觉：`[图片]` |
| `face`                     | `[表情:{id}]` 或查表映射为表情名                                                 |
| `forward`                  | `[合并转发消息]`（不展开，避免 token 爆炸）                                      |
| `audio` / `video` / `file` | `[语音]` / `[视频]` / `[文件:{filename}]`                                        |
| 其他未知                   | `[{type}]` 占位                                                                  |

**防注入转义：**

- 用户消息中的 `<` 转义为 `&lt;`，`>` 转义为 `&gt;`
- 在元素解析完成后、拼接为最终文本前执行
- 不影响 AI 生成的内容（只处理用户输入路径）

**依赖：** Koishi `h.parse()`（已在 listener.ts 中使用），无新依赖

---

### 3. send_message 富文本输出扩展

**当前限制：** `send_message` 的 `content` 参数是纯字符串，只能发文本。

**扩展方案：**

支持在 `content` 中嵌入简单标记，由 send_message handler 解析为 Koishi 元素：

```
"你好 @123456，看看这个 [image:https://example.com/img.jpg]"
```

或直接支持 Koishi XML 格式（已是 Koishi 原生格式）：

```
"你好 <at id='123456'/>，看看这个 <image src='https://example.com/img.jpg'/>"
```

**推荐方案：** 直接支持 Koishi XML，`session.send()` 原生接受 XML 字符串，无需额外解析。

**Schema 扩展：**

- `content` 描述更新：说明支持 Koishi 消息元素 XML
- 新增 `reply?: string` 参数：回复指定消息 ID（`<quote id="..."/>`）

**依赖：** Koishi `session.send()` 原生支持 XML（HIGH confidence）

---

### 4. Skill 驱动工具体系

**当前问题：**

所有工具（包括 Interactions、QManager 工具）全局可见，LLM 在任何场景都能看到 `ban`、`kick` 等工具，增加误调用风险。

**期望行为：**

- 核心只保留 `send_message`（始终可见）
- 其他工具注册时标记为 `hidden: true`
- Skill 通过 `effects.tools.include` 声明需要暴露的工具
- `getTools()` 根据当前激活 Skill 的 toolFilter 决定可见工具集

**实现要点：**

```typescript
// Skill 定义示例
{
  name: "social-interactions",
  conditions: { match: { dimension: "scene", value: "group" } },
  lifecycle: "per-turn",
  effects: {
    tools: { include: ["reaction_create", "send_poke", "essence_create"] }
  }
}
```

**PluginService 变更：**

- `getTools()` 已支持 `includeHidden` 参数
- 需要将 toolFilter 从 SkillEffect 传入 `getTools()` 调用
- `buildToolSchemaForPrompt()` 已接受 `toolFilter` 参数（loop.ts 中已传入）

**依赖：** SkillEffect.toolFilter 已存在，PluginService.getTools() 已有 hidden 支持，主要是 Interactions/QManager 插件注册时设置 `hidden: true`

---

### 5. Interactions 插件迁移

**从 v3 迁移的工具：**

| 工具名            | 功能                         | 平台限制    |
| ----------------- | ---------------------------- | ----------- |
| `reaction_create` | 对消息表态（emoji reaction） | onebot only |
| `essence_create`  | 设置精华消息                 | onebot only |
| `essence_delete`  | 取消精华消息                 | onebot only |
| `send_poke`       | 戳一戳                       | onebot only |
| `get_forward_msg` | 获取合并转发消息内容         | onebot only |

**v4 适配要点：**

- 使用 v4 `Plugin` 基类 + `@Action`/`@Tool` 装饰器（已有体系）
- 平台检测改为 `activators`：`{ check: (ctx) => ctx.session?.platform === "onebot", reason: "onebot only", onFail: "hint" }`
- `get_forward_msg` 中的图片处理：调用消息元素格式化逻辑（复用 Feature 2 的解析器）
- 所有工具注册为 `hidden: true`，由 Skill 按需暴露

**Skill 文件（随插件提供）：**

```yaml
# skills/social-interactions.yaml
name: social-interactions
conditions:
  match: { dimension: "scene", value: "group" }
lifecycle: per-turn
effects:
  tools:
    include: [reaction_create, essence_create, send_poke, get_forward_msg]
```

**依赖：** `koishi-plugin-adapter-onebot`（已在 v3 中使用），需在 package.json 声明 optional peer dep

---

### 6. QManager 插件迁移

**从 v3 迁移的工具：**

| 工具名   | 功能               | 权限要求       |
| -------- | ------------------ | -------------- |
| `delmsg` | 撤回消息           | bot 有撤回权限 |
| `ban`    | 禁言用户（0=解除） | bot 有禁言权限 |
| `kick`   | 踢出用户           | bot 有踢人权限 |

**v4 适配要点：**

- 权限检测 activator：检查 bot 在当前频道是否有管理员角色
- `ban` 的时长限制：描述中明确"不应超过 10 分钟"，防止 LLM 滥用
- 所有工具注册为 `hidden: true`，由 Skill 按需暴露

**Skill 文件（随插件提供）：**

```yaml
# skills/channel-management.yaml
name: channel-management
conditions:
  match: { dimension: "scene", value: "group" }
lifecycle: per-turn
effects:
  tools:
    include: [delmsg, ban, kick]
  prompt: "你在这个频道有管理员权限。当用户违规时，你可以使用管理工具，但应谨慎使用。"
```

**依赖：** Koishi `bot.muteGuildMember()`、`bot.kickGuildMember()`、`bot.deleteMessage()`（标准 Koishi Bot API）

---

### 7. Environment 增强

**当前 Environment 结构：**

```typescript
interface Environment {
  type: string;
  id: string;
  name: string;
  platform: string;
  channelId: string;
  description?: string;
}
// Entity 只有 id/type/name/attributes，无 userId/username/nickname 区分
```

**增强目标：**

**7a. Members 列表（userId + username/nickname 区分）：**

```typescript
interface EnvironmentMember {
  userId: string; // 平台账号 ID（稳定标识）
  username?: string; // 账号名（不常变）
  nickname?: string; // 显示名/群昵称（可变）
  roles?: string[]; // 群角色（admin/owner/member）
  lastActive?: Date;
}
```

- 从 Entity DB 查询 `type === "member"` 且 `parentId` 匹配当前频道的记录
- 注入 HorizonView，在 `formatHorizonText` 中渲染为成员列表

**7b. Bot 自身 role：**

- `SelfInfo` 扩展 `roles?: string[]`
- 从 `session.bot.getGuildMember(guildId, selfId)` 读取
- 注入 HorizonView，让 LLM 知道自己是否有管理权限

**7c. 消息引用链（replyTo 展开）：**

- `MessageObservation.replyTo` 已存在但只存 messageId
- 在消息格式化时，如果 `session.quote` 存在，将引用内容内联到消息文本
- 不需要修改 DB schema，只在渲染层处理

**7d. 系统事件（可选，低优先级）：**

- 监听 `guild-member-added`、`guild-member-removed` 等 Koishi 事件
- 写入 Timeline 作为系统事件类型
- 在 HorizonView 中渲染为 `[系统: Alice 加入了群聊]`

**依赖：** Entity DB 已存在（listener.ts 已写入 member 记录），需扩展查询逻辑

---

## Feature Dependencies

```
消息元素格式化（输入解析）
  → 图片多模态（图片元素提取依赖元素解析器）
  → get_forward_msg 图片处理（复用解析器）
  → 防注入转义（在解析器输出后执行）

Skill 驱动工具体系
  → Interactions 插件（工具注册为 hidden，Skill 暴露）
  → QManager 插件（工具注册为 hidden，Skill 暴露）

Environment 增强（members）
  → 独立（Entity DB 已有数据，只需查询和渲染）

send_message 富文本扩展
  → 独立（不依赖其他新功能）
```

## MVP Recommendation

优先顺序（按用户可感知价值和实现风险排序）：

1. **消息元素格式化（输入解析 + 防注入）** — 基础设施，其他功能依赖，低风险
2. **图片多模态（原生模式）** — 高价值，ai-sdk 原生支持，中等复杂度
3. **Skill 驱动工具体系** — 骨架已有，主要是 hidden 标记 + toolFilter 传递
4. **Interactions 插件** — v3 代码可直接迁移，适配工作量低
5. **QManager 插件** — 同上，加权限检测
6. **Environment members 增强** — DB 数据已有，渲染层扩展
7. **send_message 富文本扩展** — 低优先级，纯文本已满足大多数场景

推迟：

- **外挂 VLM 模式** — 原生模式先验证，外挂模式作为配置项后续加
- **系统事件注入** — 价值有限，增加 listener 复杂度
- **消息引用链递归展开** — 基础展开（session.quote 内联）先做，递归展开后续

---

## Sources

- `/home/workspace/Athena/core/src/services/horizon/listener.ts` — 当前消息监听和元素处理（HIGH confidence）
- `/home/workspace/Athena/core/src/services/horizon/types.ts` — Environment/Entity/HorizonView 结构（HIGH confidence）
- `/home/workspace/Athena/core/src/services/plugin/types.ts` — FunctionDefinition.hidden 字段（HIGH confidence）
- `/home/workspace/Athena/core/src/services/plugin/service.ts` — getTools() includeHidden 参数（HIGH confidence）
- `/home/workspace/Athena/core/src/services/skill/types.ts` — SkillEffects.tools ToolFilter（HIGH confidence）
- `/home/workspace/Athena/core/src/services/agent/loop.ts` — buildToolSchemaForPrompt 调用，toolFilter 传递（HIGH confidence）
- `/home/workspace/Athena/references/YesImBot-v3/packages/core/src/services/extension/builtin/interactions.ts` — v3 Interactions 实现（HIGH confidence）
- `/home/workspace/Athena/references/YesImBot-v3/packages/core/src/services/extension/builtin/qmanager.ts` — v3 QManager 实现（HIGH confidence）
- `/home/workspace/Athena/references/YesImBot-dev/packages/core/src/services/assets/service.ts` — v3-dev AssetService（参考，不直接迁移）（HIGH confidence）
- `node_modules/@ai-sdk/provider-utils/dist/index.d.ts` — ImagePart / UserContent 类型定义（HIGH confidence）
- `.planning/PROJECT.md` — v2.5 milestone 目标和 Out of Scope 约束（HIGH confidence）
