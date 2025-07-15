import { Context, Logger, Service } from "koishi";
import { Services } from "@/services/types";
import { TemplateStore } from "./template-store";
import { SnippetStore } from "./snippet-store";
import { Renderer } from "./renderer";
import {
    Template,
    Snippet,
    SnippetProvider,
    SnippetOptions,
    RenderContext,
    RenderOptions,
    RenderResult,
    PromptManagerConfig,
} from "./types";

// 声明模块扩展
declare module "koishi" {
    interface Context {
        [Services.PromptManager]: PromptManager;
    }
}

/**
 * 通用提示词管理服务
 * 提供模板管理、片段注入、动态渲染等功能
 */
export class PromptManager extends Service<PromptManagerConfig> {
    static readonly inject = [Services.Logger];

    private templateStore: TemplateStore;
    private snippetStore: SnippetStore;
    private renderer: Renderer;

    private cleanupTimer?: NodeJS.Timeout;

    constructor(ctx: Context, config: PromptManagerConfig = {}) {
        super(ctx, Services.PromptManager);

        this.ctx = ctx;
        this.config = config;

        // 合并默认配置
        this.config = {
            defaultTimeout: 5000, // 5秒
            debug: false,

            ...config,
        };

        // 初始化子组件
        this.templateStore = new TemplateStore(ctx.logger("[提示词服务]"));
        this.snippetStore = new SnippetStore(ctx.logger("[提示词服务]"));
        this.renderer = new Renderer(ctx.logger("[提示词服务]"), this.templateStore, this.snippetStore);

        ctx.logger.info("PromptManager 服务已启动");
    }

    // ==================== 模板管理 API ====================

    /**
     * 注册模板
     * @param name 模板名称
     * @param content 模板内容
     * @param dependencies 依赖的片段键名
     * @param metadata 模板元数据
     */
    public registerTemplate(name: string, content: string, dependencies?: string[]): void {
        this.templateStore.registerTemplate({
            name,
            content,
            dependencies,
        });
    }

    /**
     * 批量注册模板
     * @param templates 模板数组
     */
    public registerTemplates(templates: Template[]): void {
        this.templateStore.registerTemplates(templates);
    }

    /**
     * 获取模板
     * @param name 模板名称
     * @returns 模板定义或 undefined
     */
    public getTemplate(name: string): Template | undefined {
        return this.templateStore.getTemplate(name);
    }

    /**
     * 检查模板是否存在
     * @param name 模板名称
     * @returns 是否存在
     */
    public hasTemplate(name: string): boolean {
        return this.templateStore.hasTemplate(name);
    }

    /**
     * 获取所有模板名称
     * @returns 模板名称数组
     */
    public getTemplateNames(): string[] {
        return this.templateStore.getTemplateNames();
    }

    /**
     * 注销模板
     * @param name 模板名称
     * @returns 是否成功注销
     */
    public unregisterTemplate(name: string): boolean {
        return this.templateStore.unregisterTemplate(name);
    }

    // ==================== 片段管理 API ====================

    /**
     * 注册片段
     * @param key 片段键名
     * @param provider 提供函数
     * @param options 配置选项
     */
    public registerSnippet(key: string, provider: SnippetProvider, options?: SnippetOptions): void {
        this.snippetStore.register(key, provider, options);
    }

    /**
     * 批量注册片段
     * @param snippets 片段数组
     */
    public registerSnippets(snippets: Snippet[]): void {
        this.snippetStore.registerSnippets(snippets);
    }

    /**
     * 获取片段
     * @param key 片段键名
     * @returns 片段定义或 undefined
     */
    public getSnippet(key: string): Snippet | undefined {
        return this.snippetStore.getSnippet(key);
    }

    /**
     * 检查片段是否存在
     * @param key 片段键名
     * @returns 是否存在
     */
    public hasSnippet(key: string): boolean {
        return this.snippetStore.hasSnippet(key);
    }

    /**
     * 获取所有片段键名
     * @returns 片段键名数组
     */
    public getSnippetKeys(): string[] {
        return this.snippetStore.getSnippetKeys();
    }

    /**
     * 注销片段
     * @param key 片段键名
     * @returns 是否成功注销
     */
    public unregisterSnippet(key: string): boolean {
        return this.snippetStore.unregisterSnippet(key);
    }

    // ==================== 渲染 API ====================

    /**
     * 渲染模板
     * @param templateName 模板名称
     * @param context 渲染上下文
     * @param options 渲染选项
     * @returns 渲染结果
     */
    public async render(
        templateName: string,
        context: RenderContext = {},
        options: RenderOptions = {}
    ): Promise<RenderResult> {
        const mergedOptions = {
            enableCache: true,
            timeout: this.config.defaultTimeout,
            strict: false,
            ...options,
        };

        const result = await this.renderer.render(templateName, context, mergedOptions);

        return result;
    }

    /**
     * 直接渲染模板字符串
     * @param templateContent 模板内容
     * @param context 渲染上下文
     * @param options 渲染选项
     * @returns 渲染结果
     */
    public async renderRaw(
        templateContent: string,
        context: RenderContext = {},
        options: RenderOptions = {}
    ): Promise<RenderResult> {
        const mergedOptions = {
            enableCache: true,
            timeout: this.config.defaultTimeout,
            strict: false,
            ...options,
        };

        const result = await this.renderer.renderRaw(templateContent, context, mergedOptions);

        return result;
    }

    /**
     * 服务停止时的清理
     */
    public dispose(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }

        this.templateStore.dispose();
        this.snippetStore.dispose();
        this.renderer.dispose();

        this.ctx.logger.info("PromptManager 服务已停止");
    }
}

// 导出类型和常量
export * from "./types";
export { TemplateStore, SnippetStore, Renderer };
