import { readFileSync } from "fs";
import { Context, Logger } from "koishi";
import Mustache from "mustache";
import path from "path";
import type { UserMessagePart } from "xsai";
import { message } from "../dependencies/xsai";
import ToolManager from "../extensions";
import { MemoryService } from "../memory/MemoryService";
import { MessageContext } from "../middleware/base";
import { DataManager } from "../services/worldstate/DataManager";

const { textPart } = message;

/**
 * 数据提供者函数类型。
 * 它负责异步获取用于填充模板特定部分所需的数据。
 * @param ctx 消息上下文。
 * @returns 一个 Promise，解析为任意类型的数据（通常是对象、数组或字符串），
 *          这些数据将作为视图(view)传递给 Mustache 模板引擎。
 */
export type PromptDataProvider = (ctx: MessageContext) => Promise<any>;

export interface PromptBuilderConfig {
    SystemTemplate: string;
    UserTemplate: string;
}

export class PromptBuilder {
    private readonly dataProviders: Map<string, PromptDataProvider> = new Map();
    private readonly partials: Map<string, string> = new Map();
    private readonly memory: MemoryService;
    private readonly toolManager: ToolManager;
    private readonly dataManager: DataManager;
    private readonly logger: Logger;

    constructor(readonly ctx: Context, private readonly config: PromptBuilderConfig) {
        this.logger = ctx.logger("PromptBuilder");

        // 获取核心服务
        this.memory = ctx["yesimbot.memory"];
        this.toolManager = ctx["yesimbot.tool"];
        this.dataManager = ctx["yesimbot.data"];

        // 禁用 Mustache 的 HTML 转义，因为我们的输出是纯文本
        Mustache.escape = (text) => text;

        this.registerDefaultPartials();
        this.registerDefaultDataProviders();
    }

    /**
     * 注册一个局部模板 (Partial)。
     * @param name 模板的名称，用于在其他模板中通过 {{> name }} 引用。
     * @param template 模板内容的字符串。
     */
    public registerPartial(name: string, template: string): void {
        if (this.partials.has(name)) {
            this.logger.warn(`Overwriting existing partial template: ${name}`);
        }
        this.partials.set(name, template);
        this.logger.debug(`Registered partial template: ${name}`);
    }

    /**
     * 注册一个用于提供模板数据块的函数。
     * @param name 块的名称，应与某个 Partial 的名称对应。
     * @param provider 数据提供者函数。
     */
    public registerDataProvider(name: string, provider: PromptDataProvider): void {
        if (this.dataProviders.has(name)) {
            this.logger.warn(`Overwriting existing prompt data provider: ${name}`);
        }
        this.dataProviders.set(name, provider);
        this.logger.debug(`Registered prompt data provider: ${name}`);
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
        // 返回符合 core_memory.mustache 模板所需的数据结构
        this.registerDataProvider("CORE_MEMORY", async () => {
            // 示例：此函数应从 memory service 获取数据并构造成对象
            return await this.memory.getProvider();
        });

        // 返回符合 tool_definition.mustache 模板所需的数据结构
        this.registerDataProvider("TOOL_DEFINITION", async () => {
            const tools = await this.toolManager.getToolSchemas();
            return { tools }; // 包装在对象中以匹配 {{#tools}}
        });

        // 返回符合 world_state.mustache 模板所需的数据结构
        this.registerDataProvider("WORLD_STATE", async (ctx) => {
            // 直接返回世界状态对象，模板会处理其渲染
            return this.dataManager.getWorldState(ctx.allowedChannels);
        });
    }

    /**
     * 构建系统提示词 (LLM 的 system role)。
     * @param ctx 消息上下文。
     * @returns 完整的系统提示词字符串。
     */
    public async buildSystemPrompt(ctx: MessageContext): Promise<string> {
        return this.render(this.config.SystemTemplate, ctx);
    }

    /**
     * 构建用户提示词 (LLM 的 user role)。
     * @param ctx 消息上下文。
     * @returns 完整的用户提示词 Part 数组。
     */
    public async buildUserPrompt(ctx: MessageContext): Promise<UserMessagePart[]> {
        // 额外的数据：我们可以动态地将当前用户信息注入到 view 中
        // const extraData = {
        //     userName: ctx.session.author.name || ctx.session.author.id,
        //     userId: ctx.session.author.id,
        //     userContent: ctx.session.content,
        // };
        const extraData = {};
        const content = await this.render(this.config.UserTemplate, ctx, extraData);
        return [textPart(content)];
    }

    /**
     * 使用 Mustache 渲染指定的模板。
     * @param template 待渲染的顶级模板字符串。
     * @param ctx 消息上下文。
     * @param extraData 可选的、要与 providers 的数据合并的额外数据。
     * @returns 渲染完成的字符串。
     */
    private async render(template: string, ctx: MessageContext, extraData: Record<string, any> = {}): Promise<string> {
        // 1. 并行获取所有 DataProvider 的数据
        const providers = Array.from(this.dataProviders.entries());

        const viewPromises = providers.map(async ([key, provider]) => {
            try {
                const data = await provider(ctx);
                return { key, data };
            } catch (error) {
                this.logger.error(`Error fetching data for prompt block '${key}':`, error);
                return { key, data: `[Error rendering ${key}]` }; // 在提示词中明确指出错误
            }
        });

        const results = await Promise.all(viewPromises);

        // 2. 构建最终的 view 对象，将所有数据源合并
        const view = results.reduce(
            (acc, { key, data }) => {
                // Mustache 可以通过 {{KEY}} 直接渲染简单字符串，也可以通过 {{#KEY}}...{{/KEY}} 来处理对象
                acc[key] = data;
                return acc;
            },
            { ...extraData }
        ); // 从 extraData 开始

        // 3. 将 partials Map 转换为 Mustache 需要的对象格式
        const partials = Object.fromEntries(this.partials);

        // 4. 使用 Mustache.render 进行最终渲染，传入模板、视图和分部
        return Mustache.render(template, view, partials);
    }
}

// 这些文件保持不变，因为它们只是提供原始模板字符串
export const SystemBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/memgpt_v2_chat.txt"), "utf-8");
export const UserBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/user_base.txt"), "utf-8");
