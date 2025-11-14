import type { Context, Logger, Schema } from "koishi";
import type { ActionDefinition, ActionDescriptor, PluginMetadata, ToolContext, ToolDefinition, ToolDescriptor, ToolResult } from "./types";
import type {
    AfterHeartbeatContext,
    BeforeModelInvokeContext,
    BeforePromptBuildContext,
    BeforeToolExecutionContext,
    HookDefinition,
    HookDescriptor,
    HookHandler,
} from "./types";
import { Services } from "@/shared/constants";
import { HookType } from "./types";

/**
 * Base class for all extensions.
 * Extends Koishi's plugin system with tool registration capabilities.
 */
export abstract class Plugin<TConfig extends Record<string, any> = {}> {
    static inject: string[] | { required: string[]; optional?: string[] } = [Services.Plugin];
    static Config: Schema<any>;
    static metadata: PluginMetadata;
    static staticTools: ToolDefinition[];
    static staticActions: ActionDefinition[];
    static staticHooks: HookDefinition[];

    /** Extension metadata */
    get metadata(): PluginMetadata {
        return (this.constructor as typeof Plugin).metadata;
    }

    /** Registered tools */
    protected tools = new Map<string, ToolDefinition<TConfig, any>>();

    protected actions = new Map<string, ActionDefinition<TConfig, any>>();

    /** Registered hooks */
    protected hooks = new Map<HookType, HookDefinition<any, TConfig>[]>();

    public logger: Logger;

    constructor(
        public ctx: Context,
        public config: TConfig,
    ) {
        this.logger = ctx.logger(`plugin:${this.metadata.name}`);
        // Merge parent inject dependencies
        const childClass = this.constructor as typeof Plugin;
        const parentClass = Object.getPrototypeOf(childClass);

        if (parentClass && parentClass.inject && childClass.inject) {
            if (Array.isArray(childClass.inject)) {
                childClass.inject = [...new Set([...parentClass.inject, ...childClass.inject])];
            } else if (typeof childClass.inject === "object") {
                const parentRequired = Array.isArray(parentClass.inject) ? parentClass.inject : parentClass.inject.required || [];
                const childRequired = childClass.inject.required || [];
                const childOptional = childClass.inject.optional || [];

                childClass.inject = {
                    required: [...new Set([...parentRequired, ...childRequired])],
                    optional: childOptional,
                };
            }
        }

        for (const tool of (childClass.prototype as any).staticTools || []) {
            this.addTool(tool);
        }

        for (const action of (childClass.prototype as any).staticActions || []) {
            this.addAction(action);
        }

        for (const hook of (childClass.prototype as any).staticHooks || []) {
            this.registerHook(hook.type, hook.handler, hook.priority);
        }

        // Auto-register lifecycle methods as hooks
        if (this.onBeforePromptBuild) {
            this.registerHook(HookType.BeforePromptBuild, this.onBeforePromptBuild.bind(this));
        }
        if (this.onBeforeModelInvoke) {
            this.registerHook(HookType.BeforeModelInvoke, this.onBeforeModelInvoke.bind(this));
        }
        if (this.onBeforeToolExecution) {
            this.registerHook(HookType.BeforeToolExecution, this.onBeforeToolExecution.bind(this));
        }
        if (this.onAfterHeartbeat) {
            this.registerHook(HookType.AfterHeartbeat, this.onAfterHeartbeat.bind(this));
        }

        // Auto-register tools on ready
        const toolService = ctx[Services.Plugin];
        if (toolService) {
            ctx.on("ready", () => {
                const enabled = !Object.hasOwn(config, "enabled") || config.enabled;
                toolService.register(this, enabled, config);
            });
        }
    }

    /**
     * Programmatically add a tool to this extension.
     * Supports both descriptor+execute and unified tool object.
     */
    addTool<TParams = any, TResult = any>(
        descriptorOrTool: ToolDescriptor<TConfig, TParams>,
        execute?: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>,
    ): this {
        let descriptor: ToolDescriptor<TConfig, TParams>;
        let executeFn: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>;

        descriptor = descriptorOrTool;
        // Support both patterns: addTool(descriptor, execute) and addTool({ descriptor, execute })
        if ("execute" in descriptorOrTool) {
            executeFn = descriptorOrTool.execute as any;
        } else {
            descriptor = descriptorOrTool;
            executeFn = execute!;
        }

        const name = descriptor.name || `tool_${this.tools.size}`;
        const definition: ToolDefinition<TConfig, TParams, TResult> = {
            ...descriptor,
            name,
            execute: executeFn,
            extensionName: this.metadata.name,
        };
        this.logger.debug(`  -> 注册工具: "${name}"`);
        this.tools.set(name, definition);
        const pluginService = this.ctx[Services.Plugin];
        if (pluginService) {
            pluginService.getToolsMap().set(name, definition);
        }
        return this;
    }

    addAction<TParams = any, TResult = any>(
        descriptorOrTool: ActionDescriptor<TConfig, TParams>,
        execute?: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>,
    ): this {
        let executeFn: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>;

        // Support both patterns: addTool(descriptor, execute) and addTool({ descriptor, execute })
        const descriptor = descriptorOrTool;
        if ("execute" in descriptorOrTool) {
            executeFn = descriptorOrTool.execute as any;
        } else {
            executeFn = execute!;
        }

        const name = descriptor.name || `action_${this.tools.size}`;
        const definition: ActionDefinition<TConfig, TParams, TResult> = {
            ...descriptor,
            name,
            execute: executeFn,
            extensionName: this.metadata.name,
        };
        this.logger.debug(`  -> 注册动作: "${name}"`);
        this.actions.set(name, definition);
        const pluginService = this.ctx[Services.Plugin];
        if (pluginService) {
            pluginService.getToolsMap().set(name, definition);
        }
        return this;
    }

    /**
     * Get all tools registered to this extension.
     */
    getTools(): Map<string, ToolDefinition<TConfig, any>> {
        return this.tools;
    }

    /**
     * Get all actions registered to this extension.
     */
    getActions(): Map<string, ActionDefinition<TConfig, any>> {
        return this.actions;
    }

    /**
     * Programmatically register a hook handler.
     * Supports both descriptor+handler and unified hook object.
     */
    registerHook<T extends HookType>(typeOrDescriptor: T | HookDescriptor<T>, handler?: HookHandler<T, TConfig>, priority?: number): this {
        let hookType: T;
        let hookHandler: HookHandler<T, TConfig>;
        let hookPriority: number;

        // Support both patterns: registerHook(type, handler, priority) and registerHook({ descriptor, handler })
        if (typeof typeOrDescriptor === "object" && "type" in typeOrDescriptor) {
            const hookObj = typeOrDescriptor as any;
            hookType = hookObj.type || hookObj.descriptor?.type;
            hookHandler = hookObj.handler || handler!;
            hookPriority = hookObj.priority ?? hookObj.descriptor?.priority ?? 5;
        } else {
            hookType = typeOrDescriptor as T;
            hookHandler = handler!;
            hookPriority = priority ?? 5;
        }

        const definition: HookDefinition<T, TConfig> = {
            type: hookType,
            handler: hookHandler,
            priority: hookPriority,
            pluginName: this.metadata.name,
        };

        if (!this.hooks.has(hookType)) {
            this.hooks.set(hookType, []);
        }
        this.hooks.get(hookType)!.push(definition as any);

        this.logger.debug(`  -> 注册 Hook: ${hookType} (优先级: ${hookPriority})`);

        // Also register with PluginService
        const pluginService = this.ctx[Services.Plugin];
        if (pluginService) {
            pluginService.registerHook(definition);
        }

        return this;
    }

    /**
     * Get all hooks of a specific type.
     */
    getHooks<T extends HookType>(type: T): HookDefinition<T, TConfig>[] {
        return (this.hooks.get(type) || []) as HookDefinition<T, TConfig>[];
    }

    /**
     * Get all hooks registered to this plugin.
     */
    getAllHooks(): Map<HookType, HookDefinition<any, TConfig>[]> {
        return this.hooks;
    }

    // ============================================================================
    // Lifecycle Hook Methods (可选重载)
    // ============================================================================

    /**
     * Override this method to handle BeforePromptBuild hook.
     * Called after WorldState construction, before prompt generation.
     */
    protected async onBeforePromptBuild?(
        context: BeforePromptBuildContext<TConfig>,
    ): Promise<void | Partial<BeforePromptBuildContext<TConfig>>>;

    /**
     * Override this method to handle BeforeModelInvoke hook.
     * Called after prompt generation, before LLM invocation.
     */
    protected async onBeforeModelInvoke?(
        context: BeforeModelInvokeContext<TConfig>,
    ): Promise<void | Partial<BeforeModelInvokeContext<TConfig>>>;

    /**
     * Override this method to handle BeforeToolExecution hook.
     * Called after LLM response, before tool execution.
     */
    protected async onBeforeToolExecution?(
        context: BeforeToolExecutionContext<TConfig>,
    ): Promise<void | Partial<BeforeToolExecutionContext<TConfig>>>;

    /**
     * Override this method to handle AfterHeartbeat hook.
     * Called after the entire heartbeat cycle completes.
     */
    protected async onAfterHeartbeat?(context: AfterHeartbeatContext<TConfig>): Promise<void | Partial<AfterHeartbeatContext<TConfig>>>;
}
