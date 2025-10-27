// ============================================================================
// DECORATORS AND FACTORY FUNCTIONS
// ============================================================================

import { ExtensionMetadata, ToolDescriptor, ActionDescriptor, ToolDefinition, ToolType, ToolContext, ToolResult } from "./types";

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
export function Metadata(metadata: ExtensionMetadata): ClassDecorator {
    return <T extends new (...args: any[]) => any>(TargetClass: T) => {
        // Simply attach metadata to the class
        (TargetClass as any).metadata = metadata;
        return TargetClass;
    };
}

/**
 * @Tool decorator - marks a method as a tool (information retrieval).
 */
export function Tool<TParams>(descriptor: Omit<ToolDescriptor<any, TParams>, "type">) {
    return function (
        target: any,
        propertyKey: string,
        methodDescriptor: TypedPropertyDescriptor<(params: TParams, context: ToolContext) => Promise<any>>
    ) {
        if (!methodDescriptor.value) return;

        target.tools ??= new Map<string, ToolDefinition>();

        const toolDefinition: ToolDefinition<any, TParams> = {
            ...descriptor,
            name: descriptor.name || propertyKey,
            type: ToolType.Tool,
            execute: methodDescriptor.value,
            extensionName: "", // Will be set during registration
        };

        target.tools.set(toolDefinition.name, toolDefinition);
    };
}

/**
 * @Action decorator - marks a method as an action (concrete operation).
 */
export function Action<TParams>(descriptor: Omit<ActionDescriptor<any, TParams>, "type">) {
    return function (
        target: any,
        propertyKey: string,
        methodDescriptor: TypedPropertyDescriptor<(params: TParams, context: ToolContext) => Promise<any>>
    ) {
        if (!methodDescriptor.value) return;

        target.tools ??= new Map<string, ToolDefinition>();

        const actionDefinition: ToolDefinition<any, TParams> = {
            ...descriptor,
            name: descriptor.name || propertyKey,
            type: ToolType.Action,
            execute: methodDescriptor.value,
            extensionName: "", // Will be set during registration
        };

        target.tools.set(actionDefinition.name, actionDefinition);
    };
}

/**
 * Create a typed tool with automatic parameter inference.
 * RECOMMENDED for programmatic/dynamic tool registration.
 */
export function defineTool<TParams>(
    descriptor: Omit<ToolDescriptor<any, TParams>, "type">,
    execute: (params: TParams, context: ToolContext) => Promise<ToolResult>
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
    execute: (params: TParams, context: ToolContext) => Promise<ToolResult>
) {
    return {
        descriptor: { ...descriptor, type: ToolType.Action } as ActionDescriptor<any, TParams>,
        execute,
    };
}
