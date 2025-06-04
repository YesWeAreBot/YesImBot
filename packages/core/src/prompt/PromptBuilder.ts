import { readFile, readFileSync } from "fs";
import { Context } from "koishi";
import path from "path";
import ToolManager from "../extensions";
import { MemoryService } from "../memory/MemoryService";
import { MessageContext } from "../middleware/base";
import { ScenarioManager } from "../services/ScenarioManager";
import { formatDate } from "../utils";

export type PromptBlockGenerator = (ctx: MessageContext, PromptBuilder) => Promise<string | null>;

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

    constructor(readonly ctx: Context, private readonly scenarioManager: ScenarioManager, private readonly config: PromptBuilderConfig) {
        this.config = config;

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
     * @param generator 生成器函数，接收 MessageContext 和 PromptBuilder 实例作为参数，返回字符串或 null。
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
        // 核心记忆块
        this.registerBlockGenerator("memory", async () => {
            return this.memory.getCoreMemoryContentForPrompt();
        });

        // 工具描述块
        this.registerBlockGenerator("tools", async () => {
            const template = this.config.ToolTemplate;
            if (!template) {
                this.logger.warn("Tool template not found.");
                return "Please respond appropriately.";
            }
            return template;
        });

        // 工具
        this.registerBlockGenerator("tool_definition", async () => {
            return this.toolManager.getToolPrompts();
        });

        // 任务指令块
        this.registerBlockGenerator("task_instruction", async () => {
            const template = this.templates.get("task_instruction.txt");
            if (!template) {
                this.logger.warn("task_instruction.txt template not found.");
                return "Please respond appropriately.";
            }
            return template;
        });

        // 场景上下文生成器
        this.registerBlockGenerator("scenario_context", async (ctx) => {
            const session = ctx.koishiSession;
            if (session.isDirect || !session.channelId) {
                return null;
            }

            // 获取所有活跃和不活跃的群组场景
            const activeScenarios = this.scenarioManager.getActiveScenariosForRender();
            const inactiveScenarios = this.scenarioManager.getInactiveScenariosForRender();

            let content = "";
            const INDENT_UNIT = "  ";

            content += `<scenario_update timestamp="${formatDate(new Date())}">\n`;
            if (activeScenarios.length > 0) {
                for (const s of activeScenarios) {
                    content += s.renderForPrompt(); // 渲染群聊场景内容
                }
            } else {
                content += INDENT_UNIT + `<!-- No active scenarios with new messages -->\n`;
            }
            content += `</scenario_update>\n`;

            content += `<no_activity>\n`;
            if (inactiveScenarios.length > 0) {
                for (const s of inactiveScenarios) {
                    // 不活跃场景可能不包含最新消息，只包含基本信息
                    content += s.renderForPrompt() + "\n"; // 渲染群聊场景内容
                }
            } else {
                content += INDENT_UNIT + `<!-- No inactive scenarios to report -->\n`;
            }
            content += `</no_activity>\n`;

            return content;
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
                if (content !== null) {
                    systemTemplate = systemTemplate.replace(placeholder, content);
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
     * @returns 完整的用户提示词字符串。
     */
    public async buildUserPrompt(ctx: MessageContext): Promise<string> {
        let userTemplate = this.config.UserTemplate;

        // 替换所有已注册的块
        for (const [blockName, generator] of this.blockGenerators) {
            const placeholder = `{{${blockName}}}`;
            if (userTemplate.includes(placeholder)) {
                const content = await generator(ctx, this);
                if (content !== null) {
                    userTemplate = userTemplate.replace(placeholder, content);
                } else {
                    userTemplate = userTemplate.replace(placeholder, "");
                }
            }
        }

        // 清理可能剩余的未替换的占位符
        userTemplate = userTemplate.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "");

        return userTemplate;
    }
}

export const SystemBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/memgpt_v2_chat.txt"), "utf-8");
export const ToolBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/tool_base.txt"), "utf-8");
export const UserBaseTemplate = readFileSync(path.resolve(__dirname, "../../resources/prompts/user_base.txt"), "utf-8");
