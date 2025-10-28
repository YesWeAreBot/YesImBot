// ============================================================================
// PLUGIN BASE CLASS
// ============================================================================

import { Services } from "@/shared/constants";
import { Context, Schema } from "koishi";
import { ActionDefinition, ActionDescriptor, PluginMetadata, ToolContext, ToolDefinition, ToolDescriptor, ToolResult } from "./types";

/**
 * Base class for all extensions.
 * Extends Koishi's plugin system with tool registration capabilities.
 */
export abstract class Plugin<TConfig extends Record<string, any> = {}> {
    static inject: string[] | { required: string[]; optional?: string[] } = [Services.Tool];
    static Config: Schema<any>;
    static metadata: PluginMetadata;

    /** Extension metadata */
    get metadata(): PluginMetadata {
        return (this.constructor as typeof Plugin).metadata;
    }

    /** Registered tools */
    protected tools = new Map<string, ToolDefinition<TConfig, any>>();

    protected actions = new Map<string, ActionDefinition<TConfig, any>>();

    constructor(
        public ctx: Context,
        public config: TConfig
    ) {
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

        // Auto-register tools on ready
        const toolService = ctx[Services.Tool];
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
        descriptorOrTool: ToolDescriptor<TConfig, TParams> | { descriptor: ToolDescriptor<TConfig, TParams>; execute: Function },
        execute?: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>
    ): this {
        let descriptor: ToolDescriptor<TConfig, TParams>;
        let executeFn: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>;

        // Support both patterns: addTool(descriptor, execute) and addTool({ descriptor, execute })
        if ("descriptor" in descriptorOrTool && "execute" in descriptorOrTool) {
            descriptor = descriptorOrTool.descriptor;
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
        this.tools.set(name, definition);
        return this;
    }

    addAction<TParams = any, TResult = any>(
        descriptorOrTool: ActionDescriptor<TConfig, TParams> | { descriptor: ActionDescriptor<TConfig, TParams>; execute: Function },
        execute?: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>
    ): this {
        let descriptor: ActionDescriptor<TConfig, TParams>;
        let executeFn: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>;

        // Support both patterns: addTool(descriptor, execute) and addTool({ descriptor, execute })
        if ("descriptor" in descriptorOrTool && "execute" in descriptorOrTool) {
            descriptor = descriptorOrTool.descriptor;
            executeFn = descriptorOrTool.execute as any;
        } else {
            descriptor = descriptorOrTool;
            executeFn = execute!;
        }

        const name = descriptor.name || `action_${this.tools.size}`;
        const definition: ActionDefinition<TConfig, TParams, TResult> = {
            ...descriptor,
            name,
            execute: executeFn,
            extensionName: this.metadata.name,
        };
        this.actions.set(name, definition);
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
