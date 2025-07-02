import { Context, Logger, Schema, Session } from "koishi";

/**
 * 扩展元数据
 * @template TConfig - 扩展配置的Koishi Schema类型
 */
export interface ExtensionMetadata<TConfig extends Schema = any> {
    /** 扩展的唯一名称，将用作配置键 */
    name: string;
    /** 版本号 */
    version: string;
    /** 扩展描述 */
    description: string;
    /** 扩展的配置项目定义 (使用 Zod) */
    schema?: TConfig;
    /** 作者 */
    author?: string;
    /** 主页 */
    homepage?: string;
    /** 仓库地址 */
    repository?: string;
    /** 许可证 */
    license?: string;
    /** 关键词 */
    keywords?: string[];
}

/**
 * 工具元数据
 */
export interface ToolMetadata {
    /** 工具名称，在扩展内必须唯一 */
    name: string;
    /** 工具描述 */
    description: string;
    /** 版本号 */
    version?: string;
    /** 作者 */
    author?: string;
    /** 工具分类 */
    category?: string;
    /** 标签 */
    tags?: string[];
}

/**
 * 工具执行上下文
 * @template TConfig - 扩展的配置对象类型
 */
export interface ToolExecutionContext<TConfig = any> {
    /** Koishi 上下文 */
    koishiContext: Context;
    /** Koishi 会话 */
    koishiSession: Session;
    /** 日志记录器 */
    logger?: Logger;
    /** 该工具所属扩展的配置 */
    extensionConfig: TConfig;
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
 * 工具定义
 * @template TParams - 工具参数的Zod Schema类型
 * @template TReturns - 工具返回值的类型
 * @template TConfig - 扩展配置对象的类型
 */
export interface ToolDefinition<TParams extends Schema = any, TReturns = any, TConfig = any> {
    name?: string;
    description?: string;
    version?: string;
    metadata?: ToolMetadata;
    parameters: TParams | { properties: { [key: string]: { type: StaticRange; description: string } } };
    execute: (
        context: ToolExecutionContext<TConfig>,
        params: Schemastery.TypeS<TParams>
    ) => Promise<ToolCallResult<TReturns>> | ToolCallResult<TReturns>;
    hooks?: {
        onRegister?: (context: ToolExecutionContext<TConfig>) => Promise<void> | void;
        onUnregister?: (context: ToolExecutionContext<TConfig>) => Promise<void> | void;
        onBeforeExecute?: (params: TParams, context: ToolExecutionContext<TConfig>) => Promise<void> | void;
        onAfterExecute?: (result: ToolCallResult<TReturns>, context: ToolExecutionContext<TConfig>) => Promise<void> | void;
        onError?: (error: Error, context: ToolExecutionContext<TConfig>) => Promise<void> | void;
    };
}

/**
 * 扩展定义
 * @template TConfig - 扩展配置的Zod Schema类型
 */
export interface ExtensionDefinition<TConfig extends Schema = Schema<any>> {
    metadata: ExtensionMetadata<TConfig>;
    tools: ToolDefinition<any, any, Schemastery.TypeS<TConfig>>[];
    onLoad?: (ctx: Context, config: Schemastery.TypeS<TConfig>) => Promise<void>;
    onUnload?: (ctx: Context) => Promise<void>;
}

/**
 * 装饰器模式下的扩展类构造器接口
 */
export interface ExtensionConstructor {
    new (...args: any[]): any;
    getExtensionDefinition(): ExtensionDefinition<any>;
}

/**
 * 可执行的工具对象，为LLM格式化
 */
export interface ExecutableTool<TParams extends Schema<any> = any, TReturns = any> {
    type: "function";
    metadata: ToolMetadata;
    extensionMetadata?: ExtensionMetadata;
    function: {
        name: string;
        description: string;
        parameters: {
            properties: {
                [key: string]: {
                    type: string;
                    description: string;
                    required?: boolean;
                };
            };
        };
    };
    execute: (params: Schemastery.TypeS<TParams>, runtimeContext: Partial<ToolExecutionContext>) => Promise<ToolCallResult<TReturns>>;
}

/**
 * 工具注册选项
 */
export interface ToolRegistrationOptions {
    replace?: boolean;
    enableHooks?: boolean;
    extensionMetadata?: ExtensionMetadata<any>;
}

/**
 * 工具错误类型
 */
export enum ToolErrorType {
    NOT_FOUND = "TOOL_NOT_FOUND",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    EXECUTION_ERROR = "EXECUTION_ERROR",
    TIMEOUT_ERROR = "TIMEOUT_ERROR",
    PERMISSION_ERROR = "PERMISSION_ERROR",
    LOAD_ERROR = "LOAD_ERROR",
    REGISTRATION_ERROR = "REGISTRATION_ERROR",
    CONFIG_ERROR = "CONFIG_ERROR",
}

/**
 * 工具错误类
 */
export class ToolError extends Error {
    constructor(public type: ToolErrorType, message: string, public toolName?: string, public originalError?: Error) {
        super(message);
        this.name = "ToolError";
    }
}
