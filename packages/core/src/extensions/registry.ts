import { ToolLogger } from "./logger";
import { ExtensionMetadata, ToolContext, ToolDefinition, ToolError, ToolErrorType, ToolRegistrationOptions } from "./types";

/**
 * 工具注册表
 * 负责管理工具的注册、注销和查询
 */
export class ToolRegistry {
    private tools = new Map<string, ToolDefinition>();
    private extensions = new Map<string, ExtensionMetadata>();
    private toolToExtension = new Map<string, string>();
    private categories = new Map<string, Set<string>>();

    constructor(private logger: ToolLogger) {}

    /**
     * 注册工具
     */
    async register(definition: ToolDefinition, options: ToolRegistrationOptions = {}, context?: ToolContext): Promise<void> {
        const { metadata } = definition;
        const { replace = false, validateDependencies = true, enableHooks = true, extensionMetadata } = options;

        // 检查是否已存在
        if (this.tools.has(metadata.name) && !replace) {
            throw new ToolError(
                ToolErrorType.REGISTRATION_ERROR,
                `工具 "${metadata.name}" 已存在，使用 replace: true 来覆盖`,
                metadata.name
            );
        }

        try {
            // 执行注册前钩子
            if (enableHooks && definition.hooks?.onRegister && context) {
                await definition.hooks.onRegister(context);
            }

            // 注册工具
            this.tools.set(metadata.name, definition);

            // 关联扩展
            if (extensionMetadata) {
                this.extensions.set(extensionMetadata.name, extensionMetadata);
                this.toolToExtension.set(metadata.name, extensionMetadata.name);
            }

            // 更新分类索引
            if (metadata.category) {
                if (!this.categories.has(metadata.category)) {
                    this.categories.set(metadata.category, new Set());
                }
                this.categories.get(metadata.category)!.add(metadata.name);
            }

            this.logger.toolRegistered(metadata.name, metadata.version, metadata.category);
        } catch (error) {
            throw new ToolError(
                ToolErrorType.REGISTRATION_ERROR,
                `注册工具 "${metadata.name}" 失败: ${(error as Error).message}`,
                metadata.name,
                error as Error
            );
        }
    }

    /**
     * 注销工具
     */
    async unregister(toolName: string, context?: ToolContext): Promise<boolean> {
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

            this.logger.toolUnregistered(toolName);
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

    /**
     * 获取工具定义
     */
    get(toolName: string): ToolDefinition | undefined {
        return this.tools.get(toolName);
    }

    /**
     * 检查工具是否存在
     */
    has(toolName: string): boolean {
        return this.tools.has(toolName);
    }

    /**
     * 获取所有工具名称
     */
    getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * 获取所有工具定义
     */
    getAll(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    /**
     * 根据分类获取工具
     */
    getByCategory(category: string): ToolDefinition[] {
        const toolNames = this.categories.get(category);
        if (!toolNames) {
            return [];
        }

        return Array.from(toolNames)
            .map((name) => this.tools.get(name))
            .filter((tool): tool is ToolDefinition => tool !== undefined);
    }

    /**
     * 根据扩展获取工具
     */
    getByExtension(extensionName: string): ToolDefinition[] {
        const toolNames = Array.from(this.toolToExtension.entries())
            .filter(([, ext]) => ext === extensionName)
            .map(([tool]) => tool);

        return toolNames.map((name) => this.tools.get(name)).filter((tool): tool is ToolDefinition => tool !== undefined);
    }

    /**
     * 根据标签搜索工具
     */
    searchByTags(tags: string[]): ToolDefinition[] {
        return Array.from(this.tools.values()).filter((tool) => {
            if (!tool.metadata.tags) return false;
            return tags.some((tag) => tool.metadata.tags!.includes(tag));
        });
    }

    /**
     * 搜索工具
     */
    search(query: string): ToolDefinition[] {
        const lowerQuery = query.toLowerCase();
        return Array.from(this.tools.values()).filter((tool) => {
            const { metadata } = tool;
            return (
                metadata.name.toLowerCase().includes(lowerQuery) ||
                metadata.description.toLowerCase().includes(lowerQuery) ||
                metadata.category?.toLowerCase().includes(lowerQuery) ||
                metadata.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
            );
        });
    }

    /**
     * 获取工具统计信息
     */
    getStats() {
        const stats = {
            totalTools: this.tools.size,
            totalExtensions: this.extensions.size,
            categories: {} as Record<string, number>,
            authors: {} as Record<string, number>,
            tags: {} as Record<string, number>,
        };

        for (const tool of this.tools.values()) {
            const { metadata } = tool;

            // 统计分类
            if (metadata.category) {
                stats.categories[metadata.category] = (stats.categories[metadata.category] || 0) + 1;
            }

            // 统计作者
            if (metadata.author) {
                stats.authors[metadata.author] = (stats.authors[metadata.author] || 0) + 1;
            }

            // 统计标签
            if (metadata.tags) {
                for (const tag of metadata.tags) {
                    stats.tags[tag] = (stats.tags[tag] || 0) + 1;
                }
            }
        }

        return stats;
    }

    /**
     * 清空注册表
     */
    clear(): void {
        this.tools.clear();
        this.extensions.clear();
        this.toolToExtension.clear();
        this.categories.clear();
    }
}
