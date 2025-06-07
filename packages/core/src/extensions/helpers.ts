import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import {
    ExecutableTool,
    ExtensionDefinition,
    ExtensionMetadata,
    ToolDefinition,
    ToolCallResult,
    ToolContext,
    ToolError,
    ToolErrorType,
} from "./types";

/**
 * 工具定义辅助函数
 */
export function createTool<TParams extends z.ZodTypeAny, TReturns = any, TConfig = any>(
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
export function createExtension<TConfig extends z.ZodTypeAny>(config: ExtensionDefinition<TConfig>): ExtensionDefinition<TConfig> {
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
export function defineExecutableTool<TParams extends z.ZodTypeAny, TReturns = any, TConfig = any>(
    definition: ToolDefinition<TParams, TReturns, TConfig>,
    baseContext: Partial<ToolContext<TConfig>> = {},
    extensionMetadata?: ExtensionMetadata
): ExecutableTool<TParams, TReturns> {

    // 生成 JSON Schema
    let parametersJsonSchema;
    try {
        if (definition.parameters && typeof definition.parameters === "object" && "properties" in definition.parameters) {
            parametersJsonSchema = definition.parameters;
        } else {
            parametersJsonSchema = zodToJsonSchema(definition.parameters as z.ZodTypeAny);
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
        execute: async (params: z.infer<TParams>, runtimeContext: Partial<ToolContext>) => {
            const mergedContext = { ...baseContext, ...runtimeContext } as ToolContext<TConfig>;
            // 执行逻辑...
            // (省略了钩子以保持简洁，实际代码中应保留)
            return definition.execute(params, mergedContext);
        },
    };
}

/**
 * 验证工具参数
 */
export function validateToolParameters<T extends z.ZodTypeAny>(
    schema: T,
    params: unknown
): { success: boolean; data?: z.infer<T>; error?: string } {
    const result = schema.safeParse(params);
    if (result.success) {
        return { success: true, data: result.data };
    }
    const errorMessages = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
    return { success: false, error: `参数验证失败: ${errorMessages.join(", ")}` };
}

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
    INNER_THOUGHTS: z.string().describe("仅供自己参考的内心独白。"),
    REQUEST_HEARTBEAT: z.boolean().optional().describe("执行后是否需要立即再次思考。"),
};

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
