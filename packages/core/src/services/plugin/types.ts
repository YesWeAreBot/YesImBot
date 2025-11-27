import type { Schema, Session } from "koishi";
import type { HorizonView, Percept } from "@/services/horizon/types";

export interface PluginMetadata {
    name: string;
    display?: string;
    description: string;
    version?: string;
    author?: string;
    builtin?: boolean;
}

export interface ToolContext<TConfig = any> {
    config?: TConfig;
    session?: Session;
    view?: HorizonView;
    percept?: Percept;
    [key: string]: any;
}

/**
 * Tool type discriminator.
 */
export enum ToolType {
    /** Information retrieval - returns data for further processing */
    Tool = "tool",
    /** Concrete action - performs operation, may not need return inspection */
    Action = "action",
}

/**
 * Guard context for support guards and activators.
 */
export interface GuardContext<TConfig = any> {
    context: ToolContext;
    config: TConfig;
}

/**
 * Support guard - synchronous availability check.
 */
export type SupportGuard<TConfig = any> = (ctx: GuardContext<TConfig>) => boolean | { ok: boolean; reason?: string };

/**
 * Activator result.
 */
export interface ActivatorResult {
    allow: boolean;
    priority?: number;
    hints?: string[];
}

/**
 * Activator - async intelligent filtering.
 */
export type Activator<TConfig = any> = (ctx: GuardContext<TConfig>) => Promise<ActivatorResult>;

/**
 * Workflow types.
 */
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
 * Base tool descriptor (shared between Tool and Action).
 */
export interface BaseToolDescriptor<TConfig = any, TParams = any> {
    /** Tool name (defaults to method name) */
    name?: string;
    /** Detailed description for LLM */
    description: string;
    /** Parameter schema */
    parameters: Schema<TParams>;
    /** Support guards (synchronous availability checks) */
    supports?: SupportGuard<TConfig>[];
    /** Activators (async intelligent filtering) */
    activators?: Activator<TConfig>[];
    /** Workflow definition */
    workflow?: ToolWorkflow;
}

/**
 * Tool descriptor (information retrieval).
 */
export interface ToolDescriptor<TConfig = any, TParams = any> extends BaseToolDescriptor<TConfig, TParams> {
    type: ToolType.Tool;
}

export interface ToolDefinition<TConfig = any, TParams = any, TResult = any> extends ToolDescriptor<TConfig, TParams> {
    /** Execution function */
    execute: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>;
    /** Parent extension name */
    extensionName: string;
}

/**
 * Action descriptor (concrete operation).
 */
export interface ActionDescriptor<TConfig = any, TParams = any> extends BaseToolDescriptor<TConfig, TParams> {
    type: ToolType.Action;
    /** Whether action should trigger heartbeat continuation */
    continueHeartbeat?: boolean;
}

export interface ActionDefinition<TConfig = any, TParams = any, TResult = any>
    extends ActionDescriptor<TConfig, TParams> {
    /** Execution function */
    execute: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>;
    /** Parent extension name */
    extensionName: string;
}

/**
 * Union of tool descriptors.
 */
export type AnyToolDescriptor<TConfig = any, TParams = any>
    = | ToolDescriptor<TConfig, TParams>
        | ActionDescriptor<TConfig, TParams>;

/**
 * Complete tool definition with execution function.
 */
export type AnyToolDefinition<TConfig = any, TParams = any, TResult = any>
    = | ToolDefinition<TConfig, TParams, TResult>
        | ActionDefinition<TConfig, TParams, TResult>;

/**
 * Tool schema for LLM (serializable format).
 */
export interface Param {
    type: string;
    description?: string;
    default?: any;
    required?: boolean;
    properties?: Properties;
    enum?: any[];
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

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a tool definition is an Action.
 * Useful for runtime type checking and accessing action-specific properties.
 */
export function isAction<TConfig = any, TParams = any, TResult = any>(
    tool: AnyToolDefinition<TConfig, TParams, TResult>,
): tool is ActionDefinition<TConfig, TParams, TResult> {
    return tool.type === ToolType.Action;
}

/**
 * Type guard to check if a tool definition is a Tool (information retrieval).
 * Useful for runtime type checking and distinguishing from actions.
 */
export function isTool<TConfig = any, TParams = any, TResult = any>(
    tool: AnyToolDefinition<TConfig, TParams, TResult>,
): tool is ToolDefinition<TConfig, TParams, TResult> {
    return tool.type === ToolType.Tool;
}

/**
 * Tool execution status.
 */
export enum ToolStatus {
    Success = "success",
    Error = "error",
    PartialSuccess = "partial_success",
    Warning = "warning",
}

/**
 * Tool error types.
 */
export enum ToolErrorType {
    ValidationError = "validation_error",
    PermissionDenied = "permission_denied",
    ResourceNotFound = "resource_not_found",
    NetworkError = "network_error",
    RateLimitExceeded = "rate_limit_exceeded",
    InternalError = "internal_error",
}

/**
 * Structured error information.
 */
export interface ToolError {
    /** Error type/category */
    type: string;
    /** Human-readable message */
    message: string;
    /** Whether error is retryable */
    retryable?: boolean;
    /** Error code (for programmatic handling) */
    code?: string;
    /** Additional error details */
    details?: Record<string, unknown>;
}

/**
 * Recommended next step.
 */
export interface NextStep {
    toolName: string;
    description: string;
    prefilledParams?: Record<string, any>;
    confidence?: number;
}

/**
 * Tool execution result.
 */
export interface ToolResult<TResult = any> {
    /** Execution status */
    status: ToolStatus;
    /** Result data (on success/partial success) */
    result?: TResult;
    /** Error information (on error) */
    error?: ToolError;
    /** Warnings (even on success) */
    warnings?: string[];
    /** Metadata (workflow hints, next steps, etc.) */
    metadata?: {
        nextSteps?: NextStep[];
        [key: string]: unknown;
    };
}

/**
 * Alias for backward compatibility.
 */
export type ToolCallResult<TResult = any> = ToolResult<TResult>;

/**
 * Extract TypeScript type from Koishi Schema.
 * This is a best-effort type extraction utility.
 */
export type InferSchemaType<T> = T extends Schema<infer U> ? U : never;
