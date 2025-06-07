import { Context, Service } from "koishi";
import path from "path";
import { z } from "zod";
import { createExtension, createToolError, defineExecutableTool, isValidExtension, isValidTool, validateToolParameters } from "./helpers";
import {
    ExecutableTool,
    ExtensionConstructor,
    ExtensionDefinition,
    ToolCallResult,
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolErrorType,
    ToolManagerConfig,
    ToolRegistrationOptions,
} from "./types";
import { getExtensionFiles } from "./utils";

declare module "koishi" {
    interface Context {
        "yesimbot.tool": ToolManager;
    }
    interface Config {
        extensions?: Record<string, any>;
    }
}

export class ToolManager extends Service {
    private loaded = false;
    private fileWatchers = new Map<string, any>();

    // --- 原 Registry 的属性 ---
    private tools = new Map<string, ToolDefinition<any, any, any>>();
    private extensions = new Map<string, ExtensionDefinition<any>>();
    private toolToExtension = new Map<string, string>();
    private categories = new Map<string, Set<string>>();
    private extensionConfigs = new Map<string, any>();

    constructor(ctx: Context, public config: ToolManagerConfig = {}) {
        super(ctx, "yesimbot.tool", true);

        ctx.on("ready", async () => {
            if (this.config?.autoLoad) await this.loadExtensions();
        });
        ctx.on("dispose", () => this.cleanup());
    }

    // --- 扩展加载逻辑 ---

    async loadExtensions(): Promise<void> {
        if (this.loaded) {
            this.ctx.logger.warn("扩展已加载，如需重载请调用 reloadExtensions()");
            return;
        }
        const extensionFiles = getExtensionFiles(this.ctx);
        this.ctx.logger.info(`发现 ${extensionFiles.length} 个扩展文件，开始加载...`);
        for (const filePath of extensionFiles) {
            await this.loadExtensionFile(filePath);
        }
        this.loaded = true;
        this.ctx.logger.info(`所有扩展加载完成，共注册 ${this.tools.size} 个工具。`);
    }

    private async loadExtensionFile(filePath: string): Promise<void> {
        const fileName = path.basename(filePath);
        try {
            delete require.cache[require.resolve(filePath)];
            const module = require(filePath);
            const extensionDef = this.resolveModuleAsExtension(module, fileName);
            if (!extensionDef) {
                throw new ToolError(ToolErrorType.LOAD_ERROR, `文件 ${fileName} 未包含任何有效的扩展或工具导出。`);
            }
            await this.registerExtension(extensionDef);
            if (this.config.hotReload) this.setupFileWatcher(filePath);
        } catch (error) {
            this.ctx.logger.error(`✗ 扩展加载失败: ${fileName} - ${(error as Error).message}`);
            this.ctx.logger.debug((error as Error).stack);
        }
    }

    private resolveModuleAsExtension(module: any, fileName: string): ExtensionDefinition<any> | null {
        const DefaultExport = module.default;
        // 模式 1: 装饰器类
        if (DefaultExport && typeof DefaultExport === "function" && "getExtensionDefinition" in DefaultExport) {
            return (DefaultExport as ExtensionConstructor).getExtensionDefinition();
        }
        // 模式 2: 完整扩展包
        if (isValidExtension(DefaultExport)) {
            return DefaultExport;
        }
        // 模式 3: 直接导出工具
        const toolsFromDirectExport: ToolDefinition[] = Object.values(module).filter(isValidTool) as ToolDefinition[];
        if (toolsFromDirectExport.length > 0) {
            return createExtension({
                metadata: {
                    name: path.basename(fileName, path.extname(fileName)).replace(/^ext_/, ""),
                    version: "1.0.0",
                    description: `从文件 ${fileName} 自动收集的工具集合`,
                },
                tools: toolsFromDirectExport,
            });
        }
        return null;
    }

    private async registerExtension(extensionDef: ExtensionDefinition<any>): Promise<void> {
        const { metadata, tools, onLoad } = extensionDef;

        let validatedConfig = {};
        if (metadata.schema) {
            const userConfig = this.ctx.config.extensions?.[metadata.name] ?? {};
            const result = metadata.schema.safeParse(userConfig);
            if (!result.success) {
                throw new ToolError(ToolErrorType.CONFIG_ERROR, `扩展 "${metadata.name}" 配置无效: ${result.error.message}`);
            }
            validatedConfig = result.data;
        }
        this.extensionConfigs.set(metadata.name, validatedConfig);
        this.extensions.set(metadata.name, extensionDef);

        if (onLoad) await onLoad(this.ctx, validatedConfig);

        for (const tool of tools) {
            await this.registerTool(tool, { replace: true, extensionMetadata: metadata });
        }
        this.ctx.logger.success(`✓ 扩展加载成功: ${metadata.name}@${metadata.version} (${tools.length} 个工具)`);
    }

    // --- 工具注册与查询 (原 Registry 方法) ---

    async registerTool(definition: ToolDefinition, options?: Partial<ToolRegistrationOptions>): Promise<void> {
        const { metadata } = definition;

        const { replace = false, extensionMetadata } = options ?? {};

        if (this.tools.has(metadata.name) && !replace) {
            throw new ToolError(ToolErrorType.REGISTRATION_ERROR, `工具 "${metadata.name}" 已存在。`);
        }

        this.tools.set(metadata.name, definition);

        if (extensionMetadata) {
            this.toolToExtension.set(metadata.name, extensionMetadata.name);
        }

        if (metadata.category) {
            if (!this.categories.has(metadata.category)) {
                this.categories.set(metadata.category, new Set());
            }
            this.categories.get(metadata.category)!.add(metadata.name);
        }
        this.ctx.logger.success(`  ✓ 工具注册成功: ${metadata.name}`);
    }

    /**
     * 注销工具
     */
    async unregisterTool(toolName: string, context?: ToolContext): Promise<boolean> {
        const definition = this.tools.get(toolName);
        if (!definition) {
            return false;
        }

        try {
            // 执行注销前钩子
            if (definition.hooks?.onUnregister && context) {
                await definition.hooks.onUnregister(context);
            }

            // 从注册表中移除
            this.tools.delete(toolName);

            // 从扩展关联中移除
            const extensionName = this.toolToExtension.get(toolName);
            if (extensionName) {
                this.toolToExtension.delete(toolName);

                // 检查扩展是否还有其他工具
                const hasOtherTools = Array.from(this.toolToExtension.values()).includes(extensionName);
                if (!hasOtherTools) {
                    this.extensions.delete(extensionName);
                }
            }

            // 从分类索引中移除
            if (definition.metadata.category) {
                const categoryTools = this.categories.get(definition.metadata.category);
                if (categoryTools) {
                    categoryTools.delete(toolName);
                    if (categoryTools.size === 0) {
                        this.categories.delete(definition.metadata.category);
                    }
                }
            }
            return true;
        } catch (error) {
            throw new ToolError(
                ToolErrorType.REGISTRATION_ERROR,
                `注销工具 "${toolName}" 失败: ${(error as Error).message}`,
                toolName,
                error as Error
            );
        }
    }

    getToolDefinition(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    getAllToolDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    getToolsByCategory(category: string): ToolDefinition[] {
        const toolNames = this.categories.get(category) ?? new Set();
        return Array.from(toolNames)
            .map((name) => this.getToolDefinition(name))
            .filter((t): t is ToolDefinition => !!t);
    }

    // --- 工具执行与管理 ---

    getTool(name: string): ExecutableTool | undefined {
        const definition = this.getToolDefinition(name);
        if (!definition) return undefined;

        const extensionName = this.toolToExtension.get(name);
        const extensionMetadata = extensionName ? this.extensions.get(extensionName)?.metadata : undefined;
        const extensionConfig = extensionName ? this.extensionConfigs.get(extensionName) : {};

        const baseContext: Partial<ToolContext> = {
            koishiContext: this.ctx,
            logger: this.ctx.logger.extend(name), // 为每个工具提供带前缀的子logger
            extensionConfig,
        };
        return defineExecutableTool(definition, baseContext, extensionMetadata);
    }

    getTools(): ExecutableTool[] {
        return this.getAllToolDefinitions().map((def) => this.getTool(def.metadata.name)!);
    }

    async executeToolCall(session: any, functionName: string, params: Record<string, unknown>): Promise<ToolCallResult> {
        const startTime = Date.now();
        this.ctx.logger.info(`→ 开始执行工具: ${functionName}(${JSON.stringify(params)})`);

        const tool = this.getTool(functionName);
        if (!tool) {
            const errorMsg = `工具 "${functionName}" 未找到`;
            this.ctx.logger.warn(`← 工具执行失败: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }

        const definition = this.getToolDefinition(functionName)!;
        const validation = validateToolParameters(definition.parameters as z.ZodTypeAny, params);
        if (!validation.success) {
            const error = createToolError(ToolErrorType.VALIDATION_ERROR, validation.error, functionName);
            this.ctx.logger.warn(`← 工具执行失败: ${functionName} - ${error.message}`);
            return { success: false, error: error.message };
        }

        try {
            const result = await tool.execute(validation.data, { koishiSession: session });
            const executionTime = Date.now() - startTime;
            const resultPreview = JSON.stringify(result.result).substring(0, 100);
            this.ctx.logger.success(`← 工具执行成功: ${functionName} (${executionTime}ms) -> ${resultPreview}...`);
            return result;
        } catch (error) {
            const executionTime = Date.now() - startTime;
            const toolError =
                error instanceof ToolError
                    ? error
                    : createToolError(ToolErrorType.EXECUTION_ERROR, (error as Error).message, functionName, error as Error);
            this.ctx.logger.error(`← 工具执行失败: ${functionName} (${executionTime}ms) - ${toolError.message}`);
            return { success: false, error: toolError.message };
        }
    }

    async reloadExtensions(): Promise<void> {
        this.ctx.logger.info("开始重新加载所有扩展...");
        await this.cleanup();
        await this.loadExtensions();
    }

    private async cleanup(): Promise<void> {
        this.ctx.logger.info("开始清理资源...");
        this.fileWatchers.forEach((watcher) => watcher.close());
        this.fileWatchers.clear();

        for (const ext of this.extensions.values()) {
            if (ext.onUnload) {
                await ext.onUnload(this.ctx).catch((e) => this.ctx.logger.error(`扩展 ${ext.metadata.name} 的 onUnload 钩子执行失败`, e));
            }
        }

        this.tools.clear();
        this.extensions.clear();
        this.toolToExtension.clear();
        this.categories.clear();
        this.extensionConfigs.clear();
        this.loaded = false;

        this.ctx.logger.info("清理完成");
    }

    private setupFileWatcher(filePath: string): void {
        if (this.fileWatchers.has(filePath)) return;
        const fs = require("fs");
        if (!fs.existsSync(filePath)) return;

        const watcher = fs.watch(filePath, async (eventType) => {
            if (eventType === "change") {
                this.ctx.logger.info(`[HotReload] 检测到文件变化: ${path.basename(filePath)}，准备重载...`);
                // 需要更复杂的逻辑来卸载旧扩展并加载新扩展
                await this.reloadExtensions();
            }
        });
        this.fileWatchers.set(filePath, watcher);
    }

    /**
     * 获取工具的 Prompt 描述
     */
    getToolPrompt(name: string): string {
        const definition = this.getToolDefinition(name);
        if (!definition) {
            return "";
        }

        const tool = defineExecutableTool(definition);
        const properties = (tool.function.parameters?.properties as Record<string, any>) || {};

        const stringifyProperties = (props: Record<string, any>): string => {
            return Object.entries(props)
                .map(([key, value]) => {
                    const description = value?.description || "(无描述)";
                    const type = value?.type || "unknown";
                    const required = value?.required ? " *" : "";
                    return `    ${key} (${type}${required}): ${description}`;
                })
                .join("\n");
        };

        const paramsString = stringifyProperties(properties);
        const metadata = definition.metadata;

        return [`${metadata.name}:`, `  description: ${metadata.description}`, `  params:`, paramsString || "    无参数"].join("\n");
    }

    /**
     * 获取所有工具的 Prompt 描述
     */
    getToolPrompts(): string {
        return this.getAllToolDefinitions()
            .map((toolDef) => this.getToolPrompt(toolDef.metadata.name))
            .filter(Boolean)
            .join("\n");
    }
}
