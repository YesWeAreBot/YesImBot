import { readFileSync } from "fs";
import { Context, Service } from "koishi";
import Mustache from "mustache";
import path from "path";
import type { UserMessagePart } from "xsai";

import { message } from "../dependencies/xsai";
import { ToolService } from "./extensions";
import { MemoryService } from "./memory";
import { DataManager } from "./worldstate";
import { MiddlewareContext } from "../middleware";

const { textPart } = message;

/**
 * 数据提供者函数类型。
 * 它负责异步获取用于填充模板特定部分所需的数据。
 * @param ctx 消息上下文。
 * @returns 一个 Promise，解析为任意类型的数据（通常是对象、数组或字符串），
 *          这些数据将作为视图(view)传递给 Mustache 模板引擎。
 */
export type PromptDataProvider = (ctx: any) => Promise<any>;

export interface PromptBuilderConfig {
    SystemTemplate: string;
    UserTemplate: string;
}

export class PromptBuilder extends Service {
    static readonly name = "yesimbot.promptBuilder";
    static readonly inject = ["yesimbot.memory", "yesimbot.tool", "yesimbot.data"];

    private readonly dataProviders: Map<string, PromptDataProvider> = new Map();
    private readonly partials: Map<string, string> = new Map();
    private readonly memory: MemoryService;
    private readonly tool: ToolService;
    private readonly data: DataManager;

    constructor(ctx: Context, public readonly config: PromptBuilderConfig) {
        super(ctx, "yesimbot.promptBuilder", true);
        this.logger = ctx.logger("PromptBuilder");

        // 获取核心服务
        this.memory = ctx["yesimbot.memory"];
        this.tool = ctx["yesimbot.tool"];
        this.data = ctx["yesimbot.data"];

        // 禁用 Mustache 的 HTML 转义，因为我们的输出是纯文本
        Mustache.escape = (text) => text;

        ctx.on("ready", () => {
            this.registerDefaultPartials();
            this.registerDefaultDataProviders();
        });
    }

    /**
     * 注册一个局部模板 (Partial)。
     * @param name 模板的名称，用于在其他模板中通过 {{> name }} 引用。
     * @param template 模板内容的字符串。
     */
    public registerPartial(name: string, template: string): void {
        if (this.partials.has(name)) this.logger.warn(`Overwriting partial: ${name}`);
        this.partials.set(name, template);
        this.logger.debug(`Registered partial: ${name}`);
    }

    /**
     * 注册一个用于提供模板数据块的函数。
     * @param name 块的名称，应与某个 Partial 的名称对应。
     * @param provider 数据提供者函数。
     */
    public registerDataProvider(name: string, provider: PromptDataProvider): void {
        if (this.dataProviders.has(name)) this.logger.warn(`Overwriting provider: ${name}`);
        this.dataProviders.set(name, provider);
        this.logger.debug(`Registered provider: ${name}`);
    }

    /**
     * 注册默认的局部模板。
     */
    private registerDefaultPartials(): void {
        const load = (name: string) => readFileSync(path.resolve(__dirname, `../../resources/templates/${name}.mustache`), "utf-8");
        this.registerPartial("CORE_MEMORY", load("core_memory"));
        this.registerPartial("TOOL_DEFINITION", load("tool_definition"));
        this.registerPartial("WORLD_STATE", load("world_state"));
    }

    /**
     * 注册默认的数据提供者。
     * 每个提供者的数据都将用于渲染其同名的 Partial。
     */
    private registerDefaultDataProviders(): void {
        this.registerDataProvider("CORE_MEMORY", async () => {
            return this.memory.getProvider();
        });

        this.registerDataProvider("TOOL_DEFINITION", async () => {
            return { tools: await this.tool.getToolSchemas() };
        });

        this.registerDataProvider("WORLD_STATE", async (ctx: MiddlewareContext) => {
            const state = await this.data.getWorldState(ctx.allowedChannels);

            // state.activeChannels.forEach(channel=>{
            //     channel.history.forEach(turn=>{
            //         turn.responses.forEach(resp=>{
            //             resp.actions.forEach(action=>{
            //                 action.
            //             })
            //         })
            //     })
            // })

            return state;
        });
    }

    // --- 核心构建逻辑 ---

    /**
     * 构建一个完整的提示词对（System 和 User）。
     * 这是推荐使用的主要方法，因为它能通过内部缓存优化数据获取。
     * @param ctx 消息上下文
     * @returns 包含 system 和 user 提示词的对象
     */
    public async build(ctx: any): Promise<{ system: string; user: UserMessagePart[] }> {
        // 创建一个本次构建独有的缓存
        const requestCache = new Map<string, Promise<any>>();

        const extraData = {
            _toString: function (obj): string {
                return typeof obj === "string" ? obj : JSON.stringify(obj);
            },
            // userName: ctx.session.author.name || ctx.session.author.id,
            // userId: ctx.session.author.id,
            // userContent: ctx.session.content,
        };

        const system = await this.render(this.config.SystemTemplate, ctx, extraData, requestCache);
        const userContent = await this.render(this.config.UserTemplate, ctx, extraData, requestCache);
        const user = [textPart(userContent)];

        return { system, user };
    }

    /**
     * 递归地从模板及其 partials 中解析出所有需要的数据键。
     * @param template 模板字符串
     * @param visitedPartials 用于防止无限递归的集合
     * @returns 一个包含所有必需数据键的 Set
     */
    private getRequiredDataKeys(template: string, visitedPartials = new Set<string>()): Set<string> {
        const keys = new Set<string>();
        const tokens = Mustache.parse(template);

        for (const token of tokens) {
            const type = token[0];
            const name = token[1];

            if (type === "name" || type === "#" || type === "^") {
                // 'user.name' -> 'user'
                keys.add(name.split(".")[0]);
            } else if (type === ">") {
                // Partial {{> name }}
                keys.add(name); // Partial 的名字本身也是一个数据键
                if (!visitedPartials.has(name)) {
                    visitedPartials.add(name);
                    const partialTemplate = this.partials.get(name);
                    if (partialTemplate) {
                        const nestedKeys = this.getRequiredDataKeys(partialTemplate, visitedPartials);
                        nestedKeys.forEach((key) => keys.add(key));
                    }
                }
            }
        }
        return keys;
    }

    /**
     * 使用 Mustache 高效地渲染模板。
     * 它会先分析模板，只获取所需数据，并利用缓存避免重复获取。
     * @param template 待渲染的顶级模板字符串。
     * @param ctx 消息上下文。
     * @param extraData 额外的、非 provider 提供的数据。
     * @param cache 用于在多次 render 调用之间共享数据获取结果的缓存。
     * @returns 渲染完成的字符串。
     */
    private async render(template: string, ctx: any, extraData: Record<string, any>, cache: Map<string, Promise<any>>): Promise<string> {
        // 1. 静态分析模板，找出所有需要的数据键
        const requiredKeys = this.getRequiredDataKeys(template);
        this.ctx.logger.debug(`Template requires data for keys: %o`, Array.from(requiredKeys));

        // 2. 按需、带缓存地获取数据
        const view: Record<string, any> = { ...extraData };
        const promises: Promise<void>[] = [];

        for (const key of requiredKeys) {
            // 如果数据已由 extraData 提供，则跳过
            if (key in extraData) continue;

            // 如果缓存中已有此 key 的 promise，则无需再次调用 provider
            if (cache.has(key)) {
                this.ctx.logger.debug(`[Cache Hit] Using cached data for key: ${key}`);
            } else {
                const provider = this.dataProviders.get(key);
                if (provider) {
                    this.ctx.logger.debug(`[Cache Miss] Fetching data for key: ${key}`);
                    // 将 promise 放入缓存，而不是结果。这可以防止并发请求同一资源（"thundering herd"）
                    const promise = provider(ctx).catch((error) => {
                        this.ctx.logger.error(`Error fetching data for prompt block '${key}':`, error.message);

                        this.ctx.logger.error(error.stack);

                        return `[Error rendering ${key}]`;
                    });
                    cache.set(key, promise);
                }
            }

            const dataPromise = cache.get(key);
            if (dataPromise) {
                promises.push(
                    dataPromise.then((data) => {
                        view[key] = data;
                    })
                );
            }
        }

        await Promise.all(promises);

        // 3. 渲染
        const partials = Object.fromEntries(this.partials);
        return Mustache.render(template, view, partials);
    }
}

export const SystemBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/memgpt_v2_chat.txt"), "utf-8");
export const UserBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/user_base.txt"), "utf-8");
