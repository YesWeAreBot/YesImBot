// ============================================================================
// EXTENSION TYPES
// ============================================================================

import { Context } from "koishi";
import { ToolDefinition } from "./tool";

/**
 * Extension metadata.
 */
export interface ExtensionMetadata {
    name: string;
    display?: string;
    description: string;
    version?: string;
    author?: string;
    builtin?: boolean;
}

/**
 * Extension interface.
 */
export interface IExtension<TConfig = any> {
    ctx: Context;
    config: TConfig;
    metadata: ExtensionMetadata;
    tools: Map<string, ToolDefinition>;
}
