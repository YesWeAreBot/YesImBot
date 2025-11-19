import type { ToolContext } from "./context";
import type { AnyPercept, AnyWorldState } from "@/services/world/types";

/**
 * Plugin lifecycle hook types.
 * Hooks allow plugins to intercept and modify data at different stages of the agent's processing pipeline.
 */
export enum HookType {
    /**
     * Before prompt building - after WorldState construction, before prompt generation.
     * Use case: Inject long-term memories, modify context, add custom data.
     */
    BeforePromptBuild = "before-prompt-build",

    /**
     * Before model invocation - after prompt generation, before LLM call.
     * Use case: Modify prompt, add system instructions, log prompts.
     */
    BeforeModelInvoke = "before-model-invoke",

    /**
     * Before tool execution - after LLM response, before tool execution.
     * Use case: Validate tool calls, modify parameters, add authorization checks.
     */
    BeforeToolExecution = "before-tool-execution",

    /**
     * After heartbeat - after the entire heartbeat cycle completes.
     * Use case: Cleanup, logging, metrics collection, post-processing.
     */
    AfterHeartbeat = "after-heartbeat",
}

/**
 * Base context available in all hooks.
 */
export interface BaseHookContext<TConfig = any> {
    /** The percept that triggered this processing cycle */
    percept: AnyPercept;
    /** The constructed world state */
    worldState: AnyWorldState;
    /** Tool context for capability access */
    toolContext: ToolContext;
    /** Plugin configuration */
    config: TConfig;
}

/**
 * Context for BeforePromptBuild hook.
 * Allows modification of WorldState before prompt generation.
 */
export interface BeforePromptBuildContext<TConfig = any> extends BaseHookContext<TConfig> {
    /** Mutable world state that can be modified */
    worldState: AnyWorldState;
}

/**
 * Context for BeforeModelInvoke hook.
 * Allows modification of the prompt before LLM invocation.
 */
export interface BeforeModelInvokeContext<TConfig = any> extends BaseHookContext<TConfig> {
    /** The generated prompt (can be modified) */
    prompt: {
        system: string;
        user: string;
        /** Available tools for this invocation */
        tools: any[];
    };
}

/**
 * Context for BeforeToolExecution hook.
 * Allows validation and modification of tool calls before execution.
 */
export interface BeforeToolExecutionContext<TConfig = any> extends BaseHookContext<TConfig> {
    /** The LLM's response */
    modelResponse: {
        /** Text content from the model */
        content?: string;
        /** Tool calls requested by the model */
        toolCalls: Array<{
            id: string;
            name: string;
            parameters: any;
        }>;
    };
}

/**
 * Context for AfterHeartbeat hook.
 * Provides access to the complete execution results.
 */
export interface AfterHeartbeatContext<TConfig = any> extends BaseHookContext<TConfig> {
    /** Results of tool executions */
    executionResults?: Array<{
        toolName: string;
        success: boolean;
        result?: any;
        error?: any;
    }>;
    /** Whether the heartbeat will continue */
    willContinue: boolean;
}

/**
 * Map hook types to their context types.
 */
export interface HookContextMap<TConfig = any> {
    [HookType.BeforePromptBuild]: BeforePromptBuildContext<TConfig>;
    [HookType.BeforeModelInvoke]: BeforeModelInvokeContext<TConfig>;
    [HookType.BeforeToolExecution]: BeforeToolExecutionContext<TConfig>;
    [HookType.AfterHeartbeat]: AfterHeartbeatContext<TConfig>;
}

/**
 * Hook handler function signature.
 * Can return void (no modification) or the modified context.
 */
export type HookHandler<T extends HookType, TConfig = any> = (context: HookContextMap<TConfig>[T]) => Promise<void | Partial<HookContextMap<TConfig>[T]>>;

/**
 * Hook definition with metadata.
 */
export interface HookDefinition<T extends HookType = HookType, TConfig = any> {
    /** Hook type */
    type: T;
    /** Hook handler function */
    handler: HookHandler<T, TConfig>;
    /** Priority (higher = executed earlier) */
    priority?: number;
    /** Plugin name that registered this hook */
    pluginName: string;
}

/**
 * Type-safe hook registration descriptor.
 */
export interface HookDescriptor<T extends HookType = HookType> {
    /** Hook type */
    type: T;
    /** Priority (higher = executed earlier) */
    priority?: number;
}
