// ============================================================================
// PLUGIN BASE CLASS
// ============================================================================

import { Services } from "@/shared/constants";
import { Context, Logger, Schema } from "koishi";
import { ActionDefinition, ActionDescriptor, PluginMetadata, ToolContext, ToolDefinition, ToolDescriptor, ToolResult } from "./types";

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

    /** Extension metadata */
    get metadata(): PluginMetadata {
        return (this.constructor as typeof Plugin).metadata;
    }

    /** Registered tools */
    protected tools = new Map<string, ToolDefinition<TConfig, any>>();

    protected actions = new Map<string, ActionDefinition<TConfig, any>>();

    public logger: Logger;

    constructor(
        public ctx: Context,
        public config: TConfig
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
        execute?: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>
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
        execute?: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>
    ): this {
        let descriptor: ActionDescriptor<TConfig, TParams>;
        let executeFn: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>;

        // Support both patterns: addTool(descriptor, execute) and addTool({ descriptor, execute })
        descriptor = descriptorOrTool;
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
}
