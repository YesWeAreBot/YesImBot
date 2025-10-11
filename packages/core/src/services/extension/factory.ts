import { Context } from "koishi";

import { ExtensionMetadata, IExtension, ToolDefinition } from "./types";

export interface CreateExtensionOptions<TConfig = any> {
    config?: TConfig;
    tools?: ToolDefinition<TConfig, any>[];
}

export function createExtension<TConfig = any>(
    ctx: Context,
    metadata: ExtensionMetadata<TConfig>,
    options: CreateExtensionOptions<TConfig> = {}
): IExtension<TConfig> {
    const { config, tools = [] } = options;

    const toolMap = new Map<string, ToolDefinition<TConfig, any>>();
    for (const tool of tools) {
        const bounded = {
            ...tool,
            extensionName: metadata.name,
        } as ToolDefinition<TConfig, any>;
        toolMap.set(bounded.name, bounded);
    }

    return {
        ctx,
        config: config ?? ({} as TConfig),
        metadata,
        tools: toolMap,
    };
}
