import { Context, Service } from "koishi";
import path from "path";
import { getExtensionFiles } from "../utils";
import {
    createToolError,
    defineExecutableTool,
    isValidExtensionDefinition,
    isValidToolDefinition,
    validateToolParameters,
    withRetry,
    withTimeout
} from "./helpers";
import { ToolLogger } from "./logger";
import { ToolRegistry } from "./registry";
import {
    ExecutableTool,
    ExtensionDefinition,
    ToolCallResult,
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolErrorType,
    ToolExecutionOptions,
    ToolManagerConfig,
    ToolRegistrationOptions
} from "./types";

declare module "koishi" {
    interface Context {
        "yesimbot.tool": ToolManager;
    }
}

/**
 * 优化后的工具管理器
 * 提供完整的工具生命周期管理、错误处理和日志记录
 */
export class ToolManager extends Service {
    private _logger: ToolLogger;
    private registry: ToolRegistry;
    private loaded = false;
    private fileWatchers = new Map<string, any>();
    private metrics = {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
    };

    constructor(ctx: Context, config: ToolManagerConfig = {}) {
        super(ctx, "yesimbot.tool", true);

        // 初始化配置
        this.config = {
            autoLoad: config.autoLoad ?? true,
            extensionPaths: config.extensionPaths ?? [],
            logLevel: config.logLevel ?? "info",
            enableMetrics: config.enableMetrics ?? true,
            maxRetries: config.maxRetries ?? 3,
            timeout: config.timeout ?? 30000,
            hotReload: config.hotReload ?? false,
            validateTypes: config.validateTypes ?? true,
        };

        // 初始化组件
        this._logger = new ToolLogger(ctx, this.config.logLevel);
        this.registry = new ToolRegistry(this._logger);

        ctx.on("ready", async () => {
            // 自动加载
            if (this.config.autoLoad) {
                await this.loadExtensions();
            }
        });

        // 服务停止时清理
        ctx.on("dispose", () => this.cleanup());
    }

    /**
     * 加载扩展文件
     */
    async loadExtensions(): Promise<void> {
        if (this.loaded) {
            this._logger.warn("Loader", "扩展已加载，跳过重复加载");
            return;
        }

        try {
            const extensionFiles = getExtensionFiles(this.ctx);
            const allPaths = [...extensionFiles, ...this.config.extensionPaths];

            this._logger.info("Loader", `开始加载扩展，共 ${allPaths.length} 个文件`);

            let totalToolsLoaded = 0;

            for (const filePath of allPaths) {
                try {
                    const toolsLoaded = await this.loadExtensionFile(filePath);
                    totalToolsLoaded += toolsLoaded;

                    // 设置热重载监听
                    if (this.config.hotReload) {
                        this.setupFileWatcher(filePath);
                    }
                } catch (error) {
                    this._logger.extensionLoadError(path.basename(filePath), error as Error);
                }
            }

            this.loaded = true;
            this._logger.info("Loader", `扩展加载完成，总共加载 ${totalToolsLoaded} 个工具`);
        } catch (error) {
            this._logger.error("Loader", "扩展加载过程中发生错误", error);
            throw error;
        }
    }

    /**
     * 加载单个扩展文件
     */
    private async loadExtensionFile(filePath: string): Promise<number> {
        // 清除缓存以支持热重载
        delete require.cache[require.resolve(filePath)];

        const extension = require(filePath);
        const fileName = path.basename(filePath);
        let toolsLoaded = 0;

        try {
            // 尝试解析为完整扩展定义
            if (isValidExtensionDefinition(extension.default)) {
                const extensionDef = extension.default as ExtensionDefinition;
                for (const tool of extensionDef.tools) {
                    await this.registerTool(tool, {
                        replace: true,
                        extensionMetadata: extensionDef.metadata
                    });
                    toolsLoaded++;
                }
            } else {
                // 兼容旧的工具定义方式
                const tools = this.extractToolsFromExtension(extension);
                for (const tool of tools) {
                    await this.registerTool(tool, { replace: true });
                    toolsLoaded++;
                }
            }

            this._logger.extensionLoaded(fileName, toolsLoaded);
            return toolsLoaded;
        } catch (error) {
            throw new ToolError(
                ToolErrorType.LOAD_ERROR,
                `加载扩展文件失败: ${(error as Error).message}`,
                filePath,
                error as Error
            );
        }
    }

    /**
     * 从扩展模块中提取工具定义
     */
    private extractToolsFromExtension(extension: any): ToolDefinition[] {
        const tools: ToolDefinition[] = [];

        if (extension.default && isValidToolDefinition(extension.default)) {
            tools.push(extension.default);
        }

        // 提取命名导出的工具
        Object.entries(extension)
            .filter(([key]) => key !== "default")
            .forEach(([, tool]) => {
                if (isValidToolDefinition(tool)) {
                    tools.push(tool as ToolDefinition);
                }
            });

        return tools;
    }

    /**
     * 获取扩展文件列表
     */
    private getExtensionFiles(): string[] {
        // 这里应该实现从扩展目录扫描文件的逻辑
        // 为了简化，这里返回空数组，实际使用时需要根据具体的文件结构实现
        return [];
    }

    /**
     * 设置文件监听器（热重载）
     */
    private setupFileWatcher(filePath: string): void {
        if (this.fileWatchers.has(filePath)) {
            return;
        }

        const fs = require("fs");
        if (!fs.existsSync(filePath)) {
            return;
        }

        const watcher = fs.watchFile(filePath, async () => {
            this._logger.info("HotReload", `检测到文件变化: ${path.basename(filePath)}`);
            try {
                // 重新加载单个文件
                await this.loadExtensionFile(filePath);
                this._logger.success("HotReload", `文件重载成功: ${path.basename(filePath)}`);
            } catch (error) {
                this._logger.error("HotReload", `文件重载失败: ${path.basename(filePath)}`, error);
            }
        });

        this.fileWatchers.set(filePath, watcher);
    }

    /**
     * 注册工具
     */
    async registerTool(definition: ToolDefinition, options?: Partial<ToolExecutionOptions & ToolRegistrationOptions>): Promise<void> {
        try {
            await this.registry.register(definition, options, { koishiContext: this.ctx });
        } catch (error) {
            this._logger.error("Registry", `注册工具失败: ${definition.metadata?.name}`, error);
            throw error;
        }
    }

    /**
     * 批量注册工具
     */
    async registerTools(definitions: ToolDefinition[], options?: Partial<ToolExecutionOptions & ToolRegistrationOptions>): Promise<void> {
        const results = await Promise.allSettled(
            definitions.map(def => this.registerTool(def, options))
        );

        const failures = results
            .map((result, index) => ({ result, index }))
            .filter(({ result }) => result.status === "rejected")
            .map(({ result, index }) => ({
                tool: definitions[index].metadata.name,
                error: (result as PromiseRejectedResult).reason
            }));

        if (failures.length > 0) {
            const errorMessage = failures
                .map(({ tool, error }) => `${tool}: ${error.message}`)
                .join("; ");
            throw new ToolError(
                ToolErrorType.REGISTRATION_ERROR,
                `批量注册失败: ${errorMessage}`
            );
        }
    }

    /**
     * 注销工具
     */
    async unregisterTool(toolName: string): Promise<boolean> {
        try {
            return await this.registry.unregister(toolName, { koishiContext: this.ctx });
        } catch (error) {
            this._logger.error("Registry", `注销工具失败: ${toolName}`, error);
            throw error;
        }
    }

    /**
     * 获取可执行工具
     */
    getTool(name: string, context: ToolContext = {}): ExecutableTool | undefined {
        const definition = this.registry.get(name);
        if (!definition) {
            return undefined;
        }

        const extensionName = this.registry["toolToExtension"]?.get(name);
        const extensionMetadata = extensionName ? this.registry["extensions"]?.get(extensionName) : undefined;

        return defineExecutableTool(definition, context, extensionMetadata);
    }

    /**
     * 获取所有可执行工具
     */
    getTools(context: ToolContext = {}): ExecutableTool[] {
        return this.registry.getAll().map((definition) => {
            const extensionName = this.registry["toolToExtension"]?.get(definition.metadata.name);
            const extensionMetadata = extensionName ? this.registry["extensions"]?.get(extensionName) : undefined;
            return defineExecutableTool(definition, context, extensionMetadata);
        });
    }

    /**
     * 执行工具调用（带完整的错误处理和重试机制）
     */
    async executeToolCall(
        koishiContext: Context,
        koishiSession: any,
        functionName: string,
        params: Record<string, unknown>,
        maxRetry?: number
    ): Promise<ToolCallResult> {
        const startTime = Date.now();
        const retryCount = maxRetry ?? this.config.maxRetries;

        try {
            // 记录执行开始
            this._logger.toolExecutionStart(functionName, params);

            // 获取工具
            const tool = this.getTool(functionName, { koishiContext, koishiSession });
            if (!tool) {
                throw createToolError(ToolErrorType.NOT_FOUND, `工具 "${functionName}" 未找到`, functionName);
            }

            // 参数验证
            const definition = this.registry.get(functionName)!;
            if (this.config.validateTypes) {
                const validation = validateToolParameters(definition.parameters, params);
                if (!validation.success) {
                    throw createToolError(
                        ToolErrorType.VALIDATION_ERROR,
                        (validation as { error: string }).error,
                        functionName
                    );
                }
                params = validation.data;
            }

            // 执行工具（带超时和重试）
            const result = await withRetry(
                () => withTimeout(
                    tool.execute(params, { koishiContext, koishiSession }),
                    this.config.timeout,
                    functionName
                ),
                retryCount,
                functionName,
                (retryNum) => this._logger.toolRetry(functionName, retryNum, retryCount)
            );

            // 记录成功执行
            const executionTime = Date.now() - startTime;
            this.updateMetrics(true, executionTime);
            this._logger.toolExecutionSuccess(functionName, executionTime, result.result);

            return result;
        } catch (error) {
            // 记录失败执行
            const executionTime = Date.now() - startTime;
            this.updateMetrics(false, executionTime);

            let errorMessage = `执行工具时发生未知错误: ${(error as Error).message}`;
            if (error instanceof ToolError) {
                errorMessage = error.message;

                // 记录安全违规
                if (error.type === ToolErrorType.PERMISSION_ERROR) {
                    this._logger.securityViolation(functionName, errorMessage, params);
                }
            }

            this._logger.toolExecutionError(functionName, executionTime, errorMessage);

            return {
                success: false,
                error: errorMessage,
                metadata: { executionTime, retryCount: 0 },
            };
        }
    }

    /**
     * 获取工具的 Prompt 描述
     */
    getToolPrompt(name: string): string {
        const definition = this.registry.get(name);
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

        return [
            `${metadata.name}:`,
            `  description: ${metadata.description}`,
            `  params:`,
            paramsString || "    无参数",
        ].join("\n");
    }

    /**
     * 获取所有工具的 Prompt 描述
     */
    getToolPrompts(): string {
        return this.registry
            .getToolNames()
            .map((name) => this.getToolPrompt(name))
            .join("\n\n");
    }

    /**
     * 搜索工具
     */
    searchTools(query: string): ExecutableTool[] {
        return this.registry.search(query).map((definition) => defineExecutableTool(definition));
    }

    /**
     * 根据分类获取工具
     */
    getToolsByCategory(category: string): ExecutableTool[] {
        return this.registry.getByCategory(category).map((definition) => defineExecutableTool(definition));
    }

    /**
     * 根据扩展获取工具
     */
    getToolsByExtension(extensionName: string): ExecutableTool[] {
        return this.registry.getByExtension(extensionName).map((definition) => defineExecutableTool(definition));
    }

    /**
     * 获取工具统计信息
     */
    getStats() {
        return {
            registry: this.registry.getStats(),
            execution: this.config.enableMetrics ? { ...this.metrics } : null,
        };
    }

    /**
     * 重新加载扩展
     */
    async reloadExtensions(): Promise<void> {
        this._logger.info("Loader", "开始重新加载扩展");
        this.registry.clear();
        this.loaded = false;
        await this.loadExtensions();
    }

    /**
     * 更新执行指标
     */
    private updateMetrics(success: boolean, executionTime: number): void {
        if (!this.config.enableMetrics) return;

        this.metrics.totalExecutions++;
        this.metrics.totalExecutionTime += executionTime;
        this.metrics.averageExecutionTime = this.metrics.totalExecutionTime / this.metrics.totalExecutions;

        if (success) {
            this.metrics.successfulExecutions++;
        } else {
            this.metrics.failedExecutions++;
        }
    }

    /**
     * 清理资源
     */
    private async cleanup(): Promise<void> {
        this._logger.info("Manager", "开始清理工具管理器资源");

        // 清理文件监听器
        for (const [filePath, watcher] of this.fileWatchers) {
            try {
                const fs = require("fs");
                fs.unwatchFile(filePath);
                this._logger.debug("Manager", `已清理文件监听器: ${filePath}`);
            } catch (error) {
                this._logger.error("Manager", `清理文件监听器失败: ${filePath}`, error);
            }
        }
        this.fileWatchers.clear();

        // 执行所有工具的注销钩子
        const context = { koishiContext: this.ctx };
        for (const toolName of this.registry.getToolNames()) {
            try {
                await this.registry.unregister(toolName, context);
            } catch (error) {
                this._logger.error("Cleanup", `清理工具 ${toolName} 时发生错误`, error);
            }
        }

        this.registry.clear();
        this._logger.info("Manager", "工具管理器清理完成");
    }
}
