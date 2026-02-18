# ChatMode 聊天模式系统 - 完整设计

**来源:** dev 版实现 + 设计文档 `12-Horizon模块重构.md`
**状态:** 参考文档（v4 中 Phase 4/5 实现时使用）

## 核心理念

ChatMode 是一种**策略模式**——根据不同触发场景动态选择不同的提示词模板、上下文策略和工具列表。解决固定提示词带来的风格单一问题。

**核心价值:**

1. 不同触发原因 → 不同聊天模式 → 不同提示词 → 不同期望行为
2. 为多 agent 协同提供基础（不同 mode 可演化为独立 agent）
3. 用户可通过插件自行添加 chat-mode
4. 每个 mode 内部可包含独立的意愿判断逻辑

## 架构

```
ChatModeManager (模式选择器)
│   按优先级排序，返回第一个匹配的 mode
│
├── GroupChatMode        (priority: 50)  群聊默认
├── PrivateChatMode      (priority: 50)  私聊模式
├── EmotionalSupportMode (priority: 20)  情绪支持
├── TechnicalExpertMode  (priority: 20)  技术专家
├── DefaultChatMode      (priority: 100) 兜底模式
└── ... (用户自定义)
```

## 接口定义

```typescript
interface ChatMode {
  /** 模式名称 */
  name: string;

  /** 优先级（越小越先匹配，默认 50） */
  priority?: number;

  /** 支持的 Percept 类型（快速过滤） */
  supportedTypes?: PerceptType[];

  /** 判断当前输入是否匹配此模式 */
  match(percept: Percept): Promise<boolean> | boolean;

  /** 构建上下文，返回视图 + 模板 */
  buildContext(percept: Percept): Promise<ModeResult>;
}

interface ModeResult {
  /** 模板渲染的数据视图 */
  view: HorizonView;

  /** 使用的模板 */
  templates: {
    system: string; // system prompt 模板名
    user: string; // user prompt 模板名
  };

  /** 要激活的模板片段 */
  partials?: string[];
}
```

## 基类

```typescript
abstract class BaseChatMode implements ChatMode {
  abstract name: string;
  abstract priority: number;

  constructor(protected ctx: Context) {}

  abstract match(percept: Percept): Promise<boolean> | boolean;
  abstract buildContext(percept: Percept): Promise<ModeResult>;
}
```

## ChatModeManager

```typescript
class ChatModeManager {
  private modes: Map<string, ChatMode> = new Map();

  register(mode: ChatMode): void;
  resolve(percept: Percept): Promise<ModeResult>;
}
```

**解析流程:**

1. 按 priority 升序排列所有已注册 mode
2. 过滤 `supportedTypes`（如果指定）
3. 依次调用 `match()`，返回第一个匹配的 mode 的 `buildContext()` 结果
4. 无匹配则抛出错误

## 预设模式

### DefaultChatMode（兜底，priority: 100）

- 匹配: `PerceptType.UserMessage`
- 查询最近 30 条消息 + 10 条工作记忆
- 构建完整 HorizonView（bot 信息、频道、参与者、事件、触发）
- 模板: `agent.system.chat` + `agent.user.events`
- Partials: identity, environment, working_memory, memories, tools, output

### GroupChatMode（群聊）

- 大量历史，多参与者
- 侧重社交互动、话题连贯性
- 优先加载完整上下文

### PrivateChatMode（私聊）

- 较少历史，一对一
- 侧重个人化、隐私保护
- 增强个人记忆引用

### EmotionalSupportMode（情绪支持）

- 调用情感相关记忆
- 减少技术细节
- 温和、支持的语气

### TechnicalExpertMode（技术专家）

- 调用知识库
- 技术相关提示词
- 精准的回复格式

## 模板系统

### Partials（模板片段）

| 片段                    | 用途         |
| ----------------------- | ------------ |
| identity.mustache       | 身份与风格   |
| environment.mustache    | 当前环境     |
| working_memory.mustache | 工作记忆     |
| memories.mustache       | 检索到的记忆 |
| tools.mustache          | 可用工具     |
| output.mustache         | 输出格式     |

### 主模板

- `agent.system.chat.mustache` — system prompt
- `agent.user.events.mustache` — user prompt（含消息历史）

不同 ChatMode 可以注册自己的模板，或复用默认模板配合不同 partials。

## 提示词设计原则

### 去 AI 化

- 不用"你是 AI"之类的直白声明
- 用"完全沉浸在你的角色中"
- 使用第一人称视角

### 防复读机制

```mustache
<your_recent_patterns>
  你最近表达过的主题: 关心(2次)、询问(3次)
  建议: 尝试不同的表达方式
</your_recent_patterns>
```

### 自我监控

```
在回复前，先思考:
- 我是否在重复之前说过的话?
- 我应该调整策略吗?
```

## v4 Phase 分工

| 组件               | Phase   | 说明                 |
| ------------------ | ------- | -------------------- |
| Percept 触发数据   | Phase 3 | 提供触发类型和元数据 |
| ChatMode 接口/基类 | Phase 4 | PromptService 中定义 |
| ChatModeManager    | Phase 4 | 模式注册和解析       |
| DefaultChatMode    | Phase 4 | 默认实现             |
| AgentCore 集成     | Phase 5 | 编排完整流程         |
| Mode 内意愿判断    | Phase 6 | 各 mode 的回复决策   |

## 扩展示例

用户通过 Koishi 插件添加自定义 ChatMode:

```typescript
// plugin-custom-mode/src/index.ts
import { Context } from 'koishi'
import { BaseChatMode } from 'koishi-plugin-athena'

class MyChatMode extends BaseChatMode {
  name = 'my-custom-mode'
  priority = 30

  match(percept) {
    // 自定义匹配逻辑
    return percept.payload.content.includes('帮我写代码')
  }

  async buildContext(percept) {
    // 自定义上下文构建
    return { view: { ... }, templates: { ... } }
  }
}

export function apply(ctx: Context) {
  ctx.horizon.modeManager.register(new MyChatMode(ctx))
}
```

---

_基于 dev 版实现和设计文档 `12-Horizon模块重构.md` 整理_
_整理日期: 2026-02-18_
