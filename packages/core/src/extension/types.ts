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

export interface ToolSchema {
    name: string;
    description: string;
    parameters: Properties;
}

/**
 * 扩展包元数据接口，用于描述一个扩展包的基本信息。
 */
export interface ExtensionMetadata {
    display?: string; // 显示名称
    name: string; // 扩展包唯一标识，建议使用 npm 包名
    description: string; // 扩展包功能描述
    author?: string; // 作者
    version: string; // 版本号
    builtin?: boolean; // 是否为内置扩展
}

/**
 * 工具元数据接口，用于描述一个可供 LLM 调用的工具。
 */
export interface ToolMetadata<TParams> {
    name?: string; // 工具名称，若不提供，则使用方法名
    description: string; // 工具功能详细描述，这是给 LLM 看的关键信息
    parameters: Schema<TParams>; // 工具的参数定义，使用 Koishi 的 Schema
    isSupported?: (session: Session) => boolean;
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
 * 标准化的工具错误接口
 */
export interface ToolError {
    /** 错误的类型或名称 (例如: 'ValidationError', 'APIFailure', 'RuntimeError') */
    name: string;
    /** 人类可读的错误信息 */
    message: string;
    /** 错误是否可重试 */
    retryable?: boolean;
}

/**
 * 标准化的工具调用结果
 */
export interface ToolCallResult<TResult = any, TError extends ToolError = ToolError> {
    /**
     * 调用状态:
     * - 'success': 成功
     * - 'error': 失败
     */
    status: "success" | "error";
    /** 成功时的返回结果 */
    result?: TResult;
    /** 失败时的结构化错误信息 */
    error?: TError;
    /** 附加元数据，如执行时间(ms)、Token消耗等 */
    metadata?: {
        execution_duration_ms?: number;
        [key: string]: any;
    };
}

/**
 * 扩展包实例需要实现的接口。
 */
export interface IExtension<TConfig = any> extends Object {
    ctx: Context;
    config: TConfig;
    metadata: ExtensionMetadata;
    tools: Map<string, ToolDefinition>;
}

// 一个辅助类型，用于推断并合并 session 到参数中
export type Infer<T> = T & { session?: Session };
