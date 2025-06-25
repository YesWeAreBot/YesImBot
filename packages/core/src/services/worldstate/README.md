## **WorldState 服务：开发者与集成指南**

### **1. 概述 (Overview)**

**WorldState 服务**是 Agent 的核心上下文管理系统。它的主要职责是：

*   **被动监听** Koishi 事件总线，捕捉所有相关的世界变化（如消息、成员变动等）。
*   将这些变化**结构化地、无损地持久化**到数据库中。
*   提供一个统一的 API (`getWorldState`)，供 Agent 的核心逻辑调用，以获取一个完整的、包含深度上下文的**世界快照 (WorldState)**。

本服务遵循事件驱动、状态持久化和按需整合的设计哲学，旨在为上层智能体提供一个稳定、可靠且信息丰富的环境感知基础。

### **2. 启用与配置 (Enabling & Configuration)**

要使用 WorldState 服务，您需要在 Koishi 的入口文件（如 `src/index.ts`）中作为插件来加载它。

#### **2.1 基础用法**

```typescript
// src/index.ts
import { Context } from 'koishi'
import { WorldStatePlugin, WorldStateConfig } from './services/worldstate' // 假设路径正确

export const apply = (ctx: Context) => {
  // ... 其他插件

  // 加载 WorldState 服务并传入配置
  const worldStateConfig: WorldStateConfig = {
    DataRetentionDays: 30,
    ActiveChannelHours: 1,
    MaxTurnsPerChannel: 15,
    MemberCacheSize: 1000,
    MemberCacheTTL: 5 * 60 * 1000, // 5 分钟
  }
  ctx.plugin(WorldStatePlugin, worldStateConfig)

  // ...
}
```

#### **2.2 配置文件 (`koishi.yml`)**

为了更好的灵活性，推荐通过 Koishi 的配置文件来管理配置。

```yaml
# koishi.yml
plugins:
  # ... 其他插件
  world-state: # 'world-state' 是插件的 `name`
    dataRetentionDays: 30
    activeChannelHours: 1
    maxTurnsPerChannel: 15
    memberCacheSize: 1000
    memberCacheTTL: 300000
```

`config.ts` 文件应包含所有这些配置项的定义：

`packages/core/src/services/worldstate/config.ts`
```typescript
import { Schema } from 'koishi';

export interface WorldStateConfig {
    DataRetentionDays: number;
    ActiveChannelHours: number;
    MaxTurnsPerChannel: number;
    MemberCacheSize: number;
    MemberCacheTTL: number; // in milliseconds
}

export const WorldStateConfigSchema: Schema<WorldStateConfig> = Schema.object({
    DataRetentionDays: Schema.number().min(1).default(30).description('世界状态历史数据的保留天数。'),
    ActiveChannelHours: Schema.number().min(0.1).max(168).default(1).description('频道被视为“活跃”状态的小时数。'),
    MaxTurnsPerChannel: Schema.number().min(1).max(100).default(15).description('在世界状态中为每个频道显示的最大回合数。'),
    MemberCacheSize: Schema.number().min(100).max(10000).default(1000).description('成员信息缓存的最大条目数。'),
    MemberCacheTTL: Schema.number().min(60000).default(300000).description('成员信息缓存的有效期（毫秒）。'),
});
```

### **3. 核心用法：与 Agent 中间件集成**

`WorldStateService` 最核心的用途是在 Agent 的主逻辑循环中提供上下文。

#### **3.1 在中间件中获取世界状态**

```typescript
import { Context } from 'koishi'

export const apply = (ctx: Context) => {
  // ...

  // Agent 的核心中间件
  ctx.middleware(async (session, next) => {
    // 假设有一些逻辑判断是否需要 Agent 响应
    if (!shouldAgentRespond(session)) {
      return next();
    }

    // 1. 获取 WorldState 服务实例
    const worldStateService = ctx['yesimbot.worldState'];
    if (!worldStateService) {
        throw new Error('WorldStateService is not available!');
    }

    try {
        // 2. 获取允许感知的频道列表（这部分逻辑由上层管理）
        const allowedChannels = getAgentAllowedChannels(session.user.id);

        // 3. 调用核心 API 获取世界快照
        const worldState = await worldStateService.getWorldState(allowedChannels);

        // 4. 将 worldState 传递给提示词构建器 (PromptBuilder)
        const prompt = buildPromptFromWorldState(worldState);

        // 5. 调用 LLM 并获取 Agent 响应
        const agentResponseJson = await callLlmApi(prompt);
        const agentResponse = JSON.parse(agentResponseJson);

        // 6. (可选) 将 Agent 的响应（思考、行动）持久化
        // 注意：需要确定当前回合ID
        const currentTurn = await worldStateService.turns.getOrCreateCurrentTurn(session.platform, session.channelId);
        await worldStateService.storeAgentResponse(currentTurn.id, agentResponse);

        // 7. 执行 Agent 的行动
        await executeAgentActions(session, agentResponse.actions);

    } catch (error) {
        ctx.logger('agent-core').error('Error in agent middleware:', error);
        session.send('抱歉，我的大脑好像出了一点问题...');
    }
  });

  // ...
}
```

### **4. 扩展自定义事件**

本服务的事件系统被设计为高度可扩展的。您可以轻松地定义和记录您自己的业务事件。

**场景示例：** 假设我们有一个“签到”插件，我们希望在用户签到时，记录一个 `check-in` 事件到 `WorldState` 中，以便 Agent 能够感知到用户的签到行为。

#### **步骤 1: 在 `interfaces.ts` 中定义新事件类型**

```typescript
// packages/core/src/services/worldstate/interfaces.ts

// ...
export type CheckInEvent = BaseEvent<'check-in', {
    actor: Member;       // 签到者
    pointsAwarded: number; // 获得的积分
    consecutiveDays: number; // 连续签到天数
}>;

// 将新事件添加到总的 Event 联合类型中
export type Event = MessageEvent | MemberJoinedEvent | MemberLeftEvent | CheckInEvent | GenericEvent;
```

#### **步骤 2: 在“签到”插件中触发事件的持久化**

在您的签到插件逻辑中，当用户成功签到后，获取 `WorldStateService` 实例并调用数据库来创建事件记录。

```typescript
// In your check-in plugin
import { Context } from 'koishi'
import { TableName } from 'path/to/your/worldstate/model'

export const apply = (ctx: Context) => {
  ctx.command('checkin', '每日签到')
    .action(async ({ session }) => {
      if (!session) return;

      // ... 您的签到逻辑 ...
      const points = 10;
      const days = 3;
      // ...

      // --- 与 WorldState 集成 ---
      const worldStateService = ctx['yesimbot.worldState'];
      if (worldStateService) {
        try {
          // 1. 获取当前回合
          const turn = await worldStateService.turns.getOrCreateCurrentTurn(session.platform, session.channelId);

          // 2. 构造自定义事件的负载
          const payload = {
            actorId: session.userId,
            pointsAwarded: points,
            consecutiveDays: days,
          };

          // 3. 创建事件记录
          await ctx.database.create(TableName.Events, {
            id: `evt_checkin_${Date.now()}_${session.userId}`,
            turnId: turn.id,
            type: 'check-in', // 使用您定义的类型字符串
            timestamp: new Date(),
            payload,
          });

          session.send(`签到成功！获得 ${points} 积分，已连续签到 ${days} 天。`);

        } catch (error) {
          ctx.logger('checkin-plugin').warn('Failed to record check-in event to WorldState:', error);
        }
      } else {
        session.send(`签到成功！`); // 即使 WorldState 不可用，核心功能也不应中断
      }
    });
}
```

#### **步骤 3: 在 `TurnRepository` 中“水合”新事件**

为了让 `getWorldState` 返回的上下文中包含完整的 `CheckInEvent` 对象（而不仅仅是ID），您需要让 `TurnRepository` 知道如何“水合”它。

`packages/core/src/services/worldstate/repositories/turn-repository.ts`
```typescript
// ...
private _hydrateSingleEvent(record: EventData, memberMap: Map<string, Member>, unknownUser: (pid: string) => Member): Event | null {
    // ...
    try {
        switch (record.type) {
            // ... (message, member-joined, etc. cases) ...

            case 'check-in':
                return {
                    ...baseEvent,
                    payload: {
                        pointsAwarded: payload.pointsAwarded,
                        consecutiveDays: payload.consecutiveDays,
                        actor: memberMap.get(payload.actorId) ?? unknownUser(payload.actorId),
                    },
                } as CheckInEvent; // 类型断言为新事件

            default:
                // ...
        }
    } catch (error) {
        // ...
    }
}
```

完成这三步后，您的自定义 `check-in` 事件就能无缝地融入 `WorldState`，Agent 将能够在其上下文中看到类似这样的内容：

```xml
<!-- Example in WorldState Prompt -->
<turn id="...">
  <events>
    <event type="check-in" timestamp="...">
      <actor name="张三" .../>
      <pointsAwarded>10</pointsAwarded>
      <consecutiveDays>3</consecutiveDays>
    </event>
  </events>
</turn>
```

### **5. 手动数据清理**

虽然服务会自动进行数据清理，但在某些情况下（如调试或维护），您可能希望手动触发。

```typescript
// 获取服务实例
const worldStateService = ctx['yesimbot.worldState'];

// 调用公共的清理方法
const cleanupResult = await worldStateService.performDataCleanup();

console.log(cleanupResult);
// Output: { deletedTurns: 150, deletedEvents: 3200, deletedResponses: 850 }
```

---

这份文档涵盖了从基础配置到高级扩展的全部内容，为其他开发者使用和集成 `WorldStateService` 提供了清晰的指引。我们的重构工作至此圆满结束！