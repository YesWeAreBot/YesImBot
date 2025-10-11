// --- 核心类型定义 ---

import { Bot, Context, Schema, Session } from "koishi";

import { AnyAgentStimulus, WorldState } from "@/services/worldstate";

export interface ToolInvocation {
    /** 原始刺激 */
    readonly stimulus: AnyAgentStimulus;
    /** 触发平台 (如果存在) */
    readonly platform?: string;
    /** 触发频道/会话 ID (如果存在) */
    readonly channelId?: string;
    /** 触发用户或群组 ID */
    readonly guildId?: string;
    /** 触发用户 ID */
    readonly userId?: string;
    /** 当前机器人实例 */
    readonly bot?: Bot;
    /** (可选) 原始 Session，用于需要直接访问适配器 API 的工具 */
    readonly session?: Session;
    /** (可选) 世界状态快照 */
    readonly world?: WorldState;
    /** 其他共享元数据 */
    readonly metadata?: Record<string, unknown>;
}

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
    type?: "tool" | "action";
    hints?: string[];
}

export interface SupportGuardContext<TConfig = any> {
    invocation: ToolInvocation;
    config: TConfig;
}

export type SupportGuard<TConfig = any> = (ctx: SupportGuardContext<TConfig>) => boolean | { ok: boolean; reason?: string };

export interface ActivatorResult {
    allow: boolean;
    priority?: number;
    hints?: string[];
}

export type Activator<TConfig = any> = (ctx: SupportGuardContext<TConfig>) => Promise<ActivatorResult>;

/**
 * 扩展包元数据接口，用于描述一个扩展包的基本信息。
 */
export interface ExtensionMetadata<TConfig = any> {
    display?: string; // 显示名称
    name: string; // 扩展包唯一标识，建议使用 npm 包名
    description: string; // 扩展包功能描述
    author?: string; // 作者
    version?: string; // 版本号
    builtin?: boolean; // 是否为内置扩展
}

export interface WorkflowCondition {
    path: string;
    equals?: any;
    notEquals?: any;
    exists?: boolean;
}

export interface WorkflowNode {
    tool: string;
    label?: string;
    entry?: boolean;
    final?: boolean;
}

export interface WorkflowEdge {
    from: string;
    to: string;
    confidence?: number;
    auto?: boolean;
    promptHint?: string;
    condition?: WorkflowCondition;
}

export interface ToolWorkflow {
    id?: string;
    auto?: boolean;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}

/**
 * 工具元数据接口，用于描述一个可供 LLM 调用的工具。
 */
export interface ToolMetadata<TConfig = {}, TParams = any> {
    name?: string; // 工具名称，若不提供，则使用方法名
    description: string; // 工具功能详细描述，这是给 LLM 看的关键信息
    parameters: Schema<TParams>; // 工具的参数定义，使用 Koishi 的 Schema
    type?: "tool" | "action"; // 工具类型，'tool' 用于获取信息，'action' 用于执行操作
    supports?: SupportGuard<TConfig>[];
    activators?: Activator<TConfig>[]; // 工具激活器，用于更智能的筛选
    workflow?: ToolWorkflow;
}

/**
 * 推荐的下一步操作
 */
export interface NextStep {
    toolName: string;
    description: string; // 为什么推荐这个工具
    // (可选) 预填充的参数，从上一步结果中提取
    prefilledParams?: Record<string, any>;
}

/**
 * 完整的工具定义，包含了元数据和可执行函数。
 */
export interface ToolDefinition<TConfig = {}, TParams = any, TResult = any> extends ToolMetadata<TConfig, TParams> {
    execute: (params: TParams, invocation: ToolInvocation) => Promise<ToolResult<TResult> | { build: () => ToolResult<TResult> }>;
    extensionName: string; // 所属扩展的名称
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
export interface ToolResult<TResult = any, TError extends ToolError = ToolError> {
    /**
     * 调用状态:
     * - 'success': 成功
     * - 'error': 失败
     */
    status: "success" | "error" | string;
    /** 成功时的返回结果 */
    result?: TResult;
    /** 失败时的结构化错误信息 */
    error?: TError;
    /** 附加元数据，可以包含 nextSteps 等 */
    metadata?: Record<string, any> & {
        nextSteps?: NextStep[];
    };
}

export type ToolCallResult<TResult = any, TError extends ToolError = ToolError> = ToolResult<TResult, TError>;

/**
 * 扩展包实例需要实现的接口。
 */
export interface IExtension<TConfig = any> extends Object {
    ctx: Context;
    config: TConfig;
    metadata: ExtensionMetadata;
    tools: Map<string, ToolDefinition>;
}

// @deprecated: 旧类型，已由 ToolInvocation 替代
export type WithSession<T> = T & { session?: Session };

// @deprecated: 旧类型，已由 ToolInvocation 和 params 分离替代
export type Infer<T> = T;
