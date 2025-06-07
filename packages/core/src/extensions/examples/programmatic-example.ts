import { z } from "zod";
import { createExtension, createTool, Failed, Success } from "../helpers";

export default createExtension({
    metadata: {
        name: "programmatic-example",
        description: "一个编程式定义的完整扩展包示例",
        version: "1.0.0",
        schema: z.object({
            allowExecution: z.boolean().default(true).describe("是否允许执行指令"),
        }),
    },
    tools: [
        createTool({
            metadata: {
                name: "execute_koishi_cmd",
                description: "在IM平台执行Koishi指令。",
            },
            parameters: z.object({
                cmd: z.string().describe("要执行的指令内容"),
            }),
            execute: async ({ cmd }, { koishiSession, extensionConfig }) => {
                if (!extensionConfig.allowExecution) {
                    return Failed("指令执行功能已被禁用。");
                }
                await koishiSession.execute(cmd);
                return Success({ executed: true, command: cmd });
            },
        }),
    ],
});
