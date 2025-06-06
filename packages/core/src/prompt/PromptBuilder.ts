import { readFileSync } from "fs";
import { Context } from "koishi";
import path from "path";
import type { Part, TextPart, UserMessagePart } from "xsai";

import { message } from "../dependencies/xsai";
import ToolManager from "../extensions";
import { MemoryService } from "../memory/MemoryService";
import { MessageContext } from "../middleware/base";
import { MultimodalConfig } from "../Scenario";
import { ScenarioManager } from "../services/ScenarioManager";
import { formatDate } from "../utils";

const { textPart } = message;

export type PromptBlockGenerator = (ctx: MessageContext, PromptBuilder: PromptBuilder) => Promise<string | Array<Part> | null>;

export interface PromptBuilderConfig {
    SystemTemplate: string;
    UserTemplate: string;
    ToolTemplate: string;
}

export class PromptBuilder {
    private templates: Map<string, string> = new Map();
    private blockGenerators: Map<string, PromptBlockGenerator> = new Map();

    private memory: MemoryService;
    private toolManager: ToolManager;
    private logger: any;
    private multimodalConfig: MultimodalConfig; // 新增多模态配置

    // 用于在构建完整 Prompt 时追踪图片总数
    private _currentPromptImageCount: number = 0;

    constructor(
        readonly ctx: Context,
        private readonly scenarioManager: ScenarioManager,
        private readonly config: PromptBuilderConfig,
        multimodalConfig: MultimodalConfig // 接收多模态配置
    ) {
        this.config = config;
        this.multimodalConfig = multimodalConfig;

        this.logger = ctx.logger("PromptBuilder");

        this.memory = ctx["yesimbot.memory"];
        this.toolManager = ctx["yesimbot.tool"];

        // 注册默认的提示词块生成器
        this.registerDefaultBlockGenerators();
    }

    /**
     * 注册一个自定义模板（允许运行时覆盖或添加模板）。
     * @param name 模板文件的名称，例如 'my_custom_template.txt'
     * @param content 模板内容字符串
     */
    public registerTemplate(name: string, content: string): void {
        this.templates.set(name, content);
        this.logger.debug(`Registered custom template: ${name}`);
    }

    /**
     * 注册一个用于生成特定提示词块内容的函数。
     * @param name 块的名称，对应模板中的占位符，例如 'memory', 'tools'
     * @param generator 生成器函数，接收 MessageContext 和 PromptBuilder 实例作为参数，返回字符串、Part 数组或 null。
     */
    public registerBlockGenerator(name: string, generator: PromptBlockGenerator): void {
        if (this.blockGenerators.has(name)) {
            this.logger.warn(`Overwriting existing prompt block generator: ${name}`);
        }
        this.blockGenerators.set(name, generator);
        this.logger.debug(`Registered prompt block generator: ${name}`);
    }

    /**
     * 注册默认的提示词块生成器。
     */
    private registerDefaultBlockGenerators(): void {
        // 核心记忆块 (通常为纯文本)
        this.registerBlockGenerator("CORE_MEMORY", async () => {
            return this.memory.getCoreMemoryContentForPrompt();
        });

        // 工具描述块 (通常为纯文本)
        this.registerBlockGenerator("TOOL_INSTRUCTION", async () => {
            const template = this.config.ToolTemplate;
            if (!template) {
                this.logger.warn("Tool template not found.");
                return "Please respond appropriately.";
            }
            return template;
        });

        // 工具定义块 (通常为纯文本)
        this.registerBlockGenerator("TOOL_DEFINITION", async () => {
            return this.toolManager.getToolPrompts();
        });

        // // 任务指令块 (通常为纯文本)
        // this.registerBlockGenerator("TASK_INSTRUCTION", async () => {
        //     const template = this.templates.get("task_instruction.txt");
        //     if (!template) {
        //         this.logger.warn("task_instruction.txt template not found.");
        //         return "Please respond appropriately.";
        //     }
        //     return template;
        // });

        // 场景上下文生成器 (可能包含文本和图片)
        this.registerBlockGenerator("SCENARIO_CONTEXT", async (ctx) => {
            // 获取所有活跃和不活跃的群组场景
            const activeScenarios = this.scenarioManager.getActiveScenariosForRender(ctx.allowedChannels);
            const inactiveScenarios = this.scenarioManager.getInactiveScenariosForRender(ctx.allowedChannels);

            let allScenarioParts: Array<UserMessagePart> = [];

            // 辅助函数：将文本合并到 Parts 数组中，并尝试合并连续的 TextPart
            const appendToScenarioParts = (partsToAdd: Array<Part>) => {
                for (const part of partsToAdd) {
                    if (part.type === "text") {
                        if (allScenarioParts.length > 0 && allScenarioParts[allScenarioParts.length - 1].type === "text") {
                            (allScenarioParts[allScenarioParts.length - 1] as TextPart).text += `\n${(part as TextPart).text}`;
                        } else {
                            allScenarioParts.push(part);
                        }
                    } else if (part.type === "image_url") {
                        allScenarioParts.push(part); // 图片直接添加
                    }
                }
            };

            const scenarioUpdateTime = formatDate(new Date());
            appendToScenarioParts([textPart(`<scenario_update timestamp="${scenarioUpdateTime}">`)]);

            if (activeScenarios.length > 0) {
                for (const s of activeScenarios) {
                    // Scenario.renderForPrompt() 现在返回 Part 数组
                    const renderedParts = await s.renderForPrompt();
                    appendToScenarioParts(renderedParts);
                }
            } else {
                appendToScenarioParts([textPart(`  <!-- No active scenarios with new messages -->`)]);
            }
            appendToScenarioParts([textPart(`</scenario_update>`)]);

            appendToScenarioParts([textPart(`<no_activity>`)]);
            if (inactiveScenarios.length > 0) {
                for (const s of inactiveScenarios) {
                    const renderedParts = await s.renderForPrompt(); // 渲染群聊场景内容
                    appendToScenarioParts(renderedParts);
                }
            } else {
                appendToScenarioParts([textPart(`  <!-- No inactive scenarios to report -->`)]);
            }
            appendToScenarioParts([textPart(`</no_activity>`)]);

            return allScenarioParts;
        });
    }

    /**
     * 构建总体的系统提示词（LLM的system role）。
     * 包含基础设定、核心记忆、工具说明等。
     * @param ctx 消息上下文。
     * @returns 完整的系统提示词字符串。
     */
    public async buildSystemPrompt(ctx: MessageContext): Promise<string> {
        let systemTemplate = this.config.SystemTemplate;

        // 替换所有已注册的块
        for (const [blockName, generator] of this.blockGenerators) {
            const placeholder = `{{${blockName}}}`;
            if (systemTemplate.includes(placeholder)) {
                const content = await generator(ctx, this);
                if (typeof content === "string" && content !== null) {
                    // 系统提示词只支持文本
                    systemTemplate = systemTemplate.replace(placeholder, content);
                } else if (Array.isArray(content)) {
                    this.logger.warn(
                        `Prompt block generator '${blockName}' returned array of parts, but System Prompt only supports text. Converting to string.`
                    );
                    // 将数组转换为字符串表示，避免丢失信息
                    systemTemplate = systemTemplate.replace(placeholder, this.flattenPartsToString(content));
                } else {
                    systemTemplate = systemTemplate.replace(placeholder, "");
                }
            }
        }

        // 清理可能剩余的未替换的占位符（例如，如果某个块生成器返回null，但模板中包含该块）
        systemTemplate = systemTemplate.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "");

        return systemTemplate;
    }

    /**
     * 构建总体的用户提示词（LLM的user role）。
     * 包含当前会话上下文、最新消息、场景更新等。
     * @param ctx 消息上下文。
     * @returns 完整的用户提示词 Part 数组。
     */
    public async buildUserPrompt(ctx: MessageContext): Promise<Array<UserMessagePart>> {
        const userPromptParts: Array<UserMessagePart> = [];
        this._currentPromptImageCount = 0; // 重置本次 Prompt 的图片计数

        const userTemplateString = this.config.UserTemplate;
        let lastIndex = 0;
        const placeholderRegex = /\{\{([a-zA-Z0-9_]+)\}\}/g; // 匹配所有 {{placeholder}}

        let match;
        while ((match = placeholderRegex.exec(userTemplateString)) !== null) {
            const placeholderName = match[1];
            const placeholderStart = match.index;
            const placeholderEnd = match.index + match[0].length;

            // 添加占位符之前的文本内容
            if (placeholderStart > lastIndex) {
                this.appendPart(userPromptParts, textPart(userTemplateString.substring(lastIndex, placeholderStart)));
            }

            // 获取占位符生成的内容
            const generator = this.blockGenerators.get(placeholderName);
            if (generator) {
                const generatedContent = await generator(ctx, this);

                if (generatedContent) {
                    if (Array.isArray(generatedContent)) {
                        // 如果生成器返回 Part 数组 (如 scenario_context)
                        for (const part of generatedContent) {
                            if (part.type === "image_url") {
                                if (
                                    this.multimodalConfig.Enabled &&
                                    this._currentPromptImageCount < this.multimodalConfig.MaxImagesPerPrompt
                                ) {
                                    this.appendPart(userPromptParts, part);
                                    this._currentPromptImageCount++;
                                } else {
                                    // 超出总图片限制，图片退化为文本
                                    this.appendPart(userPromptParts, textPart(`[图片已超出Prompt限制，未显示] `));
                                }
                            } else {
                                this.appendPart(userPromptParts, part); // 文本部分直接添加
                            }
                        }
                    } else if (typeof generatedContent === "string") {
                        // 如果生成器返回字符串
                        this.appendPart(userPromptParts, textPart(generatedContent));
                    }
                }
            }
            lastIndex = placeholderEnd;
        }

        // 添加最后一个占位符之后的文本内容
        if (lastIndex < userTemplateString.length) {
            this.appendPart(userPromptParts, textPart(userTemplateString.substring(lastIndex)));
        }

        return userPromptParts;
    }

    /**
     * 辅助函数：将 Part 添加到数组中，并尝试合并连续的 TextPart
     * @param parts 目标 Part 数组
     * @param newPart 要添加的 Part
     */
    private appendPart(parts: Array<Part>, newPart: Part): void {
        if (newPart.type === "text" && parts.length > 0 && parts[parts.length - 1].type === "text") {
            // 合并连续的 TextPart
            (parts[parts.length - 1] as TextPart).text += (newPart as TextPart).text;
        } else {
            parts.push(newPart);
        }
    }

    /**
     * 辅助函数：将 Part 数组扁平化为字符串 (用于系统提示词不支持多模态的情况)
     * @param parts Parts 数组
     * @returns 扁平化后的字符串
     */
    private flattenPartsToString(parts: Array<Part>): string {
        let result = "";
        for (const part of parts) {
            if (part.type === "text") {
                result += (part as TextPart).text;
            } else if (part.type === "image_url") {
                result += `[图片(未显示)]`; // 或更详细的描述
            }
            // 忽略其他类型或处理未知类型
        }
        return result.trim();
    }
}

export const SystemBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/memgpt_v2_chat.txt"), "utf-8");
export const ToolBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/tool_base.txt"), "utf-8");
export const UserBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/user_base.txt"), "utf-8");
