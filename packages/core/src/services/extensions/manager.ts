import { Context, Logger, Service } from "koishi";
import path from "path";
import { stringify, truncate } from "../../shared";
import { Services } from "../types";
import { ToolServiceConfig } from "./config";
import { createExtension, defineExecutableTool, Failed, isValidExtension, isValidTool } from "./helpers";
import {
    ExecutableTool,
    ExtensionConstructor,
    ExtensionDefinition,
    ToolCallResult,
    ToolDefinition,
    ToolError,
    ToolErrorType,
    ToolExecutionContext,
    ToolRegistrationOptions,
} from "./types";
import { getExtensionFiles } from "./utils";

declare module "koishi" {
    interface Context {
        [Services.Tool]: ToolService;
    }
}

export class ToolService extends Service<ToolServiceConfig> {
    static readonly inject = [Services.Logger];
    private loaded = false;
    private fileWatchers = new Map<string, any>();

    private reloadHooks: Array<() => Promise<void>> = [];

    private tools = new Map<string, ToolDefinition<any, any, any>>();
    private extensions = new Map<string, ExtensionDefinition<any>>();
    private toolToExtension = new Map<string, string>();
    private categories = new Map<string, Set<string>>();
    private extensionConfigs = new Map<string, any>();

    private _logger: Logger;

    constructor(ctx: Context, config: ToolServiceConfig) {
        super(ctx, Services.Tool, true);
        this._logger = ctx[Services.Logger].getLogger("[工具管理器]");
        this.config = config;

        ctx.on("ready", async () => {
            if (this.config?.autoLoad) await this.loadExtensions();
        });
        ctx.on("dispose", () => this.cleanup());
    }

    public addReloadHook(hook: () => Promise<void>) {
        this.reloadHooks.push(hook);
    }

    async loadExtensions(): Promise<void> {
        if (this.loaded) {
            this._logger.warn("[加载] 操作中止 | 原因: 扩展已加载，请使用 reloadExtensions() 重载");
            return;
        }
        const extensionFiles = getExtensionFiles(this.ctx);
        this._logger.info(`[加载] 开始 | 发现 ${extensionFiles.length} 个扩展文件`);
        for (const filePath of extensionFiles) {
            await this.loadExtensionFile(filePath);
        }
        this.loaded = true;
        this._logger.info(`[加载] 完成 | 共注册 ${this.tools.size} 个工具`);
    }

    private async loadExtensionFile(filePath: string): Promise<void> {
        const fileName = path.basename(filePath);
        try {
            delete require.cache[require.resolve(filePath)];
            const module = require(filePath);
            const extensionDef = this.resolveModuleAsExtension(module, fileName);
            if (!extensionDef) {
                throw new ToolError(ToolErrorType.LOAD_ERROR, `文件未包含任何有效的扩展或工具导出。`);
            }
            await this.registerExtension(extensionDef);
            if (this.config.advanced.hotReload) this.setupFileWatcher(filePath);
        } catch (error) {
            this._logger.error(`[加载] 扩展失败 | 文件: ${fileName} | 错误: ${(error as Error).message}`);
            this._logger.debug((error as Error).stack);
        }
    }

    private resolveModuleAsExtension(module: any, fileName: string): ExtensionDefinition<any> | null {
        const DefaultExport = module.default;
        if (DefaultExport && typeof DefaultExport === "function" && "getExtensionDefinition" in DefaultExport) {
            return (DefaultExport as ExtensionConstructor).getExtensionDefinition();
        }
        if (isValidExtension(DefaultExport)) {
            return DefaultExport;
        }
        const toolsFromDirectExport: ToolDefinition[] = Object.values(module).filter(isValidTool) as ToolDefinition[];
        if (toolsFromDirectExport.length > 0) {
            this._logger.debug(`[加载] 发现直接导出的工具 | 文件: ${fileName}`);
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
            // 使用 replace: true 来简化逻辑，重复加载时总是覆盖
            await this.registerTool(tool, { replace: true, extensionMetadata: metadata });
        }
        this._logger.success(`[注册] 扩展成功 | ${metadata.name}@${metadata.version} | 工具数: ${tools.length}`);
    }

    async registerTool(definition: ToolDefinition, options?: Partial<ToolRegistrationOptions>): Promise<void> {
        const { metadata } = definition;
        const { replace = false, extensionMetadata } = options ?? {};

        if (this.tools.has(metadata.name) && !replace) {
            throw new ToolError(ToolErrorType.REGISTRATION_ERROR, `工具 "${metadata.name}" 已存在。`);
        }
        this.tools.set(metadata.name, definition);

        if (extensionMetadata) this.toolToExtension.set(metadata.name, extensionMetadata.name);

        if (metadata.category) {
            if (!this.categories.has(metadata.category)) {
                this.categories.set(metadata.category, new Set());
            }
            this.categories.get(metadata.category)!.add(metadata.name);
        }
        // 单个工具的注册日志级别降为 debug，避免在加载大量工具时刷屏
        this._logger.debug(`  - [注册] 工具 | 名称: ${metadata.name}`);
    }

    async unregisterTool(toolName: string, context?: ToolExecutionContext): Promise<boolean> {
        const definition = this.tools.get(toolName);
        if (!definition) return false;

        try {
            if (definition.hooks?.onUnregister && context) {
                await definition.hooks.onUnregister(context);
            }
            this.tools.delete(toolName);
            const extensionName = this.toolToExtension.get(toolName);
            if (extensionName) {
                this.toolToExtension.delete(toolName);
                const hasOtherTools = Array.from(this.toolToExtension.values()).includes(extensionName);
                if (!hasOtherTools) this.extensions.delete(extensionName);
            }
            if (definition.metadata.category) {
                const categoryTools = this.categories.get(definition.metadata.category);
                if (categoryTools) {
                    categoryTools.delete(toolName);
                    if (categoryTools.size === 0) this.categories.delete(definition.metadata.category);
                }
            }
            this._logger.info(`[注销] 工具成功 | 名称: ${toolName}`);
            return true;
        } catch (error) {
            throw new ToolError(ToolErrorType.REGISTRATION_ERROR, `注销工具 "${toolName}" 失败`, toolName, error as Error);
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

    getTool(name: string): ExecutableTool | undefined {
        const definition = this.getToolDefinition(name);
        if (!definition) return undefined;
        const extensionName = this.toolToExtension.get(name);
        const extensionConfig = extensionName ? this.extensionConfigs.get(extensionName) : {};
        // 为每次执行创建带特定上下文的 logger
        const toolLogger = this._logger.extend(name);
        const baseContext: Partial<ToolExecutionContext> = { koishiContext: this.ctx, logger: toolLogger, extensionConfig };
        return defineExecutableTool(definition, baseContext, extensionName ? this.extensions.get(extensionName)?.metadata : undefined);
    }

    getTools(): ExecutableTool[] {
        return this.getAllToolDefinitions().map((def) => this.getTool(def.metadata.name)!);
    }

    async executeToolCall(context: ToolExecutionContext, functionName: string, params: Record<string, unknown>): Promise<ToolCallResult> {
        const tool = this.getTool(functionName);
        if (!tool) {
            this._logger.warn(`[执行] 工具未找到 | 名称: ${functionName}`);
            return Failed(`Tool ${functionName} not found`);
        }

        const stringifyParams = truncate(stringify(params), 100);
        this._logger.info(`[执行] → 调用: ${functionName} | 参数: ${stringifyParams}`);
        let lastResult: ToolCallResult = Failed("Tool call did not execute.");

        for (let attempt = 1; attempt <= this.config.advanced.maxRetry + 1; attempt++) {
            try {
                if (attempt > 1) {
                    this._logger.info(`  - [执行] 重试 (${attempt - 1}/${this.config.advanced.maxRetry})`);
                    await new Promise((resolve) => setTimeout(resolve, this.config.advanced.retryDelayMs));
                }

                lastResult = await tool.execute(params, context) || Failed("Tool call did not execute.");
                const resultString = truncate(stringify(lastResult), 120);

                if (lastResult.status === "success") {
                    this._logger.success(`[执行] ✔ 成功 ← 返回: ${resultString}`);
                    return lastResult;
                }
                if (!lastResult.retryable) {
                    this._logger.warn(`[执行] ✖ 失败 (不可重试) ← 原因: ${lastResult.error}`);
                    return lastResult;
                }
                this._logger.warn(`[执行] ⚠ 失败 (可重试) ← 原因: ${lastResult.error}`);
            } catch (error) {
                this._logger.error(`[执行] 💥 异常 | 调用 ${functionName} 时出错`, error.message);
                this._logger.debug(error.stack);
                lastResult = Failed(`Exception: ${error.message}`);
                return lastResult;
            }
        }
        this._logger.error(`[执行] ✖ 失败 (耗尽重试) | 工具: ${functionName}`);
        return lastResult;
    }

    async reloadExtensions(): Promise<void> {
        this._logger.info("[重载] 开始...");
        await this.cleanup();
        await this.loadExtensions();
        for (const hook of this.reloadHooks) {
            await hook();
        }
        this._logger.info("[重载] 完成");
    }

    private async cleanup(): Promise<void> {
        this._logger.info("[清理] 开始...");
        this.fileWatchers.forEach((watcher) => watcher.close());
        this.fileWatchers.clear();
        for (const ext of this.extensions.values()) {
            if (ext.onUnload) {
                await ext.onUnload(this.ctx).catch((e) => this._logger.error(`[清理] 卸载钩子失败 | 扩展: ${ext.metadata.name}`, e));
            }
        }
        this.tools.clear();
        this.extensions.clear();
        this.toolToExtension.clear();
        this.categories.clear();
        this.extensionConfigs.clear();
        this.loaded = false;
        this._logger.info("[清理] 完成");
    }

    private setupFileWatcher(filePath: string): void {
        if (this.fileWatchers.has(filePath)) return;
        const fs = require("fs");
        if (!fs.existsSync(filePath)) return;
        const watcher = fs.watch(filePath, async (eventType) => {
            if (eventType === "change") {
                this._logger.info(`[热重载] 文件变更 | 文件: ${path.basename(filePath)} | 触发重载...`);
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
        const properties = tool.function.parameters.properties;

        const stringifyProperties = (props: Record<string, any>): string => {
            return Object.entries(props)
                .map(([key, value]) => {
                    const description = value?.description || "(无描述)";
                    const type = value?.type || "unknown";
                    const required = value?.required ? " *必须" : "";
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

    getToolSchemas(): {
        name: string;
        description: string;
        params: {
            key: string;
            type: string;
            required?: boolean;
            description: string;
        }[];
    }[] {
        return this.getAllToolDefinitions().map((toolDef) => {
            const tool = defineExecutableTool(toolDef);
            return {
                name: tool.metadata.name,
                description: tool.metadata.description,
                params: Object.entries(tool.function.parameters.properties).map(([key, value]) => {
                    return {
                        key,
                        ...value,
                    };
                }),
            };
        });
    }
}
