### 1.1 核心概念

*   **工具服务 (ToolService)**: 这是整个系统的中枢。作为一个 Koishi `Service`，它负责：
    *   **生命周期管理**: 统一处理所有扩展和工具的注册、卸载。
    *   **调用与执行**: 提供 `invoke` 方法，作为 AI 调用工具的唯一入口。它负责参数验证、执行、重试和结果格式化。
    *   **动态可用性**: 根据当前的会话（`Session`）上下文，动态地提供可用的工具列表。
    *   **命令行接口**: 提供 `tool.*` 和 `extension.*` 指令集，方便管理员进行调试和管理。

*   **扩展 (Extension)**: 工具的组织和管理单元。
    *   在代码中，它是一个被 `@Extension` 装饰器标记的 TypeScript 类。
    *   一个扩展可以包含多个相关的工具，并可以拥有自己的配置（通过静态 `Config` 属性定义）。
    *   它本质上是一个 Koishi 插件，拥有完整的生命周期，可以依赖注入其他服务。

*   **工具 (Tool)**: AI 可以直接调用的具体功能。
    *   在代码中，它是一个在扩展类中被 `@Tool` 装饰器标记的方法。
    *   装饰器会收集工具的元数据（名称、描述、参数 Schema），并将其注册到 `ToolService`。

*   **装饰器 (@Extension & @Tool)**: 这是连接开发者代码与 `ToolService` 的桥梁，实现了“约定优于配置”。
    *   `@Extension`: 将一个普通类“增强”为功能完备的扩展。它自动处理依赖注入、`this` 绑定、向 `ToolService` 的注册和卸载逻辑。
    *   `@Tool`: 将一个类方法声明为一个工具，收集其元数据并附加到类的原型上，以便 `@Extension` 装饰器后续处理。

### 1.2 工作流程

#### 1. 启动与注册流程

当一个包含扩展的 Koishi 插件被加载时，系统会执行以下自动化流程：

1.  **插件加载**: Koishi 通过 `ctx.plugin(MyExtension)` 加载扩展插件。
2.  **装饰器执行**: `@Extension` 装饰器逻辑被触发，它创建了一个继承自 `MyExtension` 的新包装类。
3.  **实例化**: Koishi 实例化这个包装类，并将 `ctx` 和 `config` 传入构造函数。
4.  **依赖注入与绑定**: 包装类的构造函数自动注入 `ToolService`，并遍历所有被 `@Tool` 标记的方法，将其 `execute` 函数的 `this` 上下文永久绑定到当前实例上。
5.  **延迟注册**: 在 `ctx.on('ready')` 事件触发后，实例会调用 `toolService.register(this, ...)` 将自身及其所有工具注册到 `ToolService` 中。
6.  **配置生成**: 在注册过程中，`ToolService` 会读取扩展的静态 `Config`（一个 `Schema` 对象），并动态地将其添加到 Koishi 的主配置结构中。这使得扩展的配置项能够自动出现在 Koishi 控制台的插件配置界面。
7.  **生命周期绑定**: `@Extension` 装饰器同时监听 `ctx.on('dispose')` 事件，以在插件停用时自动从 `ToolService` 中卸载该扩展及其所有工具。

#### 2. 工具调用流程

当 AI 决定调用一个工具时，流程如下：

1.  **发起调用**: 代理（Agent）或其他服务调用 `toolService.invoke(functionName, params, session)`。
2.  **工具查找与鉴权**: `ToolService` 根据 `functionName` 在其注册表中查找工具。同时，如果工具定义了 `isSupported` 函数，会使用当前的 `session` 对象执行该函数，若返回 `false`，则视作工具不可用。
3.  **参数验证**: 这是至关重要的一步。`ToolService` 使用工具定义中的 `parameters` (`Schema` 对象) 对传入的 `params`进行严格的验证和类型转换。如果验证失败，将直接返回一个包含详细错误信息的 `Failed` 结果，防止无效调用进入业务逻辑。
4.  **执行**: 参数验证通过后，`ToolService` 调用工具的 `execute` 方法，传入一个包含 `session` 和所有经过验证的参数的对象。
5.  **结果处理与重试**:
    *   `execute` 方法必须返回一个 `ToolCallResult` 对象（通过 `Success()` 或 `Failed()` 辅助函数创建）。
    *   如果执行成功，`ToolService` 记录日志并返回成功结果。
    *   如果执行失败 (`status: 'failed'`) 并且结果标记为 `retryable: true`，`ToolService` 会根据全局配置（`maxRetry`, `retryDelayMs`）自动进行重试。
    *   如果发生未捕获的异常，`ToolService` 会捕获它，并将其包装成一个失败结果返回，确保系统的健壮性。
6.  **返回结果**: 最终的 `ToolCallResult` 对象被返回给调用方。

这种基于装饰器和服务的架构设计，实现了业务逻辑（工具实现）与系统逻辑（工具管理）的解耦，使得开发者可以更加专注于功能的实现。

## 2. 开发一个新的扩展

下面，我们将通过一个完整的示例，一步步地展示如何创建一个新的工具扩展。

### 2.1 步骤一：创建扩展类并添加元数据

首先，创建一个TypeScript文件（例如 `my-extension.ts`），并定义一个类。然后，使用`@Extension`装饰器来标记这个类，并提供必要的元数据。

```typescript
import { Context, Schema } from 'koishi';
import { Extension, Tool } from '@/services/extension/decorators';
import { IExtension } from '@/services/extension/types';

@Extension({
    name: 'my-awesome-extension', // 扩展的唯一标识，建议使用npm包名
    display: '我的超棒扩展',      // 在UI中显示的名称
    description: '一个演示如何创建扩展的示例项目。',
    author: 'Your Name',
    version: '1.0.0',
})
export default class MyAwesomeExtension implements IExtension {
    // Koishi的Context和扩展的配置会自动注入
    constructor(public ctx: Context, public config: any) {}

    // ... 工具将在这里定义 ...
}
```

**关键点：**

*   `@Extension`装饰器是必需的，它负责将您的类转换为一个可被`ToolService`识别和加载的扩展。
*   `name`字段必须是唯一的，它将作为扩展的标识符。
*   实现`IExtension`接口是可选的，但推荐这样做以获得更好的类型提示。

### 2.2 步骤二：定义扩展的配置（可选）

如果您的扩展需要用户进行配置，您可以在类中定义一个静态的`Config`属性，它应该是一个`Schema`对象。`ToolService`会自动处理配置的加载、验证和默认值。

```typescript
// ... imports ...

interface MyAwesomeExtensionConfig {
    greeting: string;
    enableAdvancedFeatures: boolean;
}

@Extension({ /* ... metadata ... */ })
export default class MyAwesomeExtension implements IExtension {
    // 定义扩展的配置
    static readonly Config: Schema<MyAwesomeExtensionConfig> = Schema.object({
        greeting: Schema.string().default('Hello').description('要使用的问候语。'),
        enableAdvancedFeatures: Schema.boolean().default(false).description('是否启用高级功能。'),
    });

    // 构造函数中可以访问到经过验证的配置
    constructor(public ctx: Context, public config: MyAwesomeExtensionConfig) {
        this.ctx.logger.info(`MyAwesomeExtension已加载，问候语为: ${this.config.greeting}`);
    }

    // ...
}
```

**关键点：**

*   `Config`必须是`static`的。
*   您可以在构造函数和工具方法中通过`this.config`访问到配置项。
*   使用`typeof MyAwesomeExtension.Config.infer`可以获得精确的配置类型。

### 2.3 步骤三：使用`@Tool`装饰器创建工具

在扩展类中，将您希望暴露给AI智能体的方法标记为工具，使用`@Tool`装饰器即可。您需要为每个工具提供详细的描述和参数定义。

```typescript
import { Schema } from 'koishi';
import { Tool, withInnerThoughts } from '@/services/extension/decorators';
import { Success, Failed } from '@/services/extension/helpers';
import { Infer } from '@/services/extension/types';

// ... 在 MyAwesomeExtension 类内部 ...

@Tool({
    name: 'say_hello',
    description: '向指定的人说你好。',
    parameters: withInnerThoughts({
        name: Schema.string().required().description('要问候的人的姓名。'),
    }),
})
async sayHello({ session, name }: Infer<{ name: string }>) {
    if (!session) {
        return Failed('此工具只能在会话上下文中使用。');
    }

    const message = `${this.config.greeting}, ${name}!`;
    await session.send(message);

    return Success({ messageSent: message });
}
```

**关键点：**

*   `@Tool`装饰器应用于类的方法上。
*   `description`字段至关重要，LLM将根据它来决定何时使用此工具。请务必写得清晰、准确、详细。
*   `parameters`字段是一个`Schema`对象，用于定义工具的输入参数。我们强烈建议使用`withInnerThoughts`辅助函数来包装您的参数，这允许LLM在调用工具时提供其“内心独白”，有助于调试和理解其行为。
*   工具方法必须是`async`的，并且应该返回一个`ToolCallResult`对象（通过`Success()`或`Failed()`辅助函数创建）。
*   工具方法的参数是一个对象，它会自动接收到`session`（如果可用）以及所有在`parameters`中定义的参数。使用`Infer<T>`类型可以获得完整的类型提示。

### 2.4 步骤四：控制工具的可用性（可选）

有时，一个工具可能只在特定的平台或会话中可用。您可以通过在`ToolMetadata`中提供`isSupported`函数来实现这一点。

```typescript
// ... 在 MyAwesomeExtension 类内部 ...

@Tool({
    name: 'platform_specific_feature',
    description: '一个只在特定平台上可用的功能。',
    parameters: Schema.object({}),
    isSupported: (session) => session.platform === 'onebot', // 只在 onebot 平台可用
})
async platformSpecificFeature({ session }: Infer<{}>) {
    // ... 实现 ...
    return Success();
}
```

**关键点：**

*   `isSupported`是一个接收`session`对象并返回布尔值的函数。
*   如果`isSupported`返回`false`，`ToolService`将不会在当前会话中提供此工具，`tool.list`和`tool.info`也无法看到它。

## 3. API 参考

### 3.1 装饰器

*   `@Extension(metadata: ExtensionMetadata): ClassDecorator`
    *   **作用**：将一个类转换为工具扩展插件。
    *   **参数**：`metadata` - 扩展的元数据，详见`ExtensionMetadata`接口。

*   `@Tool(metadata: ToolMetadata<TParams>): MethodDecorator`
    *   **作用**：将一个类方法声明为工具。
    *   **参数**：`metadata` - 工具的元数据，详见`ToolMetadata`接口。

### 3.2 核心类型

*   `IExtension<TConfig>`：扩展类应实现的接口。
*   `ToolDefinition<TParams>`：工具的完整定义，包含元数据和`execute`函数。
*   `ToolCallResult<TResult>`：工具执行后返回的结果对象。
*   `ExtensionMetadata`：扩展的元数据定义。
*   `ToolMetadata<TParams>`：工具的元数据定义。

（详细的类型定义请参考项目中的 `types.ts` 文件。）

### 3.3 `ToolService` 公共方法

您可以通过`ctx[Services.Tool]`来访问`ToolService`的实例。

*   `register(extensionInstance: IExtension, enabled: boolean, extConfig: any)`：注册一个扩展实例。
*   `unregister(name: string): boolean`：根据名称卸载一个扩展及其所有工具。
*   `registerTool(definition: ToolDefinition)`：注册一个独立的工具。
*   `unregisterTool(name:string): boolean`：根据名称卸载一个工具。
*   `invoke(functionName: string, params: Record<string, unknown>, session?: Session): Promise<ToolCallResult>`：调用一个工具。
*   `getTool(name: string, session?: Session): ToolDefinition | undefined`：根据名称获取一个在当前会话中可用的工具定义。
*   `getAvailableTools(session?: Session): ToolDefinition[]`：获取当前会話中所有可用的工具定义列表。
*   `getSchema(name: string, session?: Session): ToolSchema | undefined`：获取一个工具的JSON Schema表示。
*   `getToolSchemas(session?: Session): ToolSchema[]`：获取所有可用工具的JSON Schema列表。

### 3.4 辅助函数

*   `Success<T>(result?: T, metadata?: ...): ToolCallResult<T>`：创建一个表示成功的`ToolCallResult`。
*   `Failed(error: string, metadata?: ...): ToolCallResult`：创建一个表示失败的`ToolCallResult`。
*   `withInnerThoughts(params: { [T: string]: Schema<any> }): Schema<any>`：为工具参数添加`inner_thoughts`字段。
*   `extractMetaFromSchema(schema: Schema): Properties`：从Koishi Schema中提取用于生成LLM Tool-Calling JSON的元数据。

## 4. 内置扩展

本系统提供了一些开箱即用的内置扩展，以满足常见的需求。

*   **`command`**：提供`send_platform_command`工具，允许AI智能体执行Koishi的纯文本指令。
*   **`core-util`**：提供一些核心的工具，例如获取当前时间等。
*   **`creator`**：提供与工具创建和管理相关的工具。
*   **`interactions`**：提供与用户交互相关的工具，例如发送消息。
*   **`memory`**：提供用于管理AI智能体记忆的工具。
*   **`qmanager`**：提供队列管理功能。
*   **`search`**：提供网页搜索等信息检索工具。

您可以直接在您的项目中使用这些内置扩展，也可以参考它们的实现来学习如何编写自己的扩展。
