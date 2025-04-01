import { tool } from "@xsai/tool";
import { readdirSync } from "fs";
import { Context, Session } from "koishi";
import { z } from "zod";

// 定义上下文类型
export interface LLMContext {
    // ctx: Context;       // Koishi 上下文对象
    session?: Session;   // Koishi 会话对象
    [key: string]: any; // 允许扩展上下文
}

// 定义工具类型
export type ToolDefinition<
    TParams extends z.ZodTypeAny = any,
    TReturns extends z.ZodTypeAny = any
> = {
    name: string;
    description: string;
    parameters: TParams;
    execute: (params: z.infer<TParams>, context: LLMContext) => Promise<z.infer<TReturns>>;
    returns?: TReturns;
};

// 工具创建函数
export function defineTool<T extends z.ZodTypeAny>(definition: ToolDefinition<T>) {
    return (context: LLMContext) =>
        tool({
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
            execute: (params: z.infer<T>) => definition.execute(params, context),
            returns: definition.returns,
        });
}

export class ToolManager {
    static instance: Map<Context, ToolManager> = new Map();
    static getInstance(ctx: Context): ToolManager {
        if (!ToolManager.instance.has(ctx)) {
            ToolManager.instance.set(ctx, new ToolManager(ctx));
        }
        return ToolManager.instance.get(ctx);
    }
    private toolFactories: Array<(ctx: LLMContext) => ReturnType<typeof tool>>;
    constructor(private ctx: Context) {
        this.toolFactories = [];
        readdirSync(__dirname)
            .filter((file) => file.startsWith("ext_") && !file.endsWith(".d.ts")) // 不指定 .js 是为了兼容dev模式
            .forEach((file) => {
                try {
                    // 应该在 Metadata 中加入模块所需依赖
                    // 并通过某种手段安装或加载这些依赖
                    // @ts-ignore
                    if (!ctx?.memory && file.startsWith("ext_memory")) {
                        ctx.logger.warn(`Skip load extension: ${file}`)
                        return
                    }
                    const extension = require(`./${file}`) as { [key: string]: (ctx: LLMContext) => ReturnType<typeof tool> };
                    for (const key in extension) {
                        this.toolFactories.push(extension[key]);
                    }

                    ctx.logger.info(`Loaded extension: ${file}`);
                } catch (e) {
                    ctx.logger.error(`Failed to load extension: ${file}`);
                    ctx.logger.error(e.stack);
                }
            });
    }

    /**
     * 获取工具列表
     * @param context 上下文对象
     */
    async getTools(context: LLMContext) {
        return await Promise.all(this.toolFactories.map((fn) => fn(context)));
    }
}
