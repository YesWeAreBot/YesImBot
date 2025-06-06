// ===== 示例3: Hook方式 =====

import { z } from "zod";
import { createTool, createExtension, withCommonParams, Success } from "../helpers";
import { ExtensionMetadata, ToolMetadata } from "../types";

// 扩展元数据
const metadata: ExtensionMetadata = {
    name: "example-extension",
    version: "1.0.0",
    description: "示例插件",
    author: "开发者",
    homepage: "https://github.com/example/example-extension",
    keywords: ["example", "demo"],
};

// 定义工具
const ExecuteTool = createTool({
    name: "execute",
    description: "在IM平台执行指令。可以在当前频道或指定频道执行各种Koishi指令。",
    parameters: withCommonParams({
        cmd: z.string().min(1).describe("要执行的指令内容"),
        channel: z.string().optional().describe("目标频道ID，不填则在当前频道执行"),
        silent: z.boolean().optional().default(false).describe("是否静默执行（不显示执行结果）"),
    }),
    execute: async ({ cmd, channel, silent }, context) => {
        // 实现逻辑
        return Success({ executed: true });
    },
});
const RunCommandTool = createTool({
    name: "run_command",
    description: "运行系统命令",
    parameters: z.object({
        cmd: z.string().min(1).describe("要执行的指令内容"),
    }),
    execute: async ({ cmd }, context) => {
        // 实现逻辑
        return Success({ result: `执行命令: ${cmd}` });
    },
});

// 导出完整的扩展定义
export default createExtension({
    metadata,
    tools: [ExecuteTool, RunCommandTool],
});
