# Horizon 上下文系统 - 完整设计

**来源:** dev 版实现 + v4 Phase 3 讨论决策
**状态:** 参考文档（v4 实现时按需裁剪）

## 核心理念

Horizon 是智能体的"世界视图"——描述智能体所处的世界：

- **在哪里** (Environment): 智能体活动的空间
- **有谁** (Entity): 环境中的参与者
- **发生了什么** (Event/Timeline): 环境中发生的事情

这三层不是对 Koishi session 的重复抽象，而是 session 的**富化缓存**——持久化存储 Koishi 不直接保存的信息（群名、公告、用户昵称、头衔等），避免每次构建提示词时重新查询 API。

## 架构总览

```
HorizonService (主服务)
├── EventManager        # Timeline 读写与查询
├── EventListener       # 监听 Koishi 事件，写入 Timeline
├── ChatModeManager     # 聊天模式选择器（→ 见 CHATMODE-DESIGN.md）
│   └── DefaultChatMode # 默认群聊模式
├── Entity 管理         # 用户/成员实体的 CRUD
└── Environment 管理    # 频道/群组环境的 CRUD

数据库表:
├── Entity 表    # 实体持久化
└── Timeline 表  # 事件时间线持久化
```

## 数据模型

### Environment（环境）

Environment = channel 的展开视图，1:1 映射。

```typescript
interface Environment {
  type: string; // 'group' | 'private' | ...
  id: string; // 环境唯一标识
  name: string; // 群名/频道名
  description?: string;
  metadata: Record<string, any>; // 公告、背景信息等
}
```

**v4 决策:**

- 一个群聊/私聊 = 一个 Environment，保持频道隔离
- 跨频道连续性由 Entity 承载，不由 Environment 混合
- 元数据定期批量刷新，减少 API 调用
- 不需要 Platform 层（Koishi 已处理平台差异，metadata 中记 platform 字段即可）

### Entity（实体）

Entity = 用户的展开视图，承载跨频道连续性。

```typescript
// 数据库记录（扁平化存储）
interface EntityRecord {
  id: string; // 复合主键: "user:qq:123456" 或 "member:qq:123456@guild:789"
  type: "user" | "member" | string;
  name: string;
  avatar?: string;
  parentId?: string; // Member → Guild: "guild:789"
  refId?: string; // Member → User: "user:qq:123456"
  attributes: Record<string, any>; // roles, joinedAt, level, relationship 等
  createdAt: Date;
  updatedAt: Date;
}

// 运行时实体
interface Entity {
  id: string;
  type: string;
  name: string;
  description?: string;
  attributes?: Record<string, any>;
}

// 用户实体 (type: "user")
interface UserEntity extends Entity {
  attributes: { platform: string; avatar?: string };
}

// 成员实体 (type: "member")
interface MemberEntity extends Entity {
  user?: UserEntity;
  attributes: { roles: string[]; joinedAt?: Date; lastActive?: Date };
}
```

**v4 决策:**

- 默认按平台隔离（platform + userId），支持手动关联不同平台账号
- 同一用户在不同 Environment 中是同一个 Entity（跨频道连续性）
- 元数据定期批量刷新

### Timeline（时间线）

Timeline 是事件的持久化存储，使用 Koishi 数据库服务。

```typescript
// 事件类型
enum TimelineEventType {
  Message = "message",
  Command = "command",
  MemberJoin = "notice.member.join", // v4 暂不实现
  MemberLeave = "notice.member.leave", // v4 暂不实现
  StateUpdate = "notice.state.update", // v4 暂不实现
  Reaction = "notice.reaction", // v4 暂不实现
  AgentThought = "agent.thought",
  AgentTool = "agent.tool",
  AgentAction = "agent.action",
  ToolResult = "tool.result",
}

// 优先级（上下文截断时的保留权重）
enum TimelinePriority {
  Noise = 0, // 可丢弃
  Normal = 1, // 标准历史
  Important = 2, // 关键事实
  Core = 3, // 永久记忆/系统指令
}

// 生命周期阶段
enum TimelineStage {
  New = "new", // 新事件，未被 agent 处理
  Active = "active", // 已被 agent 看到
  Archived = "archived",
  Deleted = "deleted",
}

// 事件基类
interface BaseTimelineEntry<Type, Data> {
  id: string;
  timestamp: Date;
  scope: Scope;
  type: Type;
  priority: TimelinePriority;
  stage: TimelineStage;
  data: Data; // JSON 嵌入事件数据
}
```

**v4 决策:**

- Event 类型只覆盖：消息（message）和 Bot 自身消息
- Agent 响应过程（思考、工具调用、结果、最终回复）压缩为**单个摘要 Event** 存入 Timeline
- 检索方式：**时间窗口 + 数量上限**，兼顾对话节奏和 token 控制
- 成员变更、群信息变更事件留给未来版本

### Scope（作用域）

```typescript
interface Scope {
  platform?: string;
  channelId?: string;
  guildId?: string;
  isDirect?: boolean;
  userId?: string;
}
```

### Percept（感知）

Percept 描述"为什么 agent 需要响应"，只提供数据，不做判断。

```typescript
enum PerceptType {
  UserMessage = "user.message",
  SystemSignal = "system.signal",
  TimerTick = "system.timer.tick",
}

interface BasePercept<T extends PerceptType> {
  id: string;
  type: T;
  scope: Scope;
  priority: number;
  timestamp: Date;
}

interface UserMessagePercept extends BasePercept<PerceptType.UserMessage> {
  payload: {
    messageId: string;
    content: string;
    sender: { id: string; name: string; role?: string };
    channel: { id: string; platform: string; guildId?: string };
  };
  runtime?: { session: Session };
}
```

**v4 决策:**

- 四种触发类型：@提及/回复、关键词匹配、随机触发、私聊消息
- Percept 携带：触发类型、触发消息引用、Environment/Entity 引用
- 只提供数据，不做"是否应该回复"的判断（留给 Phase 6 意愿系统）
- 群聊消息**聚合后触发**（防止连续消息导致 bot 刷屏）

## HorizonView（世界视图）

HorizonView 是传递给模板渲染的完整数据结构。

```typescript
interface HorizonView {
  mode?: string; // 当前聊天模式名称
  percept: Percept; // 触发感知
  self: SelfInfo; // 智能体自身信息
  environment?: Environment; // 环境信息
  entities?: Entity[]; // 实体列表
  history?: Observation[]; // 事件历史
  workingHistory?: AgentRecord[]; // 工作记忆（当前回合）
  memories?: Memory[]; // 语义记忆（未来）
}
```

## Prompt 构建方式（混合方案）

v3/dev 的教训：只用 system + user 两条消息导致 agentic 能力降低且无法利用提示缓存。

**v4 混合方案:**

```
[system]  人设 + 规则 + 核心记忆
[user]    Horizon 视图（聚合的群聊上下文 + 触发信息）
[assistant] agent 思考 + 决定调用工具    ← 标准多轮
[tool]    工具返回结果                    ← 标准多轮
[assistant] agent 最终回复               ← 标准多轮
```

**关键规则:**

- 一次触发 = 一次完整 think-act 循环，期间不注入新消息
- 必要时（响应过慢、积累太多消息、用户明确 @）可插入 [system] 更新
- 循环结束后，agent 响应压缩为摘要 Event 存入 Timeline
- 第二轮触发时 Horizon 视图更新，包含上一轮 agent 行为摘要，保持连贯性
- v4 先用聊天记录式逐条列出（带时间戳和发送者），后续迭代加摘要压缩

## EventManager（事件管理器）

```typescript
class EventManager {
  // 写入
  record(entry: TimelineEntry): Promise<TimelineEntry>;
  recordMessage(message: Omit<MessageRecord, "type" | "priority">): Promise<MessageRecord>;

  // 查询
  query(options: EventQueryOptions): Promise<TimelineEntry[]>;

  // 视图转换
  toObservations(entries: TimelineEntry[]): Observation[];

  // 生命周期
  markAsActive(scope: Scope, before?: Date): Promise<void>;
  clearWorkingMemory(scope: Scope): Promise<void>;
}

interface EventQueryOptions {
  scope: Query.Expr<Scope>;
  types?: TimelineEventType[];
  limit?: number;
  since?: Date;
  until?: Date;
  orderBy?: "asc" | "desc";
}
```

## HorizonService（主服务）

```typescript
class HorizonService extends Service<Config> {
  static readonly inject = ["database"];

  readonly events: EventManager;
  private modeManager: ChatModeManager;

  // 核心方法
  build(percept: Percept): Promise<ModeResult>;

  // 数据访问
  getSelfInfo(scope: Scope): Promise<SelfInfo>;
  getEnvironment(scope: Scope): Promise<Environment | null>;
  getEntities(options: { scope: Scope }): Promise<Entity[]>;
  getEntity(options: { scope: Scope; entityId: string }): Promise<Entity | null>;

  // 频道过滤
  isChannelAllowed(session: Session): boolean;
}
```

## 数据库表结构

### Entity 表

| 字段       | 类型        | 说明          |
| ---------- | ----------- | ------------- |
| id         | string(32)  | 复合主键      |
| type       | string(32)  | user / member |
| name       | string(255) | 显示名        |
| parentId   | string(255) | 关联 guild    |
| refId      | string(255) | 关联 user     |
| attributes | json        | 扩展属性      |

### Timeline 表

| 字段      | 类型       | 说明         |
| --------- | ---------- | ------------ |
| id        | string(32) | 主键         |
| scope     | object     | 作用域       |
| type      | string(32) | 事件类型     |
| priority  | unsigned   | 保留权重     |
| stage     | string(16) | 生命周期阶段 |
| timestamp | timestamp  | 时间戳       |
| data      | json       | 事件数据     |

---

_基于 dev 版实现和 v4 Phase 3 讨论整理_
_整理日期: 2026-02-18_
