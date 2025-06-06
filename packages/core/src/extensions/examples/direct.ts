// ===== 示例1: 简单文件导出方式 =====

import { z } from "zod";
import { createTool, Success, Failed, withCommonParams } from "../helpers";

export const ExecuteTool = createTool({
    name: "execute",
    description: "在IM平台执行指令。可以在当前频道或指定频道执行各种Koishi指令。",
    version: "2.0.0",
    parameters: withCommonParams({
        cmd: z.string().min(1).describe("要执行的指令内容"),
        channel: z.string().optional().describe("目标频道ID，不填则在当前频道执行"),
        silent: z.boolean().optional().default(false).describe("是否静默执行（不显示执行结果）"),
    }),
    hooks: {
        onBeforeExecute: async (params, context) => {
            const { koishiContext } = context;
            koishiContext?.logger.debug(`[ExecuteTool] 准备执行指令: ${params.cmd}`);
        },
        onAfterExecute: async (result, context) => {
            const { koishiContext } = context;
            if (result.success) {
                koishiContext?.logger.debug(`[ExecuteTool] 指令执行成功`);
            } else {
                koishiContext?.logger.debug(`[ExecuteTool] 指令执行失败: ${result.error}`);
            }
        },
    },
    execute: async ({ cmd, channel, silent, inner_thoughts, request_heartbeat }, context) => {
        const { koishiContext, koishiSession } = context;
        if (!koishiContext || !koishiSession) {
            return Failed("缺少必要的Koishi上下文或会话对象");
        }
        // 工具实现逻辑...
        return Success({
            command: cmd,
            executed: true,
            channel: channel || koishiSession.channelId,
        });
    },
});

// 导出多个工具
export const AnotherTool = createTool({
    name: "another_tool",
    description: "另一个示例工具",
    parameters: z.object({
        input: z.string().describe("输入内容"),
    }),
    execute: async ({ input }, context) => {
        return Success({ output: `处理结果: ${input}` });
    },
});
