import { readFileSync } from "fs";
import { Context } from "koishi";
import Mustache from "mustache";
import path from "path";
import type { ImagePart, Message, TextPart } from "xsai";
import { AgentResponse, MemoryBlockData, WorldState } from "../services";
import { AgentBehaviorConfig } from "./config";

// 定义 PromptBuilder 需要的完整上下文
export interface PromptContext {
    toolSchemas: any[]; // 可用的工具定义
    memory: {
        lastModified: string;
        archivalCount: number;
        memoryBlocks: MemoryBlockData[];
    };
    worldState: WorldState; // 世界状态快照
    previousResponses: AgentResponse[]; // Agent 最近的回合历史
    multiModalData: {
        images: (ImagePart | TextPart)[];
    };
    onetimeCode: string;
}

export class PromptBuilder {
    private systemTemplate: string;
    private userTemplate: string;
    private partials = new Map<string, string>(); // 用于存储局部模板

    constructor(private ctx: Context, private config: AgentBehaviorConfig["prompt"]) {
        // 禁用 Mustache 的 HTML 转义，使模板内容原样输出
        Mustache.escape = (text) => text;

        // 加载系统和用户模板
        this.systemTemplate = config.systemTemplate;
        this.userTemplate = config.userTemplate;

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
        this.registerPartial("CURRENT_TURN_HISTORY", load("current_turn_history"));
    }

    /**
     * 注册自定义的 Mustache 局部模板。
     * @param name 局部模板的名称
     * @param template 模板字符串
     */
    public registerPartial(name: string, template: string): void {
        this.partials.set(name, template);
    }

    public async build(context: PromptContext): Promise<{ messages: Message[] }> {
        const { multiModalData, previousResponses, toolSchemas, worldState, memory, onetimeCode } = context;
        const messages: Message[] = [];
        // --- 1. 准备渲染视图数据 ---

        // [NEW] 预处理 worldState，为当前 segment 添加标记
        // 我们需要一个方法来识别哪个是当前 segment。假设它是最后一个 'open' 的 segment
        // 在 AgentCore 调用时，它知道当前 segment 的 ID，所以我们可以直接用 ID 匹配。
        // 为了简化，我们假设 `context.worldState` 已经被标记好了。
        // 一个更好的实现是在 AgentCore 中标记它。

        // 我们在 AgentCore 的 buildPromptContext 中处理这个标记逻辑。
        // 这里我们假设它已经被处理。

        const view = {
            TOOL_DEFINITION: { tools: toolSchemas },
            CORE_MEMORY: memory,
            WORLD_STATE: worldState,
            CURRENT_CONVERSATION: {
                history: previousResponses,
            },
            ONETIME_CODE: onetimeCode,
            _toString: function () {
                return _toString(this);
            },
            _renderParams: function () {
                const content = [];
                for (let param of Object.keys(this.params)) {
                    content.push(`<${param}>${_toString(this.params[param])}</${param}>`);
                }
                return content.join("");
            },
            _truncate: function () {
                // const length = 500;
                // if (this.length > length) {
                //     return this.slice(0, length) + `...（内容过长，已省略${this.length - length}字符）`;
                // }
                return this;
            },
        };

        const partials = Object.fromEntries(this.partials);

        const systemPrompt = Mustache.render(this.systemTemplate, view, partials);
        const userPrompt = Mustache.render(this.userTemplate, view, partials);

        messages.push({ role: "system", content: systemPrompt });

        let userMessage: string | (ImagePart | TextPart)[];

        // 判断是否为多模态场景
        if (multiModalData && multiModalData.images.length > 0) {
            // --- 多模态路径 ---
            this.ctx.logger.info("Building prompt for multimodal scenario.");

            userMessage = [
                { type: "text", text: MultiModalSystemBaseTemplate },
                ...multiModalData.images,
                { type: "text", text: userPrompt },
            ];
        } else {
            // --- 纯文本路径 (保持旧逻辑) ---
            this.ctx.logger.info("Building prompt for text-only scenario.");
            userMessage = userPrompt;
        }

        messages.push({ role: "user", content: userMessage });

        return { messages };
    }
}

function _toString(obj) {
    if (typeof obj === "string") return obj;
    return JSON.stringify(obj);
}

// 默认的系统和用户模板文件路径
// TODO: 确保这些文件路径是正确的，并且模板内容已包含对 new WorldState 结构的支持
export const SystemBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/memgpt_v2_chat.txt"), "utf-8");
export const UserBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/user_base.txt"), "utf-8");
export const MultiModalSystemBaseTemplate = `Images that appear in the conversation will be provided first, numbered in the format 'Image #[ID]:'.
In the subsequent conversation text, placeholders in the format <image id="[ID]" onetime-code="{{ ONETIME_CODE }}"/> will be used to refer to these images.
Please participate in the conversation considering the full context of both images and text.`;
