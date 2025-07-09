import { Context, Schema } from "koishi";
import { ExtensionMetadata, IExtension, Param, Properties, ToolCallResult, ToolDefinition } from "./types";
import { Services } from "../types";

// --- 核心抽象与实现 ---

/**
 * 抽象基类，所有扩展都应继承它。
 * 它处理了从原型复制元数据和自动绑定工具方法中 `this` 的通用逻辑。
 */
export abstract class BaseExtension<TConfig = any> implements IExtension<TConfig> {
    public static Config: Schema<any> = Schema.object({});

    public static inject: string[];

    // 实例的自有属性
    public metadata: ExtensionMetadata;
    public tools: Map<string, ToolDefinition>;

    constructor(public ctx: Context, public config: TConfig) {
        // 1. 从类的原型上获取由 @Extension 装饰器附加的元数据，并将其设为实例的自有属性。
        this.metadata = this.constructor.prototype.metadata;

        // 2. 关键步骤：处理工具的 `this` 绑定
        const protoTools: Map<string, ToolDefinition> | undefined = this.constructor.prototype.tools;
        if (protoTools) {
            // 为当前实例创建一个全新的 Map，避免实例间共享
            this.tools = new Map<string, ToolDefinition>();

            // 遍历原型上的所有工具定义
            for (const [name, tool] of protoTools.entries()) {
                // 创建一个新工具对象，其 execute 方法通过 .bind(this) 永久绑定到当前实例
                this.tools.set(name, Object.assign({}, tool, { execute: tool.execute.bind(this) }));
            }
        }

        ctx.on("ready", () => {
            const toolService = ctx[Services.Tool];
            toolService.register(this, config);
            ctx.logger.info(`Tool Extension [${this.metadata.name}] loaded.`);
        });

        ctx.on("dispose", () => {
            const toolService = ctx[Services.Tool];
            toolService.unregister(this.metadata.name);
            ctx.logger.info(`Tool Extension [${this.metadata.name}] unloaded.`);
        });
    }
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
