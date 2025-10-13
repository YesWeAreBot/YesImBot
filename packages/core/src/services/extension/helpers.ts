import { Context, Schema } from "koishi";
import { ExtensionMetadata, IExtension, NextStep, Param, Properties, ToolDefinition, ToolError, ToolResult } from "./types";

class ToolResultBuilder<T> {
    public result: ToolResult<T>;
    constructor(result: ToolResult<T>) {
        this.result = result;
    }

    /**
     * 附加一个推荐的下一步操作。
     * @param nextStep - 推荐的下一步对象
     */
    withNextStep(nextStep: NextStep): this {
        this.result.metadata ??= {};
        this.result.metadata.nextSteps ??= [];
        this.result.metadata.nextSteps.push(nextStep);
        return this;
    }

    /**
     * 附加任意元数据。
     * @param key - 元数据的键
     * @param value - 元数据的值
     */
    withMetadata(key: string, value: any): this {
        this.result.metadata ??= {};
        this.result.metadata[key] = value;
        return this;
    }

    /**
     * 构建最终的 ToolCallResult 对象。
     */
    build(): ToolResult<T> {
        return this.result;
    }
}

export function Success<T>(result?: T): ToolResultBuilder<T> {
    const initialResult: ToolResult<T> = {
        status: "success",
        result,
    };
    return new ToolResultBuilder(initialResult);
}

export function Failed(error: ToolError | string): ToolResultBuilder<never> {
    const toolError: ToolError = typeof error === "string" ? { name: "ToolError", message: error } : error;
    const initialResult: ToolResult<never> = {
        status: "error",
        error: toolError,
    };
    return new ToolResultBuilder(initialResult);
}

/**
 * 从 Koishi Schema 中提取元信息。
 * @param schema 要解析的 Schema.object 实例
 * @returns 提取出的元信息对象 (Properties)
 */
export function extractMetaFromSchema(schema: Schema): Properties {
    // 2. 确保输入的是一个 object 类型的 schema
    if (schema.type !== "object" || !schema.dict) {
        // console.warn("Input schema is not an object schema.");
        return {};
    }

    // 3. 使用 Object.entries 和 reduce/map 来实现，更函数式和简洁
    return Object.fromEntries(
        Object.entries(schema.dict).map(([key, valueSchema]) => {
            // 4. 为每个属性创建一个基础的元信息对象
            const param: Param = {
                type: valueSchema.type,
                description: valueSchema.meta.description as string,
            };

            // 统一处理通用元信息
            if (valueSchema.meta.required) {
                param.required = true;
            }
            if (valueSchema.meta.default !== undefined) {
                param.default = valueSchema.meta.default;
            }

            // 5. 使用 switch 处理特定类型的逻辑
            switch (valueSchema.type) {
                case "object":
                    // 6. 关键优化：递归调用来处理嵌套对象
                    param.properties = extractMetaFromSchema(valueSchema);
                    break;
                case "union":
                    // 假设 union 用于实现枚举 (enum)
                    if (valueSchema.list?.every((item) => item.type === "const")) {
                        // 可以进一步优化，比如推断 type (string/number)
                        param.type = "string";
                        param.enum = valueSchema.list.map((item) => item.value);
                    }
                    break;
                // 对于 string, number, boolean 等简单类型，基础信息已足够
                case "string":
                case "number":
                case "boolean":
                    break;
                // 可以轻松扩展以支持更多类型，例如 array
                // case 'array':
                //   param.items = extractSingleParam(valueSchema.inner); // 需要一个辅助函数来处理非 object 的 schema
                //   break;
            }

            return [key, param];
        })
    );
}

export interface CreateExtensionOptions<TConfig = any> {
    config?: TConfig;
    tools?: ToolDefinition<TConfig, any>[];
}

export function createExtension<TConfig = any>(
    ctx: Context,
    metadata: ExtensionMetadata<TConfig>,
    options: CreateExtensionOptions<TConfig> = {}
): IExtension<TConfig> {
    const { config, tools = [] } = options;

    const toolMap = new Map<string, ToolDefinition<TConfig, any>>();
    for (const tool of tools) {
        const bounded = {
            ...tool,
            extensionName: metadata.name,
        } as ToolDefinition<TConfig, any>;
        toolMap.set(bounded.name, bounded);
    }

    return {
        ctx,
        config: config ?? ({} as TConfig),
        metadata,
        tools: toolMap,
    };
}
