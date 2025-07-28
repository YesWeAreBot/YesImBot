import { Context, Logger, Service, Session } from "koishi";

import { Services } from "@/shared/constants";
import { formatDate } from "@/shared/utils";
import { IRenderer, MustacheRenderer } from "./renderer";

/**
 * 片段 (Snippet) 是一个函数，用于在运行时动态生成内容。
 * @param currentScope - 当前正在构建的作用域对象，允许片段之间存在依赖关系。
 * @returns 返回将要注入到作用域中的数据，可以是任何类型。
 */
export type Snippet = (currentScope: Record<string, any>) => any | Promise<any>;

/**
 * PromptService 的配置项
 */
export interface PromptServiceConfig {
    renderer?: IRenderer;
}

/**
 * 通用提示词构建服务
 */
export class PromptService extends Service<PromptServiceConfig> {
    static readonly inject = [Services.Logger];
    private readonly renderer: IRenderer;
    private readonly templates: Map<string, string> = new Map();
    private readonly snippets: Map<string, Snippet> = new Map();
    private _logger: Logger;

    constructor(ctx: Context, config: PromptServiceConfig) {
        super(ctx, Services.Prompt, true);
        this.ctx = ctx;
        this.config = config;
        this.renderer = config.renderer || new MustacheRenderer();
        // @ts-ignore
        this._logger = this.ctx[Services.Logger].getLogger("[提示词]");
    }

    protected async start() {
        // 注册默认片段
        this.registerSnippet("time.now", () => {
            return formatDate(new Date(), "HH:mm:ss");
        });

        this.registerSnippet("time.unix", () => {
            return Math.floor(Date.now() / 1000);
        });

        this.registerSnippet("date.today", () => {
            return formatDate(new Date(), "YYYY-MM-DD");
        });

        this.registerSnippet("date.now", () => {
            return formatDate(new Date(), "YYYY-MM-DD HH:mm:ss");
        });

        this.registerSnippet("bot", async (scope) => {
            const { session } = scope as { session?: Session };
            if (!session) return {};
            return {
                id: session.bot.selfId,
                name: session.bot.user.name,
                nick: session.bot.user.nick || session.bot.user.name,
                platform: session.platform,
            };
        });

        this.registerSnippet("user", async (scope) => {
            const { session } = scope as { session?: Session };
            if (!session) return {};
            return {
                id: session.author.id,
                name: session.author.name,
                nick: session.author.nick || session.author.name,
                platform: session.platform,
            };
        });

        this._logger.info("服务已启动");
    }

    protected async stop() {
        this._logger.info("服务已停止");
    }

    /**
     * 注册一个提示词模板
     * @param name - 模板的唯一名称 (e.g., "agent.chat.system")
     * @param content - 包含占位符的模板字符串
     */
    public registerTemplate(name: string, content: string): void {
        if (this.templates.has(name)) {
            this._logger.warn(`覆盖已存在的模板 "${name}"`);
        }
        this.templates.set(name, content);
    }

    /**
     * 注册一个动态片段 (Snippet)
     * @param key - 片段的唯一键 (e.g., "user.name", "tools.availableList.json")
     * @param snippetFn - 在渲染时执行以提供动态数据的函数
     */
    public registerSnippet(key: string, snippetFn: Snippet): void {
        if (this.snippets.has(key)) {
            this._logger.warn(`覆盖已存在的片段 "${key}"`);
        }
        this.snippets.set(key, snippetFn);
    }

    /**
     * 渲染一个提示词模板
     * @param templateName - 要渲染的模板名称
     * @param initialScope - 用户在调用时传入的初始数据 (e.g., { query: "How to use TypeScript?" })
     * @returns 一个 Promise，解析为最终渲染好的提示词字符串
     */
    public async render(templateName: string, initialScope: Record<string, any> = {}): Promise<string> {
        const templateContent = this.templates.get(templateName);
        if (!templateContent) {
            throw new Error(`未找到模板 "${templateName}"`);
        }

        // 1. 构建作用域 (Scope)
        const scope = await this.buildScope(initialScope);

        // 2. 准备可重用的模板 (Partials for Mustache)
        const partials = Object.fromEntries(this.templates);

        // 3. 使用渲染器生成最终字符串
        return this.renderer.render(templateContent, scope, partials);
    }

    /**
     * 渲染一个原始的模板字符串，不经过注册
     * @param templateContent
     * @param initialScope
     * @returns
     */
    public async renderRaw(templateContent: string, initialScope: Record<string, any> = {}): Promise<string> {
        const scope = await this.buildScope(initialScope);
        return this.renderer.render(templateContent, scope);
    }

    /**
     * 构建完整的作用域，合并用户输入和动态片段的执行结果
     * @param initialScope - 用户传入的初始作用域
     * @returns 完整的、可供模板使用的数据作用域
     */
    private async buildScope(initialScope: Record<string, any>): Promise<Record<string, any>> {
        const scope = { ...initialScope };

        // 异步执行所有片段，并将结果注入到 scope 中
        for (const [key, snippetFn] of this.snippets.entries()) {
            try {
                const value = await snippetFn(scope);
                this.setNestedProperty(scope, key, value);
            } catch (error) {
                // this._logger.debug(`执行片段 "${key}" 时出错:`);
                // 根据策略，可以选择注入 null 或抛出异常
                this.setNestedProperty(scope, key, null);
            }
        }

        return scope;
    }

    /**
     * 一个辅助函数，用于根据点分隔的键路径在对象上设置嵌套属性。
     * 例如: setNestedProperty(obj, "user.address.city", "New York")
     * 会将 obj 修改为 { user: { address: { city: "New York" } } }
     */
    private setNestedProperty(obj: Record<string, any>, path: string, value: any): void {
        const keys = path.split(".");
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (typeof current[key] === "undefined" || current[key] === null) {
                current[key] = {};
            }
            current = current[key];
        }
        current[keys[keys.length - 1]] = value;
    }
}
