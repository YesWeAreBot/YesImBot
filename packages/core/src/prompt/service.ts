import { createHash } from "node:crypto";

import { Context, Logger, Session } from "koishi";

import { SystemBaseTemplate } from "../agent/config";
import { Config } from "../config";
import type { LoggerService } from "../logger";
import { YesImBotService } from "../shared/service";
import { formatDate, isEmpty } from "../shared/utils";
import { IRenderer, MustacheRenderer } from "./renderer";

const LEGACY_DEFAULT_SYSTEM_TEMPLATE_SHA256 = "89f805af18060b500d2745082bd4bac963982370298120e0345f33e265a61aee";

export type Snippet = (currentScope: Record<string, any>) => any | Promise<any>;

export interface Injection {
    /** 注入片段的唯一名称，用于调试和覆盖 (e.g., "my-plugin.tools") */
    name: string;
    /** 渲染优先级，数字越小，越先被渲染和展示 */
    priority: number;
    /** 渲染函数，返回一个字符串或可以被渲染为字符串的内容 */
    renderFn: Snippet;
}

export class PromptService extends YesImBotService<Config> {
    private readonly renderer: IRenderer;
    private readonly templates: Map<string, string> = new Map();
    private readonly snippets: Map<string, Snippet> = new Map();
    private readonly injections: Injection[] = [];
    private _logger: Logger;

    constructor(ctx: Context, config: Config, logging: LoggerService) {
        super(ctx, config);
        this.renderer = new MustacheRenderer();
        this._logger = logging.getLogger("[提示词]");
    }

    public async start() {
        this.registerDefaultSnippets();
        this.registerDefaultInjections();
    }

    public async stop() {
        this.snippets.clear();
        this.templates.clear();
        this.injections.length = 0;
    }

    /**
     * 注册一个核心动态片段 (Snippet)
     * 用于构建作用域，通常由核心服务或高级插件使用。
     * @param key - 片段的唯一键 (e.g., "user.name")
     * @param snippetFn - 在渲染时执行以提供动态数据的函数
     */
    public registerSnippet(key: string, snippetFn: Snippet): () => void {
        if (isEmpty(key)) {
            throw new Error("Snippet key cannot be empty");
        }
        if (this.snippets.has(key)) {
            this._logger.warn(`覆盖已存在的片段 "${key}"`);
        }
        this.snippets.set(key, snippetFn);
        return () => {
            if (this.snippets.get(key) === snippetFn) this.snippets.delete(key);
        };
    }

    /**
     * 注入一个将自动添加到主提示词的片段。
     * @param name - 注入的唯一名称，用于标识和调试。
     * @param priority - 优先级，数字越小越靠前。
     * @param renderFn - 渲染函数，返回一个字符串。返回值只作为数据插入，不解释其中的模板语法。
     */
    public inject(name: string, priority: number, renderFn: Snippet): () => void {
        const registration = { name, priority, renderFn };
        const existingIndex = this.injections.findIndex((i) => i.name === name);
        if (existingIndex > -1) {
            this._logger.warn(`覆盖已存在的注入 "${name}"`);
            this.injections[existingIndex] = registration;
        } else {
            this.injections.push(registration);
        }
        return () => {
            const index = this.injections.indexOf(registration);
            if (index !== -1) this.injections.splice(index, 1);
        };
    }

    /** Explicitly compose a registered, trusted template with terminal data. */
    public injectTemplate(name: string, priority: number, templateName: string, data?: Snippet): () => void {
        return this.inject(name, priority, async (scope) => {
            const template = this.templates.get(templateName);
            if (template === undefined) throw new Error(`未找到模板 "${templateName}"`);
            const values = data ? await data(scope) : {};
            return this.renderer.render(template, { ...scope, ...values }, Object.fromEntries(this.templates));
        });
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
        // Match the historical built-in, allowing only LF/CRLF differences. Custom presets remain untouched.
        const effective =
            name === "agent.system" && createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex") === LEGACY_DEFAULT_SYSTEM_TEMPLATE_SHA256
                ? SystemBaseTemplate
                : content;
        this.templates.set(name, effective);
    }

    /**
     * 渲染一个提示词模板
     * @param templateName - 要渲染的模板名称
     * @param initialScope - 用户在调用时传入的初始数据
     * @returns 一个 Promise，解析为最终渲染好的提示词字符串
     */
    public async render(templateName: string, initialScope: Record<string, any> = {}): Promise<string> {
        const templateContent = this.templates.get(templateName);
        if (!templateContent) {
            throw new Error(`未找到模板 "${templateName}"`);
        }

        const scope = await this.buildScope(initialScope);
        const partials = Object.fromEntries(this.templates);

        return this.renderer.render(templateContent, scope, partials, { maxDepth: this.config.maxRenderDepth });
    }

    /**
     * 渲染一个原始的模板字符串，不经过注册
     */
    public async renderRaw(templateContent: string, initialScope: Record<string, any> = {}): Promise<string> {
        const scope = await this.buildScope(initialScope);
        return this.renderer.render(templateContent, scope, undefined, { maxDepth: this.config.maxRenderDepth });
    }

    private registerDefaultSnippets(): void {
        this.registerSnippet("time.now", () => formatDate(new Date(), "HH:mm:ss"));
        this.registerSnippet("time.unix", () => Math.floor(Date.now() / 1000));
        this.registerSnippet("date.today", () => formatDate(new Date(), "YYYY-MM-DD"));
        this.registerSnippet("date.now", () => formatDate(new Date(), "YYYY-MM-DD HH:mm:ss"));

        this.registerSnippet("bot", async (scope) => {
            const { session } = scope as { session?: Session };
            if (!session) return {};
            return {
                id: session.bot.selfId,
                name: session.bot.user?.name ?? "",
                nick: session.bot.user?.nick || session.bot.user?.name || "",
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
    }

    private registerDefaultInjections(): void {
        // 注册一个特殊的片段，它的作用是处理所有通过 inject() 注册的内容
        this.registerSnippet(this.config.injectionPlaceholder ?? "", async (scope) => {
            // 按照优先级排序
            this.injections.sort((a, b) => a.priority - b.priority);

            const renderedFragments = await Promise.all(
                this.injections.map(async (injection) => {
                    try {
                        const result = await injection.renderFn(scope);
                        if (!result) return "";
                        return `<${injection.name}>\n${String(result)}\n</${injection.name}>`;
                    } catch (error) {
                        this._logger.error(`执行注入片段 "${injection.name}" 时出错: ${error.message}`);
                        return `<!-- Error in injection: ${injection.name} -->`;
                    }
                }),
            );

            // 过滤掉空的片段，并用换行符连接
            return renderedFragments.filter(Boolean).join("\n\n");
        });
    }

    private async buildScope(initialScope: Record<string, any>): Promise<Record<string, any>> {
        const scope = { ...initialScope };

        for (const [key, snippetFn] of this.snippets.entries()) {
            try {
                const value = await snippetFn(scope);
                this.setNestedProperty(scope, key, value);
            } catch {
                this.setNestedProperty(scope, key, null);
            }
        }
        return scope;
    }

    private setNestedProperty(obj: Record<string, any>, path: string, value: any): void {
        const keys = path.split(".");
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (typeof current[key] === "undefined" || current[key] === null) {
                current[key] = {};
            }
            // 防止将已有值（如字符串）覆盖为对象
            if (typeof current[key] !== "object") {
                return;
            }
            current = current[key];
        }
        current[keys[keys.length - 1]] = value;
    }
}
