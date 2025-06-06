import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import {
    ExecutableTool,
    ExtensionDefinition,
    ExtensionMetadata,
    ToolCallResult,
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolErrorType,
} from "./types";

/**
 * 工具定义辅助函数
 */
export function createTool<TParams extends z.ZodTypeAny, TReturns = any>(config: {
    name: string;
    description: string;
    parameters: TParams;
    execute: (params: z.infer<TParams>, context: ToolContext) => Promise<ToolCallResult<TReturns>> | ToolCallResult<TReturns>;
    version?: string;
    author?: string;
    category?: string;
    tags?: string[];
    hooks?: ToolDefinition["hooks"];
}): ToolDefinition<TParams, TReturns> {
    return {
        metadata: {
            name: config.name,
            version: config.version || "1.0.0",
            description: config.description,
            author: config.author,
            category: config.category,
            tags: config.tags,
        },
        parameters: config.parameters,
        execute: config.execute,
        hooks: config.hooks,
    };
}

/**
 * 扩展定义辅助函数
 */
export function createExtension(config: {
    metadata: ExtensionMetadata,
    tools: ToolDefinition[];
}): ExtensionDefinition {
    return {
        metadata: config.metadata,
        tools: config.tools,
    };
}

/**
 * 成功结果辅助函数
 */
export function Success<T>(result?: T, metadata?: ToolCallResult["metadata"]): ToolCallResult<T> {
    return {
        success: true,
        result,
        metadata,
    };
}

/**
 * 失败结果辅助函数
 */
export function Failed(error: string, metadata?: ToolCallResult["metadata"]): ToolCallResult {
    return {
        success: false,
        error,
        metadata,
    };
}

/**
 * 将工具定义转换为可执行工具
 */
export function defineExecutableTool<TParams extends z.ZodTypeAny, TReturns = any>(
    definition: ToolDefinition<TParams, TReturns>,
    baseContext: ToolContext = {},
    extensionMetadata?: ExtensionMetadata
): ExecutableTool<TParams, TReturns> {
    // 生成 JSON Schema
    let parametersJsonSchema;
    try {
        if (definition.parameters && typeof definition.parameters === "object" && "properties" in definition.parameters) {
            parametersJsonSchema = definition.parameters;
        } else {
            parametersJsonSchema = zodToJsonSchema(definition.parameters);
        }
    } catch (error) {
        throw createToolError(
            ToolErrorType.VALIDATION_ERROR,
            `工具 ${definition.metadata.name} 的参数模式无效`,
            definition.metadata.name,
            error as Error
        );
    }

    return {
        type: "function",
        metadata: definition.metadata,
        extensionMetadata,
        function: {
            name: definition.metadata.name,
            description: definition.metadata.description,
            parameters: parametersJsonSchema as Record<string, unknown>,
        },
        execute: async (params: z.infer<TParams>, runtimeContext: ToolContext) => {
            const mergedContext = { ...baseContext, ...runtimeContext };

            try {
                // 执行前置钩子
                if (definition.hooks?.onBeforeExecute) {
                    await definition.hooks.onBeforeExecute(params, mergedContext);
                }

                const result = await definition.execute(params, mergedContext);

                // 执行后置钩子
                if (definition.hooks?.onAfterExecute) {
                    await definition.hooks.onAfterExecute(result, mergedContext);
                }

                return result;
            } catch (error) {
                // 执行错误钩子
                if (definition.hooks?.onError) {
                    try {
                        await definition.hooks.onError(error as Error, mergedContext);
                    } catch (hookError) {
                        // 钩子错误不应该影响主要错误的抛出
                        console.warn("Hook execution failed:", hookError);
                    }
                }

                throw error;
            }
        },
    };
}

/**
 * 验证工具参数
 */
export function validateToolParameters<T extends z.ZodTypeAny>(
    schema: T,
    params: unknown
): { success: true; data: z.infer<T> } | { success: false; error: string } {
    try {
        const result = schema.parse(params);
        return { success: true, data: result };
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors.map((e) => {
                const path = e.path.length > 0 ? e.path.join(".") : "根级别";
                return `${path}: ${e.message}`;
            });
            return { success: false, error: `参数验证失败: ${errorMessages.join(", ")}` };
        }
        return { success: false, error: `参数验证失败: ${(error as Error).message}` };
    }
}

/**
 * 创建工具错误
 */
export function createToolError(type: ToolErrorType, message: string, toolName?: string, originalError?: Error): ToolError {
    return new ToolError(type, message, toolName, originalError);
}

/**
 * 超时包装器
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName?: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(createToolError(ToolErrorType.TIMEOUT_ERROR, `工具执行超时 (${timeoutMs}ms)`, toolName));
            }, timeoutMs);
        }),
    ]);
}

/**
 * 重试包装器
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    toolName?: string,
    onRetry?: (retryCount: number) => void
): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error as Error;

            if (attempt < maxRetries) {
                onRetry?.(attempt + 1);
                // 指数退避
                await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }

    throw createToolError(ToolErrorType.EXECUTION_ERROR, `工具执行失败，已重试 ${maxRetries} 次`, toolName, lastError);
}

/**
 * 常用参数模式
 */
export const CommonParams = {
    INNER_THOUGHTS: z.string().describe("内心独白，仅对你自己可见"),
    REQUEST_HEARTBEAT: z.boolean().optional().describe("是否在函数执行后请求立即心跳"),
    CHANNEL_ID: z.string().optional().describe("频道ID，不填则使用当前频道"),
    USER_ID: z.string().optional().describe("用户ID"),
    MESSAGE_ID: z.string().optional().describe("消息ID"),
};

/**
 * 创建带有通用参数的参数模式
 */
export function withCommonParams<T extends z.ZodRawShape>(params: T) {
    return z.object({
        inner_thoughts: CommonParams.INNER_THOUGHTS,
        request_heartbeat: CommonParams.REQUEST_HEARTBEAT,
        ...params,
    });
}

/**
 * 类型守卫：检查是否为有效的工具定义
 */
export function isValidToolDefinition(obj: any): obj is ToolDefinition {
    return (
        obj &&
        typeof obj === "object" &&
        obj.metadata &&
        typeof obj.metadata.name === "string" &&
        typeof obj.metadata.description === "string" &&
        typeof obj.execute === "function" &&
        obj.parameters
    );
}

/**
 * 类型守卫：检查是否为有效的扩展定义
 */
export function isValidExtensionDefinition(obj: any): obj is ExtensionDefinition {
    return (
        obj &&
        typeof obj === "object" &&
        obj.metadata &&
        typeof obj.metadata.name === "string" &&
        typeof obj.metadata.version === "string" &&
        typeof obj.metadata.description === "string" &&
        Array.isArray(obj.tools) &&
        obj.tools.every(isValidToolDefinition)
    );
}
