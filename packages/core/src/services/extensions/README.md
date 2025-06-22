# Athena 扩展开发指南

Athena 扩展系统允许开发者为大模型添加新的功能（工具）。每个扩展可以包含一个或多个工具，这些工具将被注册到 `ToolManager` 中，供大模型在需要时调用。

本指南将介绍创建扩展的三种主要方式。

---

## 1. 方式一：使用装饰器（推荐用于复杂扩展）

通过类和装饰器的方式来组织代码，结构清晰，适合包含多个工具的复杂扩展。

-   `@Extension`: 定义扩展的元数据。
-   `@Tool`: 定义一个类方法为工具。
-   `@Params`: 定义工具的输入参数 schema (使用 Zod)。

**示例 (`packages/core/src/extensions/examples/decorator.ts`):**

```typescript
import { z } from "zod";
import { Extension, Tool, Params, ExtensionConstructor } from "../decorators";
import { withCommonParams, Success, Failed } from "../utils";

@Extension({
    name: "example-decorator-extension",
    version: "1.0.0",
    description: "一个使用装饰器定义的示例插件",
    author: "开发者",
})
export default class ExampleExtension {
    @Tool({
        name: "run_command",
        description: "运行一个模拟的系统命令",
        category: "System",
    })
    @Params(
        z.object({
            cmd: z.string().min(1).describe("要执行的指令内容"),
        })
    )
    async runCommand({ cmd }, context) {
        try {
            context.koishiContext?.logger.info(`模拟执行命令: ${cmd}`);
            return Success({ output: `模拟执行结果: ${cmd}` });
        } catch (error) {
            return Failed(`命令执行失败: ${(error as Error).message}`);
        }
    }
}
```

## 2. 方式二：创建完整扩展包（推荐用于中等复杂度的扩展）

如果不想使用类和装饰器，可以通过 createExtension 和 createTool 函数来编程式地构建一个完整的扩展包。

**示例 (`packages/core/src/extensions/examples/hook.ts`):**

```typescript
import { z } from "zod";
import { createTool, createExtension } from "../definition";
import { withCommonParams, Success } from "../utils";
import { ExtensionMetadata } from "../types";

// 1. 定义扩展元数据
const metadata: ExtensionMetadata = {
    name: "example-programmatic-extension",
    version: "1.0.0",
    description: "一个编程式定义的示例插件",
    author: "开发者",
};

// 2. 定义工具
const ExecuteTool = createTool({
    name: "execute_koishi_cmd",
    description: "在IM平台执行Koishi指令。",
    parameters: withCommonParams({
        cmd: z.string().describe("要执行的指令内容"),
    }),
    execute: async ({ cmd }, context) => {
        // ...实现逻辑
        return Success({ executed: true });
    },
});

// 3. 使用 createExtension 组合并导出
export default createExtension({
    metadata,
    tools: [ExecuteTool],
});
```

# 3. 方式三：直接导出工具（推荐用于简单的单个或多个工具）

这是最简单的方式。只需在一个文件中使用 createTool 创建一个或多个工具，然后将它们作为命名导出即可。ToolManager 会自动发现并注册这些工具。

示例 (``packages/core/src/extensions/examples/direct.ts``):

```typescript
import { z } from "zod";
import { createTool, Success, Failed, withCommonParams } from "../utils";
import { defineExecutableTool } from "../definition";


export const SimpleExecuteTool = createTool({
    name: "simple_execute",
    description: "在IM平台执行指令。",
    parameters: withCommonParams({
        cmd: z.string().min(1).describe("要执行的指令内容"),
    }),
    execute: async ({ cmd }, context) => {
        const { koishiSession } = context;
        if (!koishiSession) {
            return Failed("缺少会话对象");
        }
        await koishiSession.execute(cmd);
        return Success({ command: cmd, executed: true });
    },
});

// 你可以在同一个文件中导出多个工具
export const AnotherSimpleTool = createTool({
    name: "another_simple_tool",
    description: "另一个简单的示例工具",
    parameters: z.object({
        input: z.string().describe("输入内容"),
    }),
    execute: async ({ input }) => {
        return Success({ output: `处理结果: ${input}` });
    },
});
```
