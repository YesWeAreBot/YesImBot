import type { ActionDefinition, ActionDescriptor, PluginMetadata, ToolDefinition, ToolDescriptor, ToolResult } from "./types";
import type { HookDescriptor, HookHandler, HookType } from "./types";
import type { ToolContext } from "@/services/context/types";
import { Schema } from "koishi";
import { ToolType } from "./types";

type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * @Metadata decorator - attaches metadata to an extension class.
 * Alternative to defining static metadata property.
 *
 * Usage:
 * @Metadata({
 *     name: "my-extension",
 *     display: "My Extension",
 *     description: "Extension description",
 * })
 * export default class MyExtension extends Plugin {
 *     static readonly Config = Schema.object({ });
 * }
 */
export function Metadata(metadata: PluginMetadata): ClassDecorator {
    // @ts-expect-error type checking
    return <T extends Constructor>(TargetClass: T) => {
        // Simply attach metadata to the class
        (TargetClass as any).metadata = metadata;
        return TargetClass as unknown as T;
    };
}

/**
 * @Tool decorator - marks a method as a tool (information retrieval).
 */
export function Tool<TParams>(descriptor: Omit<ToolDescriptor<any, TParams>, "type">) {
    return function (
        target: any,
        propertyKey: string,
        methodDescriptor: TypedPropertyDescriptor<(params: TParams, context: ToolContext) => Promise<any>>,
    ) {
        if (!methodDescriptor.value)
            return;

        target.staticTools ??= [];

        const toolDefinition: ToolDefinition<any, TParams> = {
            ...descriptor,
            name: descriptor.name || propertyKey,
            type: ToolType.Tool,
            execute: methodDescriptor.value,
            extensionName: "", // Will be set during registration
        };

        (target.staticTools as ToolDefinition[]).push(toolDefinition);
    };
}

/**
 * @Action decorator - marks a method as an action (concrete operation).
 */
export function Action<TParams>(descriptor: Omit<ActionDescriptor<any, TParams>, "type">) {
    return function (
        target: any,
        propertyKey: string,
        methodDescriptor: TypedPropertyDescriptor<(params: TParams, context: ToolContext) => Promise<any>>,
    ) {
        if (!methodDescriptor.value)
            return;

        target.staticActions ??= [];

        const actionDefinition: ActionDefinition<any, TParams> = {
            ...descriptor,
            name: descriptor.name || propertyKey,
            type: ToolType.Action,
            execute: methodDescriptor.value,
            extensionName: "", // Will be set during registration
        };

        (target.staticActions as ActionDefinition[]).push(actionDefinition);
    };
}

/**
 * Create a typed tool with automatic parameter inference.
 * RECOMMENDED for programmatic/dynamic tool registration.
 */
export function defineTool<TParams>(
    descriptor: Omit<ToolDescriptor<any, TParams>, "type">,
    execute: (params: TParams, context: ToolContext) => Promise<ToolResult>,
) {
    return {
        descriptor: { ...descriptor, type: ToolType.Tool } as ToolDescriptor<any, TParams>,
        execute,
    };
}

/**
 * Create a typed action with automatic parameter inference.
 * RECOMMENDED for programmatic/dynamic action registration.
 */
export function defineAction<TParams>(
    descriptor: Omit<ActionDescriptor<any, TParams>, "type">,
    execute: (params: TParams, context: ToolContext) => Promise<ToolResult>,
) {
    return {
        descriptor: { ...descriptor, type: ToolType.Action } as ActionDescriptor<any, TParams>,
        execute,
    };
}

/**
 * @Hook decorator - marks a method as a lifecycle hook handler.
 *
 * Usage:
 * @Hook({ type: HookType.BeforePromptBuild, priority: 10 })
 * async onBeforePromptBuild(context: BeforePromptBuildContext) {
 *     // Modify context.worldState
 *     context.worldState.history.push(...);
 * }
 */
export function Hook<T extends HookType>(descriptor: HookDescriptor<T>) {
    return function (
        target: any,
        propertyKey: string,
        methodDescriptor: TypedPropertyDescriptor<HookHandler<T, any>>,
    ) {
        if (!methodDescriptor.value)
            return;

        target.staticHooks ??= [];

        const hookDefinition = {
            type: descriptor.type,
            priority: descriptor.priority ?? 5,
            handler: methodDescriptor.value,
            pluginName: "", // Will be set during registration
        };

        (target.staticHooks as any[]).push(hookDefinition);
    };
}

/**
 * Create a typed hook with automatic type inference.
 * RECOMMENDED for programmatic/dynamic hook registration.
 *
 * Usage:
 * const myHook = defineHook(
 *     { type: HookType.BeforePromptBuild, priority: 10 },
 *     async (context) => {
 *         // TypeScript infers context type from HookType
 *         context.worldState.history.push(...);
 *     }
 * );
 */
export function defineHook<T extends HookType>(
    descriptor: HookDescriptor<T>,
    handler: HookHandler<T, any>,
) {
    return {
        descriptor,
        handler,
    };
}

export function withInnerThoughts(params: { [T: string]: Schema<any> }): Schema<any> {
    return Schema.object({
        inner_thoughts: Schema.string().description("Deep inner monologue private to you only."),
        ...params,
    });
}
