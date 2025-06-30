import { Context } from "koishi";
import Mustache from "mustache";
import { WorldState, DialogueSegment, AgentTurn, MemoryBlockData } from "../services";
import { FlowAnalysis } from "./conversation-flow-analyzer";
import { Willingness } from "./willingness-calculator";
import { readFileSync } from "fs";
import path from "path";

export interface PromptBuilderConfig {
    SystemTemplate: string;
    UserTemplate: string;
}

// 定义 PromptBuilder 需要的完整上下文
export interface PromptContext {
    toolSchemas: any[]; // 可用的工具定义
    memory: {
        lastModified: string;
        archivalCount: number;
        memoryBlocks: MemoryBlockData[];
    };
    worldState: WorldState; // 世界状态快照
    currentSegment: DialogueSegment; // 当前正在处理的对话片段
    agentState: {
        // Agent 的内部状态
        lifeCycleStatus: "active" | "sleeping";
        analysis: FlowAnalysis; // 对话流分析
        willingness: Willingness; // 用户意愿评估
    };
    agentTurnHistory: AgentTurn[]; // Agent 最近的回合历史
}

export class PromptBuilder {
    private systemTemplate: string;
    private userTemplate: string;
    private partials = new Map<string, string>(); // 用于存储局部模板

    constructor(private ctx: Context, private config: PromptBuilderConfig) {
        // 禁用 Mustache 的 HTML 转义，使模板内容原样输出
        Mustache.escape = (text) => text;

        // 加载系统和用户模板
        this.systemTemplate = config.SystemTemplate;
        this.userTemplate = config.UserTemplate;

        // 注册默认的局部模板
        this.registerDefaultPartials();
    }

    /**
     * 注册默认的 Mustache 局部模板。
     */
    private registerDefaultPartials(): void {
        // 假设模板文件位于 ../../resources/templates/ 目录下
        const load = (name: string) => {
            try {
                return readFileSync(path.resolve(__dirname, `../../resources/templates/${name}.mustache`), "utf-8");
            } catch (error) {
                this.ctx.logger.error(`Failed to load partial template "${name}.mustache": ${error.message}`);
                return `{{! Error loading ${name} }}`; // 返回一个空的或错误占位符模板
            }
        };

        this.registerPartial("CORE_MEMORY", load("core_memory"));
        this.registerPartial("TOOL_DEFINITION", load("tool_definition"));
        this.registerPartial("WORLD_STATE", load("world_state"));
        // Add other partials if needed
    }

    /**
     * 注册自定义的 Mustache 局部模板。
     * @param name 局部模板的名称
     * @param template 模板字符串
     */
    public registerPartial(name: string, template: string): void {
        this.partials.set(name, template);
    }

    /**
     * 构建系统和用户提示词。
     * @param context 构建提示词所需的上下文信息
     * @returns 包含系统提示词和用户提示词的对象
     */
    public async build(context: PromptContext): Promise<{ system: string; user: string }> {
        // --- 1. 准备渲染视图数据 ---
        // 视图对象将传递给 Mustache 进行模板渲染
        const view = {
            TOOL_DEFINITION: { tools: context.toolSchemas }, // 可用工具的 schema
            CORE_MEMORY: context.memory, // 核心记忆快照
            WORLD_STATE: context.worldState, // 世界状态快照
            AGENT_SELF_ASSESSMENT: context.agentState, // Agent 的自我评估和状态
            CURRENT_CONVERSATION: {
                segment: context.currentSegment, // 当前对话片段
                // Agent 回合历史，用于提供上下文
                // 注意：原始代码没有将 AgentTurn 传递给 history，这里需要确保传递的是 AgentTurn 列表
                history: context.agentTurnHistory,
            },
            _toString: function () {
                if (typeof this === "string") return this;
                return JSON.stringify(this);
            },

            _renderParams: function () {
                const content = [];
                for (let param of Object.keys(this.params)) {
                    content.push(`<${param}>${this.params[param]}</${param}>`);
                }
                return content.join("");
            },
        };

        // 将 Map 转换为对象以供 Mustache 使用
        const partials = Object.fromEntries(this.partials);

        // --- 2. 渲染模板 ---
        const systemPrompt = Mustache.render(this.systemTemplate, view, partials);
        const userPrompt = Mustache.render(this.userTemplate, view, partials);

        return { system: systemPrompt, user: userPrompt };
    }
}

// 默认的系统和用户模板文件路径
// TODO: 确保这些文件路径是正确的，并且模板内容已包含对 new WorldState 结构的支持
export const SystemBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/memgpt_v2_chat.txt"), "utf-8");
export const UserBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/user_base.txt"), "utf-8");
