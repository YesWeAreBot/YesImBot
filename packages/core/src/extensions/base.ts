import { Context, Session } from "koishi"; // 引入 Service
import { ToolResult as XSaiToolResult } from "xsai"; // 别名，避免与 ToolCallResult 混淆
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

/**
 * LLM 上下文对象
 * 用于传递 Koishi 上下文和会话对象
 */
export interface ToolContext {
    koishiContext?: Context; // Koishi 上下文对象
    koishiSession?: Session; // Koishi 会话对象
    [key: string]: unknown; // 允许扩展上下文
}

/**
 * 工具定义 (原始定义)
 * 用于定义工具的名称、描述、参数和执行函数
 */
export type ToolDefinition<TParams extends z.ZodTypeAny = any, TReturns extends z.ZodTypeAny = any> = {
    name: string;
    description: string;
    parameters: TParams;
    execute: (
        params: z.infer<TParams>,
        context: ToolContext
    ) => Promise<ToolCallResult<z.infer<TReturns>>> | ToolCallResult<z.infer<TReturns>>;
};

/**
 * 工具调用结果
 */
export interface ToolCallResult<T = any> {
    success: boolean;
    result?: T;
    error?: string;
}

/**
 * 可执行工具类型
 * 结合了 xsai 的工具描述和我们自己的执行函数
 */
// @ts-ignore
export interface ExecutableTool<TParams extends z.ZodTypeAny = any, TReturns extends z.ZodTypeAny = any> extends XSaiToolResult {
    // XSaiToolResult 包含了 type: "function" 和 function: { name, description, parameters }
    execute: (
        params: z.infer<TParams>,
        context: ToolContext
    ) => Promise<ToolCallResult<z.infer<TReturns>>> | ToolCallResult<z.infer<TReturns>>;
}

/**
 * 工具定义辅助函数 (简单返回输入)
 * @param definition 工具定义
 * @returns 相同的工具定义
 */
export function Tool<T extends z.ZodTypeAny>(definition: ToolDefinition<T>): ToolDefinition<T> {
    return definition;
}

/**
 * 成功结果辅助函数
 * @param result 返回值
 * @returns 成功工具调用结果对象
 */
export function Success<T>(result?: T): ToolCallResult<T> {
    return {
        success: true,
        result: result,
    };
}

/**
 * 失败结果辅助函数
 * @param error 错误信息
 * @returns 失败工具调用结果对象
 */
export function Failed(error: string): ToolCallResult {
    return {
        success: false,
        error: error,
    };
}

/**
 * 定义并封装工具为可执行格式
 * @param definition 工具的原始定义
 * @param baseContext 可选的基础上下文，会在执行时与运行时上下文合并
 * @returns 包含 xsai 描述和可执行函数的工具对象
 */
export function defineTool<TParams extends z.ZodTypeAny, TReturns extends z.ZodTypeAny>(
    definition: ToolDefinition<TParams, TReturns>,
    baseContext: ToolContext = {} // 默认值设为 {}
): ExecutableTool<TParams, TReturns> {
    // 总是将 Zod schema 转换为 JSON schema
    const parametersJsonSchema = zodToJsonSchema(definition.parameters);

    return {
        type: "function",
        // 执行函数：合并 defineTool 传入的基础上下文和运行时传入的上下文
        execute: (params: z.infer<TParams>, runtimeContext: ToolContext) =>
            definition.execute(params, { ...baseContext, ...runtimeContext }),
        function: {
            name: definition.name,
            description: definition.description,
            parameters: parametersJsonSchema as Record<string, unknown>, // 类型断言为 Record<string, unknown>
        },
    };
}

// 常用 Zod 常量定义
export const INNER_THOUGHTS = z.string().describe("Deep inner monologue private to you only.");
export const REQUEST_HEARTBEAT = z
    .boolean()
    .optional()
    .describe(
        "Request an immediate heartbeat after function execution. Set to `true` if you want to send a follow-up message or run a follow-up function."
    );
