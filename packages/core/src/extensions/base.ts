import { readdirSync } from "fs";
import { Context, Session } from "koishi";
import path from "path";
import { ToolResult } from "xsai";
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

/**
 * LLM 上下文对象
 * 用于传递 Koishi 上下文和会话对象
 */
export interface ToolContext {
    ctx?: Context;       // Koishi 上下文对象
    session?: Session;   // Koishi 会话对象
    [key: string]: any;  // 允许扩展上下文
}

/**
 * 工具定义
 * 用于定义工具的名称、描述、参数和执行函数
 */
export type ToolDefinition<
    TParams extends z.ZodTypeAny = any,
    TReturns extends z.ZodTypeAny = any
> = {
    name: string;
    description: string;
    parameters: TParams;
    execute: (params: z.infer<TParams>, context: ToolContext) => Promise<ToolCallResult<z.infer<TReturns>>> | ToolCallResult<z.infer<TReturns>>;
};

export interface ToolCallResult<T = any> {
    success: boolean;
    result?: T;
    error?: string;
}

interface EnhancedToolResult<T extends z.ZodTypeAny = any> extends ToolResult {
    execute: (params: z.infer<T>, context: ToolContext) => Promise<ToolCallResult<z.infer<T>>> | ToolCallResult<z.infer<T>>;
}

export function Tool<T extends z.ZodTypeAny>(definition: ToolDefinition<T>): ToolDefinition<T> {
    return definition;
}

export function Success(result?: any): ToolCallResult {
    return {
        success: true,
        result: result,
    };
}

export function Failed(error: string): ToolCallResult {
    return {
        success: false,
        error: error,
    };
}

/**
 * 定义工具
 * @param definition
 * @returns
 */
export function defineTool<T extends z.ZodTypeAny>(definition: ToolDefinition<T>, TContext: ToolContext = {}): EnhancedToolResult<T> {
    let parameters: any = definition.parameters;
    if (!definition.parameters["properties"]) {
        parameters = zodToJsonSchema(definition.parameters);
    }
    return {
        type: "function",
        execute: (params: z.infer<T>, context = TContext) => definition.execute(params, context),
        function: {
            name: definition.name,
            description: definition.description,
            parameters: parameters as Record<string, unknown>,
        }
    };
}

export class ToolManager {
    static instance: ToolManager;
    static getInstance(): ToolManager {
        if (!ToolManager.instance) {
            ToolManager.instance = new ToolManager();
        }
        return ToolManager.instance;
    }

    private loaded = false;
    private tools: Map<string, ToolDefinition> = new Map();

    constructor() { }

    loadExtensions(logger: Context["logger"]) {
        if (this.loaded) return;
        const extensionsDir = path.join(__dirname, "builtin");

        readdirSync(extensionsDir)
            .filter(file =>
                file.startsWith("ext_") &&
                !file.endsWith(".d.ts")
            )
            .forEach(file => {
                try {
                    const extension = require(path.join(extensionsDir, file)) as Record<string, ToolDefinition> | { default: ToolDefinition | ToolDefinition[] };

                    if (extension.default) {
                        if (Array.isArray(extension.default)) {
                            extension.default.forEach(tool => this.registerTool(tool));
                        } else {
                            this.registerTool(extension.default);
                        }
                    } else {
                        Object.entries(extension as Record<string, ToolDefinition>)
                            .filter(([key]) => key !== 'default')
                            .forEach(([key, tool]) => {
                                this.registerTool(tool);
                            });
                    }
                    logger.info(`[Extension] Loaded: ${file}`);
                } catch (error) {
                    logger.error(`[Extension] Failed to load: ${file}`);
                    logger.error(error.stack);
                }
            });

        this.loaded = true;
    }

    registerTool(definition: ToolDefinition) {
        this.tools.set(definition.name, definition);
    }

    removeTool(name: string) {
        this.tools.delete(name);
    }

    getTool(name: string, context: ToolContext = {}): EnhancedToolResult | undefined {
        if (!this.tools.has(name)) {
            return undefined;
        }
        return defineTool(this.tools.get(name), context);
    }

    getTools(context: ToolContext = {}): EnhancedToolResult[] {
        let tools: EnhancedToolResult[] = [];
        for (const [name, definition] of this.tools) {
            tools.push(defineTool(definition, context));
        }
        return tools;
    }

    /**
     * 获取工具的描述
     * @param name
     * @example
     * send_message:
     *   description: Sends a message to the human user.
     *   params:
     *     inner_thoughts: Deep inner monologue private to you only.
     *     messages: Array<string> Max(2) Message contents. Each item in the list will be sent individually to mimic human sentence breaking behavior.
     */
    getToolPrompt(name: string): string {
        if (!this.tools.has(name)) {
            return "";
        }
        const tool = this.tools.get(name);
        const stringify = (properties: Record<string, { type: string, description: string }>) => {
            let result = [];
            for (const [key, value] of Object.entries(properties)) {
                result.push(`    ${key}: ${value.description}`);
            }
            return result.join("\n");
        }
        if (!tool.parameters["properties"]) {
            tool.parameters = zodToJsonSchema(tool.parameters);
        }
        return [
            `${name}:`,
            `  description: ${tool.description}`,
            `  params:`,
            stringify(tool.parameters["properties"]) || "    No parameters required."
        ].join("\n");
    }

    getToolPrompts(): string {
        let prompts: string[] = [];
        for (const [name, definition] of this.tools) {
            prompts.push(this.getToolPrompt(name));
        }
        return prompts.join("\n");
    }
}

export const INNER_THOUGHTS = z.string().describe("Deep inner monologue private to you only.");
export const REQUEST_HEARTBEAT = z.boolean().optional().describe("Request an immediate heartbeat after function execution. Set to `true` if you want to send a follow-up message or run a follow-up function.");
