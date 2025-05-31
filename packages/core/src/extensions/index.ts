import { Context, Service } from "koishi";
import path from "path";

import { getExtensionFiles } from "../utils";
import { ToolDefinition, ToolContext, ExecutableTool, defineTool } from "./base";
import zodToJsonSchema from "zod-to-json-schema";

// 声明模块，将 ToolManager 服务添加到 Koishi 的 Context 类型中
declare module "koishi" {
    interface Context {
        toolManager: ToolManager;
    }
}

/**
 * 工具管理器
 * 负责加载、注册、管理和获取工具
 */
export default class ToolManager extends Service {
    // 服务名称，Koishi 会根据这个名称注入到 Context 中

    private loaded = false;
    private tools: Map<string, ToolDefinition> = new Map();

    constructor(ctx: Context) {
        super(ctx, "toolManager", true);

        ctx.logger.info("ToolManager Launched")

        /**
         * 服务启动时加载扩展
         */
        ctx.on("ready", async () => {
            if (this.loaded) return;

            const extensions = getExtensionFiles(this.ctx);

            for (const file of extensions) {
                try {
                    // 清除 require 缓存，确保每次加载都是最新版本 (在开发模式下有用)
                    delete require.cache[require.resolve(file)];
                    const extension = require(file) as Record<string, ToolDefinition> | { default: ToolDefinition | ToolDefinition[] };

                    if (extension.default) {
                        if (Array.isArray(extension.default)) {
                            extension.default.forEach((tool) => this.registerTool(tool));
                        } else {
                            this.registerTool(extension.default);
                        }
                    } else {
                        Object.entries(extension as Record<string, ToolDefinition>)
                            .filter(([key]) => key !== "default")
                            .forEach(([, tool]) => {
                                // 解构时忽略 key
                                this.registerTool(tool);
                            });
                    }
                    this.ctx.logger.info(`[Extension] Loaded: ${path.basename(file)}`);
                } catch (error: any) {
                    // 捕获具体的 error 类型
                    this.ctx.logger.error(`[Extension] Failed to load: ${file}`);
                    this.ctx.logger.error(error.stack || error.message); // 确保输出错误信息
                }
            }

            this.loaded = true;
            this.ctx.logger.info(`[ToolManager] All tools loaded.`);
        });
    }

    /**
     * 注册一个工具定义
     * @param definition 工具定义
     */
    public registerTool(definition: ToolDefinition) {
        if (this.tools.has(definition.name)) {
            this.ctx.logger.warn(`[ToolManager] Tool "${definition.name}" is already registered. Overwriting.`);
        }
        this.tools.set(definition.name, definition);
    }

    /**
     * 移除一个工具
     * @param name 工具名称
     */
    public removeTool(name: string) {
        if (!this.tools.delete(name)) {
            this.ctx.logger.warn(`[ToolManager] Attempted to remove non-existent tool: "${name}".`);
        }
    }

    /**
     * 获取指定名称的可执行工具
     * @param name 工具名称
     * @param context 运行时上下文，将与工具定义时的基础上下文合并
     * @returns 可执行工具或 undefined
     */
    public getTool(name: string, context: ToolContext = {}): ExecutableTool | undefined {
        const definition = this.tools.get(name);
        if (!definition) {
            return undefined;
        }
        return defineTool(definition, context);
    }

    /**
     * 获取所有可执行工具
     * @param context 运行时上下文，将与工具定义时的基础上下文合并
     * @returns 可执行工具数组
     */
    public getTools(context: ToolContext = {}): ExecutableTool[] {
        const tools: ExecutableTool[] = [];
        for (const definition of this.tools.values()) {
            // 直接迭代 Map 的值
            tools.push(defineTool(definition, context));
        }
        return tools;
    }

    /**
     * 获取单个工具的 Prompt 描述字符串
     * @param name 工具名称
     * @returns 工具的 Prompt 描述
     */
    public getToolPrompt(name: string): string {
        const tool = this.tools.get(name);
        if (!tool) {
            return "";
        }

        const jsonSchema = zodToJsonSchema(tool.parameters);
        const properties = (jsonSchema['properties'] as Record<string, any>) || {}; // 确保 properties 是一个对象

        const stringifyProperties = (props: Record<string, any>): string => {
            const result: string[] = [];
            for (const [key, value] of Object.entries(props)) {
                // 确保 value 是一个对象且有 description
                if (typeof value === "object" && value !== null && "description" in value && typeof value.description === "string") {
                    result.push(`    ${key}: ${value.description}`);
                } else {
                    // 如果没有 description 或类型不符，也提供一个默认信息
                    result.push(`    ${key}: (No description provided or complex type)`);
                }
            }
            return result.join("\n");
        };

        const paramsString = stringifyProperties(properties);

        return [
            `${tool.name}:`,
            `  description: ${tool.description}`,
            `  params:`,
            paramsString || "    No parameters required.", // 如果没有参数，显示默认信息
        ].join("\n");
    }

    /**
     * 获取所有工具的 Prompt 描述字符串
     * @returns 所有工具的 Prompt 描述，以换行符分隔
     */
    public getToolPrompts(): string {
        const prompts: string[] = [];
        for (const name of this.tools.keys()) {
            prompts.push(this.getToolPrompt(name));
        }
        return prompts.join("\n");
    }
}
