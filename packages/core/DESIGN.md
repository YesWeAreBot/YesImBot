# YesImBot 设计文档

## 项目概述

YesImBot是一个基于Koishi框架的智能聊天机器人项目，通过接入各种大型语言模型(LLM) API，实现了智能对话、记忆管理和工具调用等能力。它能够接入到IM平台（如QQ、Discord等）参与群聊，提供智能且自然的交互体验。

## 架构设计

### 中间件洋葱模型

YesImBot采用类似Koa的洋葱模型中间件架构，每个中间件可以在请求前后执行代码，形成一个处理链：

```
           ┌────────────────────────────────────────┐
           │               ErrorHandling            │
           │  ┌──────────────────────────────────┐  │
           │  │          DatabaseStorage         │  │
           │  │  ┌────────────────────────────┐  │  │
           │  │  │      MessageCollection     │  │  │
           │  │  │  ┌──────────────────────┐  │  │  │
           │  │  │  │   MemoryRetrieval    │  │  │  │
           │  │  │  │  ┌───────────────┐   │  │  │  │
           │  │  │  │  │ LLMProcessing │   │  │  │  │
           │  │  │  │  │     ...       │   │  │  │  │
Request  ──┼──┼──┼──┼──┼───────────────┼───┼──┼──┼──┼──▶ Response
           │  │  │  │  │               │   │  │  │  │
           │  │  │  │  └───────────────┘   │  │  │  │
           │  │  │  └──────────────────────┘  │  │  │
           │  │  └────────────────────────────┘  │  │
           │  └──────────────────────────────────┘  │
           └────────────────────────────────────────┘
```

这种架构的优势：
- **模块化与解耦**：每个处理步骤独立成中间件，降低了代码耦合度
- **灵活的流程控制**：可以动态调整处理流程，如添加/移除/重排中间件
- **双向处理**：洋葱模型特有的"前进-后退"流程，适合需要上下文传递的场景
- **错误处理**：统一的错误捕获机制，可在任一层处理异常
- **扩展性**：新功能可作为独立中间件添加，无需修改核心代码

### 分层服务架构

YesImBot采用三层架构来管理核心组件：

1. **全局单例层**：应用级别的共享资源
   - ServiceContainer：依赖注入容器
   - BotApplication：应用主类
   - ToolManager：工具管理器
   - MemoryManager：记忆管理器

2. **会话管理层**：管理每个会话的状态和上下文
   - SessionManager：会话管理器
   - SessionContext：会话上下文
   - SessionMemory：会话级记忆

3. **请求处理层**：处理单次消息交互的临时资源
   - MessageContext：消息上下文
   - MiddlewareManager：中间件管理器
   - Scenario：对话场景

## 核心组件

### 1. 消息上下文 (MessageContext)

消息上下文在整个中间件链中传递，包含以下核心属性：
- koishiSession：Koishi会话对象
- sessionId：会话ID
- message：原始消息
- state：会话状态
- messageBuffer：消息缓冲区
- llmResponse：LLM响应
- processedResponse：处理后的响应
- memories：会话记忆
- scenario：对话场景（懒加载）

```typescript
export class MessageContext implements MessageContext {
    public scenario?: Scenario;
    public koishiSession: Session;
    public sessionContext: SessionContext;
    public message: Message;

    async getScenario(): Promise<Scenario> {
        if (!this.scenario) {
            this.scenario = await Scenario.create(
                this.koishiSession.app,
                this.koishiSession
            );
        }
        return this.scenario;
    }
}
```

### 2. 中间件管理器 (MiddlewareManager)

负责注册和执行中间件链：

```typescript
export class MiddlewareManager {
    public middlewares: Middleware[] = [];

    use(middleware: Middleware): this {
        this.middlewares.push(middleware);
        return this;
    }

    async execute(ctx: MessageContext): Promise<void> {
        await this.executeFrom(ctx, 0);
    }

    async executeFrom(ctx: MessageContext, startIndex: number): Promise<void> {
        const dispatch = async (index: number): Promise<void> => {
            if (index >= this.middlewares.length) return;
            const middleware = this.middlewares[index];
            await middleware.execute(ctx, () => dispatch(index + 1));
        };
        await dispatch(startIndex);
    }
}
```

### 3. 会话管理 (SessionManager)

管理多个会话上下文，每个会话拥有独立的状态和记忆：

```typescript
export class SessionManager {
    private sessions = new Map<string, SessionContext>();

    getSession(sessionId: string): SessionContext {
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, new SessionContext(sessionId));
        }
        return this.sessions.get(sessionId);
    }

    cleanupInactiveSessions(maxInactiveTime: number = 3600000) {
        const now = Date.now();
        for (const [id, session] of this.sessions.entries()) {
            if (now - session.lastActiveTime > maxInactiveTime) {
                this.sessions.delete(id);
            }
        }
    }
}
```

### 4. 服务容器 (ServiceContainer)

使用依赖注入模式管理服务实例：

```typescript
export class ServiceContainer {
    private services = new Map<string, any>();

    register<T>(name: string, instance: T): this {
        this.services.set(name, instance);
        return this;
    }

    get<T>(name: string): T {
        if (!this.services.has(name)) {
            throw new Error(`Service '${name}' not found in container`);
        }
        return this.services.get(name) as T;
    }
}
```

### 5. 对话场景 (Scenario)

管理对话上下文和历史消息：

```
Scenario ID: <scenario_id>
Name: <scenario_name>
Description: <scenario_description>
Your role: <your_role>
Members: <member_list>
Chat History:
[<time> <sender>] <content>
You have <count> new messages to read:
[<time> <sender>] <content>
...
```

### 6. 记忆系统 (Memory)

记忆系统分为三个层次：
- **核心记忆(Core Memory)**: 长期保存的关键信息
- **回忆记忆(Recall Memory)**: 最近的对话历史
- **归档记忆(Archival Memory)**: 长期存储但不常用的记忆

## 中间件实现

### 1. 错误处理中间件 (ErrorHandling)

捕获并处理整个中间件链中的错误，确保异常不会导致系统崩溃：

```typescript
export class ErrorHandlingMiddleware implements Middleware {
    name = 'error-handling';
    
    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        try {
            await next();
        } catch (error) {
            // 记录错误日志
            logger.error(`Error in session ${ctx.sessionId}:`, error);
            
            // 重置会话状态
            await ctx.transitionTo(ConversationState.IDLE);
            
            // 向用户发送友好提示
            await ctx.koishiSession.send('抱歉，处理您的消息时出现了问题，请重试。');
        }
    }
}
```

### 2. 消息收集中间件 (MessageCollection)

收集和合并短时间内的连续消息，实现消息等待和合并功能：

```typescript
export class MessageCollectionMiddleware implements Middleware {
    name = 'message-collection';
    
    private collectionTimers = new Map<string, NodeJS.Timeout>();
    
    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 更新活跃时间
        ctx.touch();
        
        // 将当前消息添加到缓冲区
        ctx.messageBuffer.push(ctx.message);
        
        // 如果处于消息收集状态，重置计时器并等待
        if (ctx.state === ConversationState.COLLECTING) {
            this.resetCollectionTimer(ctx);
            return; // 不继续处理，等待收集完成
        }
        
        // 如果处于处理中状态，检查是否需要取消当前请求
        if (ctx.state === ConversationState.PROCESSING && ctx.currentRequest) {
            const isRelated = await this.checkTopicRelatedness(ctx);
            
            if (isRelated) {
                // 相关消息，取消当前请求并重新处理
                await ctx.transitionTo(ConversationState.CANCELLING);
                ctx.currentRequest.abort();
                ctx.currentRequest = undefined;
                await ctx.transitionTo(ConversationState.COLLECTING);
                this.resetCollectionTimer(ctx);
                return;
            } else {
                // 不相关消息，继续当前处理
                return;
            }
        }
        
        // 其他状态下，开始新的收集过程
        await ctx.transitionTo(ConversationState.COLLECTING);
        this.resetCollectionTimer(ctx);
    }
    
    private resetCollectionTimer(ctx: MessageContext): void {
        // 清除旧计时器
        if (this.collectionTimers.has(ctx.sessionId)) {
            clearTimeout(this.collectionTimers.get(ctx.sessionId));
        }
        
        // 设置新计时器
        const timer = setTimeout(async () => {
            try {
                // 收集完成，转换到处理状态
                await ctx.transitionTo(ConversationState.PROCESSING);
                this.collectionTimers.delete(ctx.sessionId);
                
                // 继续处理链
                const manager = ctx.data.middlewareManager as MiddlewareManager;
                if (manager) {
                    // 从下一个中间件开始执行
                    const index = manager.middlewares.findIndex(m => m.name === this.name);
                    if (index >= 0) {
                        await manager.executeFrom(ctx, index + 1);
                    }
                }
            } catch (error) {
                console.error(`Error in collection timer: ${error.message}`);
            }
        }, this.options.collectionTimeout);
        
        this.collectionTimers.set(ctx.sessionId, timer);
    }
}
```

### 3. 记忆检索中间件 (MemoryRetrieval)

检索相关记忆，为LLM提供上下文：

```typescript
export class MemoryRetrievalMiddleware implements Middleware {
    name = 'memory-retrieval';
    
    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 只在处理状态下执行
        if (ctx.state !== ConversationState.PROCESSING) {
            return await next();
        }
        
        try {
            // 提取消息中的关键信息
            const messageContent = ctx.messageBuffer
                .map(msg => msg.content)
                .join('\n');
            
            // 提取当前对话主题
            ctx.currentTopic = await this.extractTopic(messageContent);
            
            // 从记忆中检索相关信息
            ctx.memories = await this.retrieveRelevantMemories(ctx.sessionId, messageContent);
            
            // 继续处理链
            await next();
        } catch (error) {
            throw new Error(`Memory retrieval failed: ${error.message}`);
        }
    }
}
```

### 4. LLM处理中间件 (LLMProcessing)

处理LLM请求，管理并发和超时：

```typescript
export class LLMProcessingMiddleware implements Middleware {
    name = 'llm-processing';
    
    private static concurrentRequests = 0;
    private static requestQueue: {ctx: MessageContext, resolve: Function}[] = [];
    
    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 只在处理状态下执行
        if (ctx.state !== ConversationState.PROCESSING) {
            return await next();
        }
        
        // 检查是否超过并发限制
        if (LLMProcessingMiddleware.concurrentRequests >= this.options.maxConcurrentRequests) {
            // 加入等待队列
            await new Promise<void>(resolve => {
                LLMProcessingMiddleware.requestQueue.push({ctx, resolve});
            });
        }
        
        try {
            LLMProcessingMiddleware.concurrentRequests++;
            
            // 创建可取消的请求
            const abortController = new AbortController();
            ctx.currentRequest = abortController;
            
            // 创建场景对象
            const scenario = await ctx.getScenario();
            
            // 获取适配器
            const { adapter } = this.adapterSwitcher.getAdapter();
            if (!adapter) {
                throw new Error('No LLM adapter available');
            }
            
            // 构建提示词
            const systemPrompt = await this.getSystemPrompt();
            const memoryPrompt = await this.renderMemories(ctx.memories);
            
            // 发送LLM请求
            const { text } = await adapter.chat([
                { role: 'system', content: systemPrompt },
                { role: 'system', content: memoryPrompt },
                { role: 'user', content: scenario.render() }
            ], null, {
                signal: abortController.signal,
                timeout: this.options.requestTimeout
            });
            
            // 存储LLM响应
            ctx.llmResponse = text;
            
            // 转换到响应状态
            await ctx.transitionTo(ConversationState.RESPONDING);
            
            // 继续处理链
            await next();
        } catch (error) {
            if (error.name === 'AbortError') {
                // 请求被取消，不进行错误处理
                return;
            }
            throw error;
        } finally {
            LLMProcessingMiddleware.concurrentRequests--;
            
            // 处理队列中的下一个请求
            if (LLMProcessingMiddleware.requestQueue.length > 0) {
                const next = LLMProcessingMiddleware.requestQueue.shift();
                next.resolve();
            }
        }
    }
}
```

### 5. 响应处理中间件 (ResponseProcessing)

解析LLM响应，执行工具调用：

```typescript
export class ResponseProcessingMiddleware implements Middleware {
    name = 'response-processing';
    
    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 只在响应状态下执行
        if (ctx.state !== ConversationState.RESPONDING) {
            return await next();
        }
        
        try {
            // 解析LLM响应
            let response;
            try {
                response = extractJSONFromString(ctx.llmResponse, "object") as any[];
                if (!Array.isArray(response)) {
                    response = [response];
                }
            } catch (error) {
                throw new Error(`Failed to parse LLM response: ${error.message}`);
            }
            
            // 处理响应
            ctx.processedResponse = [];
            
            for (const func of response) {
                if (!func.function || !func.params) {
                    throw new Error('Invalid function call format');
                }
                
                const { function: functionName, params } = func;
                
                // 记录工具调用
                await this.recordToolCall(ctx, functionName, params);
                
                // 执行工具调用
                const result = await this.executeToolCall(ctx, functionName, params);
                
                // 记录调用结果
                if (functionName !== "send_message") {
                    await this.recordToolResult(ctx, functionName, result);
                }
                
                // 处理特殊功能
                if (functionName === "send_message") {
                    ctx.processedResponse = params.messages || [];
                }
            }
            
            // 继续处理链
            await next();
            
            // 处理完成后重置状态
            await ctx.transitionTo(ConversationState.IDLE);
        } catch (error) {
            throw new Error(`Response processing failed: ${error.message}`);
        }
    }
}
```

### 6. 消息发送中间件 (MessageSending)

发送响应消息，支持打字效果：

```typescript
export class MessageSendingMiddleware implements Middleware {
    name = 'message-sending';
    
    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 只在响应状态下执行
        if (ctx.state !== ConversationState.RESPONDING) {
            return await next();
        }
        
        try {
            // 如果没有处理后的响应，跳过
            if (!ctx.processedResponse || ctx.processedResponse.length === 0) {
                return await next();
            }
            
            // 发送消息
            let delay = true;
            for (let i = 0; i < ctx.processedResponse.length; i++) {
                const message = ctx.processedResponse[i];
                
                // 如果是最后一条消息，不延迟
                if (i >= ctx.processedResponse.length - 1) {
                    delay = false;
                }
                
                // 发送消息
                const messageIds = await ctx.koishiSession.sendQueued(message);
                
                // 记录发送的消息
                await this.recordSentMessage(ctx, messageIds[0], message);
                
                // 如果需要模拟打字效果并且不是最后一条消息
                if (delay && this.options.simulateTyping && this.options.wordsPerSecond > 0) {
                    await this.sleep(message.length / this.options.wordsPerSecond * 1000);
                }
            }
            
            // 继续处理链
            await next();
        } catch (error) {
            throw new Error(`Message sending failed: ${error.message}`);
        }
    }
}
```

### 7. 数据库存储中间件 (DatabaseStorage)

负责消息的持久化存储：

```typescript
export class DatabaseStorageMiddleware implements Middleware {
    name = 'database-storage';
    
    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 在处理前保存接收到的消息
        await this.saveReceivedMessage(ctx);
        
        // 继续处理链
        await next();
        
        // 处理完成后更新会话状态
        await this.updateSessionState(ctx);
    }
}
```

## 状态管理

### 会话状态（ConversationState）

会话状态使用枚举定义：
- **IDLE**: 空闲状态，等待新消息触发
- **COLLECTING**: 收集用户消息状态，等待用户完成输入
- **PROCESSING**: LLM处理中状态
- **RESPONDING**: 回复生成中状态
- **CANCELLING**: 取消旧请求状态

### 状态转换

会话状态转换通过`transitionTo`方法实现，支持状态转换事件处理：

```typescript
async transitionTo(newState: ConversationState): Promise<void> {
    const oldState = this.state;
    this.state = newState;
    
    // 触发状态转换事件
    this.emit('stateChange', {
        sessionId: this.sessionId,
        from: oldState,
        to: newState
    });
    
    // 执行状态进入逻辑
    switch (newState) {
        case ConversationState.COLLECTING:
            // 进入收集状态逻辑
            break;
        case ConversationState.PROCESSING:
            // 进入处理状态逻辑
            break;
        case ConversationState.RESPONDING:
            // 进入响应状态逻辑
            break;
        case ConversationState.CANCELLING:
            // 进入取消状态逻辑
            break;
        case ConversationState.IDLE:
            // 进入空闲状态逻辑
            break;
    }
}
```

## 消息流处理

### 消息处理流程

1. **消息接收**
   - 收到新消息，创建MessageContext
   - 进入消息收集状态，启动合并计时器

2. **消息合并**
   - 在短时间内(如500ms)收到的连续消息合并处理
   - 超时后自动转入处理状态

3. **状态检查**
   - 检查当前会话状态，决定处理方式
   - IDLE状态：直接处理新消息
   - COLLECTING状态：添加到缓冲区，重置超时
   - PROCESSING状态：进行主题相关性检查

4. **主题相关性判断**
   - 如果相关：取消当前LLM请求，更新上下文后重新发送
   - 如果不相关：将消息加入队列，等待当前处理完成后处理

5. **LLM请求管理**
   - 使用AbortController进行请求控制
   - 支持超时和手动取消

6. **回复生成与发送**
   - 状态转换为RESPONDING
   - 分批处理和发送回复

7. **状态重置**
   - 回复完成后重置为IDLE状态
   - 检查消息缓冲区，处理累积的新消息

## 记忆和情感系统

### 记忆系统（Memory）

记忆系统分为三个层次：
- **核心记忆(Core Memory)**: 长期保存的关键信息
- **回忆记忆(Recall Memory)**: 最近的对话历史
- **归档记忆(Archival Memory)**: 长期存储但不常用的记忆

记忆块格式：
```
<persona characters="100/5000">
内容...
</persona>

<human characters="100/5000">
内容...
</human>
```

### 情感系统

情感系统可以维护两个核心维度：
- **愉悦度(Valence)**: -1.0 到 1.0，-1表示极度负面，1表示极度正面
- **唤醒度(Arousal)**: 0.0 到 1.0，0表示完全平静，1表示极度兴奋

情感系统与人格特质相结合：
- 神经质：影响情绪变化速度
- 宜人性：影响情绪基准线
- 开放性：影响新事物的接受度
- 尽责性：影响任务相关情绪反应
- 外向性：影响社交场景中的情绪反应

## 扩展功能

### 日程系统

模拟真实人物的日常安排，影响回复的时间和内容：

```
你是{=name}，{=personality}，{=behavior}
你今天的日程是：{self.today_schedule_text}
现在是{now_time}，结合你的个人特点和行为习惯,注意关注你今天的日程安排和想法
安排你接下来做什么，具体一些，详细一些
直接返回你在做的事情，注意是当前时间，不要输出其他内容：
```

### 知识获取系统

允许在回复中参考外部知识：
- 联网搜索
- 知识库查询
- 文件访问

### 人际关系系统

维护与不同用户的关系状态：
- 熟悉度
- 好感度
- 信任度
- 互动历史

## 应用初始化流程

1. **创建服务容器**：
   ```typescript
   const container = new ServiceContainer();
   ```

2. **注册核心服务**：
   ```typescript
   container.register('toolManager', ToolManager.getInstance());
   container.register('memoryManager', new MemoryManager(ctx, config));
   container.register('sessionManager', new SessionManager());
   container.register('adapterSwitcher', new AdapterSwitcher(config.API.APIList, config.API.Parameters));
   ```

3. **注册中间件**：
   ```typescript
   const middlewareManager = new MiddlewareManager();
   middlewareManager
     .use(new ErrorHandlingMiddleware(ctx.logger))
     .use(new DatabaseStorageMiddleware(ctx))
     .use(new MessageCollectionMiddleware({...}))
     .use(new MemoryRetrievalMiddleware(memoryManager))
     .use(new LLMProcessingMiddleware(adapterSwitcher, {...}))
     .use(new ResponseProcessingMiddleware(toolManager))
     .use(new MessageSendingMiddleware({...}));
   container.register('middlewareManager', middlewareManager);
   ```

4. **注册Koishi中间件**：
   ```typescript
   ctx.middleware(async (session, next) => {
     try {
       // 获取会话上下文
       const sessionManager = container.get<SessionManager>('sessionManager');
       const sessionContext = sessionManager.getSession(session.channelId);
       
       // 创建消息上下文
       const messageContext = new MessageContext(
         session, 
         sessionContext, 
         {
           messageId: session.messageId,
           content: session.content,
           senderId: session.userId,
           timestamp: new Date()
         }
       );
       
       // 执行中间件链
       const middlewareManager = container.get<MiddlewareManager>('middlewareManager');
       await middlewareManager.execute(messageContext);
       
       // 继续Koishi中间件链
       return next();
     } catch (error) {
       logger.error('Error processing message:', error);
       return next();
     }
   });
   ```

## 未来规划

### 1. 情感系统完善

基于人格特质模型，实现更真实的情感变化系统，让机器人表现出更自然的情绪波动。

### 2. 记忆系统增强

实现基于重要性和时间的记忆衰减机制，类似人类的记忆特性，提供更自然的长期交互体验。

### 3. 跨会话知识共享

允许不同会话之间的知识共享，同时维护各自的独立上下文，实现更全面的知识累积。

### 4. 主动行为系统

实现机器人的主动行为，如定期发起对话、分享发现的有趣内容等，增强真实感。

### 5. 自我成长系统

通过交互历史，实现机器人的兴趣和技能进化，打造动态发展的个性。
