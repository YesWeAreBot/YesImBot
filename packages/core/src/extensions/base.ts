import { tool, ToolResult } from "@xsai/tool";
import { readdirSync } from "fs";
import { Context, Session } from "koishi";
import { z } from "zod";

/**
 * LLM 上下文对象
 * 用于传递 Koishi 上下文和会话对象
 */
export interface LLMContext {
    ctx?: Context;       // Koishi 上下文对象
    session?: Session;   // Koishi 会话对象
    [key: string]: any;  // 允许扩展上下文
}

/**
 * 工具定义
 * 用于定义工具的名称、描述、参数和执行函数
 */
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

/**
 * 定义工具
 * @param definition 
 * @returns 
 */
export function defineTool<T extends z.ZodTypeAny>(definition: ToolDefinition<T>): (context: LLMContext) => Promise<ToolResult> {
    return async (context: LLMContext) =>
       await tool({
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
                    // if (!ctx?.memory && file.startsWith("ext_memory")) {
                    //     ctx.logger.warn(`[Extension] Skip loading: ${file}`)
                    //     return
                    // }
                    const extension = require(`./${file}`) as { [key: string]: (ctx: LLMContext) => ReturnType<typeof tool> };
                    for (const key in extension) {
                        this.toolFactories.push(extension[key]);
                    }

                    ctx.logger.info(`[Extension] Loaded: ${file}`);
                } catch (e) {
                    ctx.logger.error(`[Extension] Failed to load: ${file}`);
                    ctx.logger.error(e.stack);
                }
            });
    }

    /**
     * 获取工具列表
     * @param context 要注入的上下文对象
     */
    async getTools(context: LLMContext) {
        return await Promise.all(this.toolFactories.map((fn) => fn(context)));
    }

    /**
     * 添加工具
     * @param fn 工具工厂函数
     */
    addTool(fn: (ctx: LLMContext) => ReturnType<typeof tool>) {
        this.toolFactories.push(fn);
    }
}
