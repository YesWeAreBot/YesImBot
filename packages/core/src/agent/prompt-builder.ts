import { Context } from "koishi";
import Mustache from "mustache";
import { WorldState, DialogueSegment, AgentTurn } from "../services";
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
    toolSchemas: any[];
    worldState: WorldState;
    currentSegment: DialogueSegment;
    agentState: {
        lifeCycleStatus: "active" | "sleeping";
        analysis: FlowAnalysis;
        willingness: Willingness;
    };
    agentTurnHistory: AgentTurn[];
}

export class PromptBuilder {
    private systemTemplate: string;
    private userTemplate: string;
    private partials = new Map<string, string>();

    constructor(private ctx: Context, private config: PromptBuilderConfig) {
        // 禁用 Mustache 的 HTML 转义
        Mustache.escape = (text) => text;

        // 加载模板 (此处为示例，实际应从文件加载)
        this.systemTemplate = "System Prompt: {{> TOOL_DEFINITION}} {{> WORLD_STATE}}";
        this.userTemplate = "User Prompt: {{> AGENT_SELF_ASSESSMENT}} {{> CURRENT_CONVERSATION}}";

        // 注册默认的局部模板
        this.registerDefaultPartials();
    }

    private registerDefaultPartials(): void {
        // 假设模板文件已存在于某处
        const load = (name: string) => readFileSync(path.resolve(__dirname, `../../resources/templates/${name}.mustache`), "utf-8");
        this.registerPartial("TOOL_DEFINITION", load("tool_definition"));
        this.registerPartial("WORLD_STATE", load("world_state"));
    }

    public registerPartial(name: string, template: string): void {
        this.partials.set(name, template);
    }

    public async build(context: PromptContext): Promise<{ system: string; user: string }> {
        // 1. 异步准备所有需要的数据
        // const toolSchemas = await this.toolExecutor.getToolSchemas();

        // 2. 构建 Mustache 的视图(view)对象
        const view = {
            TOOL_DEFINITION: { tools: context.toolSchemas },
            WORLD_STATE: context.worldState,
            AGENT_SELF_ASSESSMENT: context.agentState,
            CURRENT_CONVERSATION: {
                segment: context.currentSegment,
                history: context.agentTurnHistory,
            },
            // 添加一个辅助函数，用于在模板中安全地序列化对象
            _toString: function () {
                return function (obj, render) {
                    const text = render(obj);
                    try {
                        const parsed = JSON.parse(text);
                        return JSON.stringify(parsed, null, 2);
                    } catch {
                        return text;
                    }
                };
            },
        };

        const partials = Object.fromEntries(this.partials);

        // 3. 渲染
        const system = Mustache.render(this.systemTemplate, view, partials);
        const user = Mustache.render(this.userTemplate, view, partials);

        return { system, user };
    }
}

export const SystemBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/memgpt_v2_chat.txt"), "utf-8");
export const UserBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/user_base.txt"), "utf-8");
