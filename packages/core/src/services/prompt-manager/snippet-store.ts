import type { Logger } from "koishi";
import {
    RenderContext,
    Snippet,
    SnippetExecutionResult,
    SnippetOptions,
    SnippetProvider,
    SnippetValidationError,
} from "./types";

/**
 * 片段存储管理类
 * 负责动态片段的注册、存储、执行和缓存管理
 */
export class SnippetStore {
    private snippets = new Map<string, Snippet>();

    constructor(
        private logger: Logger,
        private defaultCacheTTL: number = 5 * 60 * 1000, // 5分钟
        private maxCacheEntries: number = 1000
    ) {}

    /**
     * 注册片段
     * @param snippet 片段定义
     * @throws 如果片段验证失败
     */
    public registerSnippet(snippet: Snippet): void {
        this.validateSnippet(snippet);

        const existingSnippet = this.snippets.get(snippet.key);
        if (existingSnippet) {
            this.logger.warn(`片段 '${snippet.key}' 已存在，将被覆盖`);
        }

        this.snippets.set(snippet.key, { ...snippet });

        this.logger.debug(`片段 '${snippet.key}' 注册成功`);
    }

    /**
     * 便捷方法：直接注册片段
     * @param key 片段键名
     * @param provider 提供函数
     * @param options 配置选项
     */
    public register(key: string, provider: SnippetProvider, options?: SnippetOptions): void {
        this.registerSnippet({ key, provider, options });
    }

    /**
     * 批量注册片段
     * @param snippets 片段数组
     */
    public registerSnippets(snippets: Snippet[]): void {
        for (const snippet of snippets) {
            try {
                this.registerSnippet(snippet);
            } catch (error) {
                this.logger.error(`注册片段 '${snippet.key}' 失败: ${error.message}`);
            }
        }
    }

    /**
     * 获取片段
     * @param key 片段键名
     * @returns 片段定义或 undefined
     */
    public getSnippet(key: string): Snippet | undefined {
        return this.snippets.get(key);
    }

    /**
     * 检查片段是否存在
     * @param key 片段键名
     * @returns 是否存在
     */
    public hasSnippet(key: string): boolean {
        return this.snippets.has(key);
    }

    /**
     * 获取所有片段键名
     * @returns 片段键名数组
     */
    public getSnippetKeys(): string[] {
        return Array.from(this.snippets.keys());
    }

    /**
     * 获取所有片段
     * @returns 片段数组
     */
    public getAllSnippets(): Snippet[] {
        return Array.from(this.snippets.values());
    }

    /**
     * 注销片段
     * @param key 片段键名
     * @returns 是否成功注销
     */
    public unregisterSnippet(key: string): boolean {
        const snippet = this.snippets.get(key);
        if (!snippet) {
            return false;
        }

        this.snippets.delete(key);

        this.logger.debug(`片段 '${key}' 注销成功`);

        return true;
    }

    /**
     * 执行片段
     * @param key 片段键名
     * @param context 渲染上下文
     * @param enableCache 是否启用缓存
     * @param timeout 超时时间（毫秒）
     * @returns 片段执行结果
     */
    public async executeSnippet(
        key: string,
        context: RenderContext,

        timeout: number = 5000
    ): Promise<SnippetExecutionResult> {
        const startTime = Date.now();
        const snippet = this.snippets.get(key);

        if (!snippet) {
            return {
                key,
                value: undefined,
                success: false,
                error: new Error(`片段 '${key}' 不存在`),
                executionTime: Date.now() - startTime,
            };
        }

        // 执行片段
        try {
            const value = await this.executeWithTimeout(snippet.provider, context, timeout);

            const executionTime = Date.now() - startTime;

            return {
                key,
                value,
                success: true,
                executionTime,
            };
        } catch (error) {
            const executionTime = Date.now() - startTime;

            // 使用默认值
            const defaultValue = snippet.options?.defaultValue;
            if (defaultValue !== undefined && !snippet.options?.required) {
                this.logger.warn(`片段 '${key}' 执行失败，使用默认值: ${error.message}`);
                return {
                    key,
                    value: defaultValue,
                    success: true,
                    error,
                    executionTime,
                };
            }

            return {
                key,
                value: undefined,
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
                executionTime,
            };
        }
    }

    /**
     * 批量执行片段
     * @param keys 片段键名数组
     * @param context 渲染上下文
     * @param enableCache 是否启用缓存
     * @param timeout 超时时间（毫秒）
     * @returns 片段执行结果数组
     */
    public async executeSnippets(
        keys: string[],
        context: RenderContext,

        timeout: number = 5000
    ): Promise<SnippetExecutionResult[]> {
        const promises = keys.map((key) => this.executeSnippet(key, context, timeout));

        return Promise.all(promises);
    }

    /**
     * 验证片段
     * @param snippet 片段定义
     * @throws 如果验证失败
     */
    private validateSnippet(snippet: Snippet): void {
        // 验证键名
        if (!snippet.key || typeof snippet.key !== "string" || snippet.key.trim() === "") {
            throw new Error(`${SnippetValidationError.INVALID_KEY}: 片段键名不能为空`);
        }

        // 验证提供函数
        if (!snippet.provider || typeof snippet.provider !== "function") {
            throw new Error(`${SnippetValidationError.INVALID_PROVIDER}: 片段提供函数必须是一个函数`);
        }

        // 检查重复键名
        if (this.snippets.has(snippet.key)) {
            this.logger.warn(`${SnippetValidationError.DUPLICATE_KEY}: 片段键名 '${snippet.key}' 已存在`);
        }
    }

    /**
     * 带超时的执行函数
     * @param provider 提供函数
     * @param context 上下文
     * @param timeout 超时时间
     * @returns 执行结果
     */
    private async executeWithTimeout(provider: SnippetProvider, context: RenderContext, timeout: number): Promise<any> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`片段执行超时 (${timeout}ms)`));
            }, timeout);

            Promise.resolve(provider(context))
                .then((result) => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        this.snippets.clear();
    }
}
