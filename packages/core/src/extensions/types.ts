import { Context, Session } from "koishi";
import { ToolResult as XSaiToolResult } from "xsai";
import { z } from "zod";

/**
 * 工具运行时上下文
 */
export interface ToolContext {
    koishiContext?: Context;
    koishiSession?: Session;
    [key: string]: unknown;
}

/**
 * 工具元数据
 */
export interface ToolMetadata {
    name: string;
    version: string;
    author?: string;
    description: string;
    category?: string;
    tags?: string[];
}

/**
 * 扩展元数据
 */
export interface ExtensionMetadata {
    name: string;
    version: string;
    author?: string;
    description: string;
    homepage?: string;
    repository?: string;
    license?: string;
    keywords?: string[];
}

/**
 * 工具调用结果
 */
export interface ToolCallResult<T = any> {
    success: boolean;
    result?: T;
    error?: string;
    metadata?: {
        executionTime?: number;
        retryCount?: number;
        [key: string]: any;
    };
}

/**
 * 工具生命周期钩子
 */
export interface ToolLifecycleHooks {
    onRegister?: (context: ToolContext) => Promise<void> | void;
    onUnregister?: (context: ToolContext) => Promise<void> | void;
    onBeforeExecute?: (params: any, context: ToolContext) => Promise<void> | void;
    onAfterExecute?: (result: ToolCallResult, context: ToolContext) => Promise<void> | void;
    onError?: (error: Error, context: ToolContext) => Promise<void> | void;
}

/**
 * 工具定义接口
 */
export interface ToolDefinition<TParams extends z.ZodTypeAny = any, TReturns = any> {
    metadata: ToolMetadata;
    parameters: TParams;
    hooks?: ToolLifecycleHooks;
    execute: (params: z.infer<TParams>, context: ToolContext) => Promise<ToolCallResult<TReturns>> | ToolCallResult<TReturns>;
}

/**
 * 扩展定义接口
 */
export interface ExtensionDefinition {
    metadata: ExtensionMetadata;
    tools: ToolDefinition[];
}

/**
 * 可执行工具接口
 */
//@ts-ignore
export interface ExecutableTool<TParams extends z.ZodTypeAny = any, TReturns = any> extends XSaiToolResult {
    metadata: ToolMetadata;
    extensionMetadata?: ExtensionMetadata;
    execute: (params: z.infer<TParams>, context: ToolContext) => Promise<ToolCallResult<TReturns>>;
}

/**
 * 工具注册配置
 */
export interface ToolRegistrationOptions {
    replace?: boolean;
    validateDependencies?: boolean;
    enableHooks?: boolean;
    extensionMetadata?: ExtensionMetadata;
}

/**
 * 工具管理器配置
 */
export interface ToolManagerConfig {
    autoLoad?: boolean;
    extensionPaths?: string[];
    logLevel?: "debug" | "info" | "warn" | "error";
    enableMetrics?: boolean;
    maxRetries?: number;
    timeout?: number;
    hotReload?: boolean;
    validateTypes?: boolean;
}

/**
 * 工具执行选项
 */
export interface ToolExecutionOptions {
    timeout?: number;
    maxRetries?: number;
    enableHooks?: boolean;
    context?: ToolContext;
}

/**
 * 工具错误类型
 */
export enum ToolErrorType {
    NOT_FOUND = "TOOL_NOT_FOUND",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    EXECUTION_ERROR = "EXECUTION_ERROR",
    TIMEOUT_ERROR = "TIMEOUT_ERROR",
    DEPENDENCY_ERROR = "DEPENDENCY_ERROR",
    PERMISSION_ERROR = "PERMISSION_ERROR",
    LOAD_ERROR = "LOAD_ERROR",
    REGISTRATION_ERROR = "REGISTRATION_ERROR",
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

/**
 * 装饰器元数据
 */
export interface DecoratorMetadata {
    target: any;
    propertyKey: string;
    descriptor: PropertyDescriptor;
}
