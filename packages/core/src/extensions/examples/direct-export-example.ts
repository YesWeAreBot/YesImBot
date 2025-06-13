import { Schema } from "koishi";
import { createTool, Success, Failed } from "../helpers";

// 注意：此模式不支持扩展级别的配置

export const SimpleLogTool = createTool({
    metadata: {
        name: "simple_log",
        description: "向控制台打印一条日志。",
    },
    parameters: Schema.object({
        message: Schema.string().description("要打印的消息"),
    }),
    execute: async ({ message }, { koishiContext }) => {
        koishiContext.logger.info(`[SimpleLogTool] ${message}`);
        return Success("日志已打印。");
    },
});

export const SimpleAddTool = createTool({
    metadata: {
        name: "simple_add",
        description: "计算两个数字的和。",
    },
    parameters: Schema.object({
        a: Schema.number(),
        b: Schema.number(),
    }),
    execute: async ({ a, b }) => {
        return Success({ result: a + b });
    },
});
