# Requirements: Athena v2.5

**Defined:** 2026-02-27
**Core Value:** 智能体能够像真人一样自然地参与群聊讨论，拥有合理的回复决策机制和可扩展的工具调用能力。

## v2.5 Requirements

### 消息元素格式化

- [x] **ELEM-01**: 用户消息中的 Koishi 元素（at/quote/image/face/forward/audio/video/file）被解析为 AI 可读文本
- [x] **ELEM-02**: 用户消息内容在注入 prompt 前经过 XML 转义，防止 prompt injection
- [x] **ELEM-03**: `session.quote` 引用内容内联展示（发送者 + 内容预览），LLM 可理解回复上下文
- [x] **ELEM-04**: `formatObservation()` 中用户内容经过转义处理，消除现有注入漏洞

### 多模态图片

- [ ] **IMG-01**: 消息中的图片元素被提取并以 ai-sdk `ImagePart` 格式传入 LLM（原生多模态模式）
- [ ] **IMG-02**: 图片在消息接收时即时下载转 base64，避免平台 CDN URL 过期
- [ ] **IMG-03**: `LoopMessage` 类型支持 `string | UserContent`，trimmer 正确处理多模态内容
- [ ] **IMG-04**: 用户可通过配置项 `imageMode` 选择图片处理模式（native / off）

### Skill 驱动工具

- [x] **TOOL-01**: 除 `send_message` 外的内置工具默认标记为 `hidden: true`，仅通过 Skill 暴露
- [x] **TOOL-02**: 搜索工具以 Skill 工具形式提供，通过 `ctx.http` 调用可配置搜索 API endpoint
- [x] **TOOL-03**: Skill 的 `effects.tools.include` 能正确取消 hidden 标记，使工具对 LLM 可见

### Interactions 插件

- [x] **INTR-01**: `reaction_create` 工具可对消息添加 emoji 表态（OneBot 平台）
- [x] **INTR-02**: `essence_create` / `essence_delete` 工具可设置/取消精华消息（OneBot 平台）
- [x] **INTR-03**: `send_poke` 工具可发送戳一戳（OneBot 平台）
- [x] **INTR-04**: `get_forward_msg` 工具可获取合并转发消息内容（OneBot 平台）
- [x] **INTR-05**: 插件自带 Skill 定义，在群聊场景自动激活社交互动工具

### QManager 插件

- [ ] **QMGR-01**: `delmsg` 工具可撤回指定消息
- [ ] **QMGR-02**: `ban` 工具可禁言用户（支持时长参数，0=解除）
- [ ] **QMGR-03**: `kick` 工具可踢出用户
- [ ] **QMGR-04**: 所有工具需 bot 具有管理员角色才激活（`requireBotRole` activator）
- [ ] **QMGR-05**: 插件自带 Skill 定义，在 bot 有管理权限时自动激活管理工具

### Environment 增强

- [x] **ENV-01**: Entity 记录包含 `userId`（平台账号 ID）作为稳定标识
- [x] **ENV-02**: Entity 区分 `username`（账号名）和 `nickname`（群昵称/显示名）
- [x] **ENV-03**: Bot 自身 role 信息可查询并注入 HorizonView，LLM 知道自己是否有管理权限
- [x] **ENV-04**: `<msg>` 标签中暴露 `platformId`，使 delmsg 等工具可引用真实消息 ID

### 富文本输出

- [ ] **OUT-01**: `send_message` 支持 `reply_to` 参数，可引用回复指定消息
- [ ] **OUT-02**: `send_message` 的 `content` 支持 Koishi 消息元素 XML（at/image/face 等）
- [ ] **OUT-03**: AI 生成的富文本内容通过 `session.send()` 正确渲染为平台消息

## v2.6 Requirements

Deferred to future release. Tracked but not in current roadmap.

### 多模态扩展

- **IMG-V2-01**: 外挂 VLM 描述模式（`imageMode: "vlm-describe"`），调用独立 VLM 生成图片描述文本
- **IMG-V2-02**: GIF 首帧提取，兼容不支持 GIF 的 LLM provider

### Environment 扩展

- **ENV-V2-01**: 系统事件注入（guild-member-added/removed 等）写入 Timeline
- **ENV-V2-02**: 消息引用链递归展开（多层嵌套 quote）

### 工具扩展

- **TOOL-V2-01**: 提醒工具（需统一触发器机制）
- **TOOL-V2-02**: 模型组与负载均衡（REQ-04 继续推迟）

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature                        | Reason                                    |
| ------------------------------ | ----------------------------------------- |
| AssetService（完整图片持久化） | 过度设计，直接从 session element 读取即可 |
| 语音/视频多模态                | 图片优先，PROJECT.md 明确排除             |
| Google Lens / 反向图片搜索     | 依赖 Puppeteer，与核心感知无关            |
| 跨平台 reaction 统一抽象       | 各平台 API 差异大，按 platform 分支即可   |
| 完整富文本编辑器 DSL           | send_message 支持有限元素集，其余降级文本 |
| GIF 帧拼接处理                 | 增加依赖，VLM 通常只需第一帧，推迟到 v2.6 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase    | Status   |
| ----------- | -------- | -------- |
| ELEM-01     | Phase 33 | Complete |
| ELEM-02     | Phase 33 | Complete |
| ELEM-03     | Phase 33 | Complete |
| ELEM-04     | Phase 33 | Complete |
| ENV-01      | Phase 34 | Complete |
| ENV-02      | Phase 34 | Complete |
| ENV-03      | Phase 34 | Complete |
| ENV-04      | Phase 34 | Complete |
| TOOL-01     | Phase 35 | Complete |
| TOOL-02     | Phase 35 | Complete |
| TOOL-03     | Phase 35 | Complete |
| INTR-01     | Phase 36 | Complete |
| INTR-02     | Phase 36 | Complete |
| INTR-03     | Phase 36 | Complete |
| INTR-04     | Phase 36 | Complete |
| INTR-05     | Phase 36 | Complete |
| QMGR-01     | Phase 37 | Pending  |
| QMGR-02     | Phase 37 | Pending  |
| QMGR-03     | Phase 37 | Pending  |
| QMGR-04     | Phase 37 | Pending  |
| QMGR-05     | Phase 37 | Pending  |
| IMG-01      | Phase 38 | Pending  |
| IMG-02      | Phase 38 | Pending  |
| IMG-03      | Phase 38 | Pending  |
| IMG-04      | Phase 38 | Pending  |
| OUT-01      | Phase 39 | Pending  |
| OUT-02      | Phase 39 | Pending  |
| OUT-03      | Phase 39 | Pending  |

**Coverage:**

- v2.5 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---

_Requirements defined: 2026-02-27_
_Last updated: 2026-02-27 after roadmap creation_
