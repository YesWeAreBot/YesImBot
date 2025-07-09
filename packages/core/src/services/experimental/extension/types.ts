// --- 核心类型定义 ---

import { Context, Schema, Session } from "koishi";

export interface Param {
    type: string;
    description?: string;
    default?: any;
    required?: boolean;
    // 用于 object 类型
    properties?: Properties;
    // 用于 union/enum 类型
    enum?: any[];
    // (可选扩展) 用于 array 类型
    items?: Param;
}

export type Properties = Record<string, Param>;

/**
 * 扩展包元数据接口，用于描述一个扩展包的基本信息。
 */
export interface ExtensionMetadata {
    name: string; // 扩展包唯一标识，建议使用 npm 包名
    description: string; // 扩展包功能描述
    author?: string; // 作者
    version: string; // 版本号
}

/**
 * 工具元数据接口，用于描述一个可供 LLM 调用的工具。
 */
export interface ToolMetadata<TParams> {
    name?: string; // 工具名称，若不提供，则使用方法名
    description: string; // 工具功能详细描述，这是给 LLM 看的关键信息
    parameters: Schema<TParams>; // 工具的参数定义，使用 Koishi 的 Schema
}

/**
 * 完整的工具定义，包含了元数据和可执行函数。
 */
export interface ToolDefinition<TParams = any> {
    name: string;
    description: string;
    parameters: Schema<TParams>;
    isSupported?: (session: Session) => boolean;
    execute: (args: Infer<TParams>) => Promise<any>;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult<TResult = any> {
    status: "success" | "failed" | string;
    /** 返回结果 */
    result?: TResult;
    /** 错误信息 */
    error?: string;
    /** 是否可重试 */
    retryable?: boolean;
    /** 附加元数据，如执行时间等 */
    metadata?: Record<string, any>;
}

/**
 * 扩展包实例需要实现的接口。
 */
export interface IExtension<TConfig = any> {
    ctx: Context;
    config: TConfig;
    metadata: ExtensionMetadata;
    tools: Map<string, ToolDefinition>;
}

// 一个辅助类型，用于推断并合并 session 到参数中
export type Infer<T> = T & { session?: Session };

// --- 核心抽象与实现 ---

/**
 * 抽象基类，所有扩展都应继承它。
 * 它处理了从原型复制元数据和自动绑定工具方法中 `this` 的通用逻辑。
 */
export abstract class BaseExtension<TConfig = any> implements IExtension<TConfig> {
    public static Config: Schema<any> = Schema.object({});

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
    }
}
