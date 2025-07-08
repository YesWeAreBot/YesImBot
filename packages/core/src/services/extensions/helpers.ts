import { Schema } from "koishi";
import {
    ExecutableTool,
    ExtensionDefinition,
    ExtensionMetadata,
    ToolDefinition,
    ToolCallResult,
    ToolExecutionContext,
    ToolError,
    ToolErrorType,
} from "./types";

/**
 * 工具定义辅助函数
 */
export function createTool<TParams extends Schema, TReturns = any, TConfig = any>(
    config: ToolDefinition<TParams, TReturns, TConfig>
): ToolDefinition<TParams, TReturns, TConfig> {
    if (!config.metadata) {
        if (!config.name || !config.description) {
            throw createToolError(ToolErrorType.VALIDATION_ERROR, `缺少必要的元信息`);
        }

        config.metadata = {
            name: config.name,
            description: config.description,
        };
    }
    return {
        ...config,
        metadata: {
            version: "1.0.0",
            ...config.metadata,
        },
    };
}

/**
 * 扩展定义辅助函数
 */
export function createExtension<TConfig extends Schema<any>>(config: ExtensionDefinition<TConfig>): ExtensionDefinition<TConfig> {
    return {
        ...config,
        metadata: {
            version: "1.0.0",
            ...config.metadata,
        },
    };
}

/**
 * 成功结果辅助函数
 */
export function Success<T>(result?: T, metadata?: ToolCallResult["metadata"]): ToolCallResult<T> {
    return {
        status: "success",
        result,
        metadata,
    };
}

/**
 * 失败结果辅助函数
 */
export function Failed(error: string, metadata?: ToolCallResult["metadata"]): ToolCallResult {
    return {
        status: "failed",
        error,
        metadata,
    };
}

/**
 * 将工具定义转换为可执行工具
 */
export function defineExecutableTool<TParams extends Schema<any>, TReturns = any, TConfig = any>(
    definition: ToolDefinition<TParams, TReturns, TConfig>,
    baseContext: Partial<ToolExecutionContext<TConfig>> = {},
    extensionMetadata?: ExtensionMetadata
): ExecutableTool<TParams, TReturns> {
    // 生成 JSON Schema
    let parametersJsonSchema;
    try {
        if (definition.parameters && typeof definition.parameters === "object" && "properties" in definition.parameters) {
            parametersJsonSchema = definition.parameters;
        } else {
            const properties: Record<string, unknown> = {};
            const dict = (definition.parameters as Schema<any>).dict;
            Object.keys(dict).forEach((key) => {
                properties[key] = {
                    type: dict[key].type,
                    description: dict[key].meta.description,
                    required: dict[key].meta.required,
                };
            });
            parametersJsonSchema = {
                properties,
            };
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
            parameters: parametersJsonSchema,
        },
        execute: async (params: Schemastery.TypeS<TParams>, runtimeContext: Partial<ToolExecutionContext>) => {
            const mergedContext = { ...baseContext, ...runtimeContext } as ToolExecutionContext<TConfig>;
            await definition?.hooks?.onBeforeExecute?.(params, mergedContext);

            let result: ToolCallResult;

            try {
                result = await definition.execute(mergedContext, params);
            } catch (error) {
                await definition?.hooks?.onError?.(error, mergedContext);

                // 将错误包装成 ToolCallResult
                result = {
                    status: "failed",
                    error: `工具 '${definition.metadata.name}' 执行时发生未捕获的异常: ${error instanceof Error ? error.message : String(error)}`,
                    retryable: false, // 内部崩溃通常是不可重试的
                    metadata: {
                        source: "tool_executor_wrapper",
                        error_stack: error instanceof Error ? error.stack : undefined,
                    },
                };
            } finally {
                // finally 块现在可以安全地假设 result 总是一个有效的 ToolCallResult 对象
                await definition?.hooks?.onAfterExecute?.(result, mergedContext);
                return result;
            }
        },
    };
}

// /**
//  * 验证工具参数
//  */
// export function validateToolParameters<T extends Schema<any>>(
//     schema: T,
//     params: unknown
// ): { success: boolean; data?: Schemastery.TypeS<T>; error?: string } {
//     const result = schema.safeParse(params);
//     if (result.success) {
//         return { success: true, data: result.data };
//     }
//     const errorMessages = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
//     return { success: false, error: `参数验证失败: ${errorMessages.join(", ")}` };
// }

/**
 * 创建工具错误
 */
export function createToolError(type: ToolErrorType, message: string, toolName?: string, originalError?: Error): ToolError {
    return new ToolError(type, message, toolName, originalError);
}

/**
 * 常用参数的辅助函数
 */
export const CommonParams = {
    INNER_THOUGHTS: Schema.string().description("仅供自己参考的内心独白。"),
    REQUEST_HEARTBEAT: Schema.boolean().description("执行后是否需要立即再次思考。"),
};

type RawShape = {
    [k: string]: Schema<any, any>;
};

export function withCommonParams<T extends RawShape>(params: T) {
    return Schema.object({
        inner_thoughts: CommonParams.INNER_THOUGHTS,
        //request_heartbeat: CommonParams.REQUEST_HEARTBEAT,
        ...params,
    });
}

/**
 * 类型守卫：检查是否为有效的工具定义
 */
export function isValidTool(obj: any): obj is ToolDefinition {
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
export function isValidExtension(obj: any): obj is ExtensionDefinition {
    return obj && typeof obj === "object" && obj.metadata && typeof obj.metadata.name === "string" && Array.isArray(obj.tools);
}
